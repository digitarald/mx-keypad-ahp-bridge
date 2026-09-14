import { HIDAsync, devicesAsync, type Device } from 'node-hid';
import type { KeyHandler } from './types.js';

const VENDOR_ID = 0x046d;
const PRODUCT_ID = 0xc354;
const HIDPP_REPORT_ID = 0x11;
const RAW_VLP_REPORT_ID = 0x13;
const CONTEXTUAL_DISPLAY_FEATURE_INDEX = 0x02;
const SOFTWARE_ID = 0x0b;
const FEATURE_SPECIAL_KEYS = 0x1b04;
const CONTROL_BYTES = 8;
const KEY_DEBOUNCE_MS = 750;
const KEY_RELEASE_STABILIZATION_MS = 600;

interface PendingCommand {
	featureIndex: number;
	resolve: (value: Uint8Array) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

interface ReportingSnapshot {
	controlId: number;
	reporting: number;
	remap: number;
	reporting2: number;
}

export class MxKeypad {
	private readonly reportingSnapshots: ReportingSnapshot[] = [];
	private readonly pressed = new Set<number>();
	private readonly rawPressed = new Set<number>();
	private readonly releaseTimers = new Map<number, NodeJS.Timeout>();
	private readonly rawReleaseTimers = new Map<number, NodeJS.Timeout>();
	private readonly lastKeyDown = new Map<number, number>();
	private pending: PendingCommand | undefined;
	private readLoop: Promise<void> | undefined;
	private closed = false;
	private disconnected = false;

	private constructor(
		readonly deviceInfo: Device,
		readonly device: HIDAsync,
		private readonly onKeyDown: KeyHandler,
		private readonly onDisconnect: (error: Error) => void
	) {
	}

	static async discover(): Promise<Device[]> {
		const devices = await devicesAsync(VENDOR_ID, PRODUCT_ID);
		const byPath = new Map<string, Device>();
		for (const device of devices) {
			if (device.path && device.usagePage === 0xff43 && !byPath.has(device.path)) {
				byPath.set(device.path, device);
			}
		}
		return [...byPath.values()];
	}

	static async open(deviceInfo: Device, onKeyDown: KeyHandler, onDisconnect: (error: Error) => void = () => undefined): Promise<MxKeypad> {
		if (!deviceInfo.path) {
			throw new Error('MX Keypad HID interface has no path');
		}
		const device = await HIDAsync.open(deviceInfo.path, { nonExclusive: true });
		const keypad = new MxKeypad(deviceInfo, device, onKeyDown, onDisconnect);
		keypad.readLoop = keypad.readReports();
		await keypad.enableKeyEvents();
		return keypad;
	}

	async close(): Promise<void> {
		if (this.closed) {
			return;
		}
		if (!this.disconnected) {
			await this.restoreKeyEvents();
		}
		this.closed = true;
		for (const timer of [...this.releaseTimers.values(), ...this.rawReleaseTimers.values()]) {
			clearTimeout(timer);
		}
		this.releaseTimers.clear();
		this.rawReleaseTimers.clear();
		try {
			await this.device.close();
		} catch (error) {
			if (!this.disconnected) {
				throw error;
			}
		}
		await this.readLoop;
	}

	private async enableKeyEvents(): Promise<void> {
		const featureIndex = await this.getFeatureIndex(FEATURE_SPECIAL_KEYS);
		const count = (await this.sendCommand(featureIndex, 0))[0] ?? 0;
		for (let index = 0; index < count; index++) {
			const info = await this.sendCommand(featureIndex, 1, [index]);
			const controlId = ((info[0] ?? 0) << 8) | (info[1] ?? 0);
			const reporting = await this.sendCommand(featureIndex, 2, [controlId >> 8, controlId & 0xff]);
			const snapshot = {
				controlId,
				reporting: reporting[2] ?? 0,
				remap: ((reporting[3] ?? 0) << 8) | (reporting[4] ?? 0),
				reporting2: reporting[5] ?? 0
			};
			this.reportingSnapshots.push(snapshot);
			await this.setReporting(featureIndex, snapshot, snapshot.reporting | 0x03);
		}
	}

	private async restoreKeyEvents(): Promise<void> {
		if (!this.reportingSnapshots.length) {
			return;
		}
		const featureIndex = await this.getFeatureIndex(FEATURE_SPECIAL_KEYS);
		for (const snapshot of this.reportingSnapshots) {
			await this.setReporting(featureIndex, snapshot, snapshot.reporting);
		}
		this.reportingSnapshots.length = 0;
	}

	private async setReporting(featureIndex: number, snapshot: ReportingSnapshot, reporting: number): Promise<void> {
		await this.sendCommand(featureIndex, 3, [
			snapshot.controlId >> 8,
			snapshot.controlId & 0xff,
			reporting,
			snapshot.remap >> 8,
			snapshot.remap & 0xff,
			snapshot.reporting2
		]);
	}

	private async getFeatureIndex(featureId: number): Promise<number> {
		const response = await this.sendCommand(0, 0, [featureId >> 8, featureId & 0xff, 0]);
		const featureIndex = response[0] ?? 0;
		if (featureIndex === 0) {
			throw new Error(`HID++ feature 0x${featureId.toString(16)} is unavailable`);
		}
		return featureIndex;
	}

	private async sendCommand(featureIndex: number, functionId: number, parameters: readonly number[] = []): Promise<Uint8Array> {
		if (this.pending) {
			throw new Error('HID++ commands must be serialized');
		}
		const report = Buffer.alloc(20);
		report[0] = HIDPP_REPORT_ID;
		report[1] = 0xff;
		report[2] = featureIndex;
		report[3] = (functionId << 4) | SOFTWARE_ID;
		for (let index = 0; index < Math.min(16, parameters.length); index++) {
			report[4 + index] = parameters[index] ?? 0;
		}

		let resolveResponse!: (value: Uint8Array) => void;
		let rejectResponse!: (error: Error) => void;
		const response = new Promise<Uint8Array>((resolve, reject) => {
			resolveResponse = resolve;
			rejectResponse = reject;
		});
		const timer = setTimeout(() => {
			this.pending = undefined;
			rejectResponse(new Error(`HID++ command 0x${featureIndex.toString(16)}:${functionId} timed out`));
		}, 5000);
		this.pending = { featureIndex, resolve: resolveResponse, reject: rejectResponse, timer };
		try {
			await this.device.write(report);
		} catch (error) {
			const pending = this.pending;
			this.pending = undefined;
			if (pending) {
				clearTimeout(pending.timer);
				pending.reject(error instanceof Error ? error : new Error(String(error)));
			}
		}
		return response;
	}

	private async readReports(): Promise<void> {
		while (!this.closed) {
			let report: Buffer | undefined;
			try {
				report = await this.device.read(500);
			} catch (error) {
				if (!this.closed) {
					const disconnectError = error instanceof Error ? error : new Error(String(error));
					this.disconnected = true;
					if (this.pending) {
						clearTimeout(this.pending.timer);
						this.pending.reject(disconnectError);
					}
					this.pending = undefined;
					this.onDisconnect(disconnectError);
				}
				return;
			}
			if (report) {
				await this.handleReport(report);
			}
		}
	}

	private async handleReport(report: Buffer): Promise<void> {
		if (report[0] === RAW_VLP_REPORT_ID) {
			const active = parseRawVlpControlIds(report);
			this.updatePressedState(active, this.rawPressed, this.rawReleaseTimers);
			return;
		}

		if (report[0] !== HIDPP_REPORT_ID || report.length < 5) {
			return;
		}
		const featureIndex = report[2] ?? 0;
		const functionAndSoftware = report[3] ?? 0;
		const pending = this.pending;
		if (pending && pending.featureIndex === featureIndex && (functionAndSoftware & 0x0f) === SOFTWARE_ID) {
			this.pending = undefined;
			clearTimeout(pending.timer);
			pending.resolve(report.subarray(4));
			return;
		}

		if ((functionAndSoftware & 0x0f) !== 0) {
			return;
		}
		const active = new Set<number>();
		for (let index = 4; index < 4 + CONTROL_BYTES; index += 2) {
			const controlId = ((report[index] ?? 0) << 8) | (report[index + 1] ?? 0);
			if (controlId) {
				active.add(controlId);
			}
		}

		this.updatePressedState(active, this.pressed, this.releaseTimers);
	}

	private updatePressedState(active: ReadonlySet<number>, pressed: Set<number>, releaseTimers: Map<number, NodeJS.Timeout>): void {
		for (const controlId of active) {
			const releaseTimer = releaseTimers.get(controlId);
			if (releaseTimer) {
				clearTimeout(releaseTimer);
				releaseTimers.delete(controlId);
			}
			if (!pressed.has(controlId)) {
				pressed.add(controlId);
				this.emitKeyDown(controlId);
			}
		}
		for (const controlId of pressed) {
			if (!active.has(controlId) && !releaseTimers.has(controlId)) {
				const timer = setTimeout(() => {
					releaseTimers.delete(controlId);
					pressed.delete(controlId);
				}, KEY_RELEASE_STABILIZATION_MS);
				releaseTimers.set(controlId, timer);
			}
		}
	}

	private emitKeyDown(controlId: number): void {
		const now = Date.now();
		const last = this.lastKeyDown.get(controlId) ?? 0;
		if (now - last < KEY_DEBOUNCE_MS) {
			return;
		}
		this.lastKeyDown.set(controlId, now);
		Promise.resolve(this.onKeyDown(controlId)).catch(error => {
			console.error(`MX Keypad key handler failed: ${error instanceof Error ? error.message : String(error)}`);
		});
	}
}

export function parseRawVlpControlIds(report: Uint8Array): ReadonlySet<number> {
	const active = new Set<number>();
	if (report.length < 7
		|| report[0] !== RAW_VLP_REPORT_ID
		|| report[1] !== 0xff
		|| report[2] !== CONTEXTUAL_DISPLAY_FEATURE_INDEX
		|| report[3] !== 0x00) {
		return active;
	}

	for (let index = 6; index < report.length; index++) {
		const controlId = report[index] ?? 0;
		if (controlId === 0) {
			break;
		}
		active.add(controlId);
	}
	return active;
}
