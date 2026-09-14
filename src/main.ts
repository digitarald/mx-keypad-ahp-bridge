import { AhpSessionModel } from './ahp.js';
import { parseOptions } from './cli.js';
import {
	CONFIRMATION_TIMEOUT_MS,
	actionForControl,
	commandForAction,
	dashboardPage,
	type ArmedDashboardAction
} from './dashboard.js';
import { KeypadDisplay } from './display.js';
import { MxKeypad } from './hid.js';
import { NEXT_PAGE_CONTROL_ID, PREVIOUS_PAGE_CONTROL_ID, SessionPager } from './sessionPage.js';

const options = parseOptions(process.argv.slice(2));
const model = new AhpSessionModel(options.ahpUrl);
const pager = new SessionPager();
let keypad: MxKeypad | undefined;
let display: KeypadDisplay | undefined;
let stopped = false;
let lastSummary = '';
let lastDeviceSummary = '';
let stopPromise: Promise<void> | undefined;
let selectedResource: string | undefined;
let dashboardOpen = false;
let armedAction: ArmedDashboardAction | undefined;
let operation = Promise.resolve();

async function refresh(): Promise<void> {
	await connectDevice();
	try {
		await model.connect();
		const page = pager.update(await model.listSessions());
		if (dashboardOpen && selectedResource) {
			await model.selectSession(selectedResource, scheduleRender);
		}
		logSummary(`AHP sessions: ${page.sessions.length} shown, page ${page.page + 1}/${page.pageCount}`);
		await renderCurrent();
	} catch (error) {
		await model.close();
		const page = pager.update([]);
		logSummary(`AHP unavailable (${formatError(error)}); waiting for a live local endpoint`);
		if (display) {
			await display.render(page, false);
		}
	}
}

async function connectDevice(): Promise<void> {
	if (options.dryRun || keypad) {
		return;
	}
	const devices = await MxKeypad.discover();
	if (!devices[0]) {
		logDeviceSummary('MX Keypad unavailable; waiting for USB device');
		return;
	}
	try {
		const connectedKeypad = await MxKeypad.open(devices[0], handleKey, scheduleDeviceDisconnect);
		keypad = connectedKeypad;
		if (options.updateDisplay) {
			display = new KeypadDisplay(connectedKeypad.device);
		}
		logDeviceSummary('MX Keypad connected');
	} catch (error) {
		logDeviceSummary(`MX Keypad connection failed (${formatError(error)}); retrying`);
	}
}

function scheduleDeviceDisconnect(error: Error): void {
	const disconnectedKeypad = keypad;
	keypad = undefined;
	display = undefined;
	logDeviceSummary(`MX Keypad disconnected (${formatError(error)}); waiting for USB device`);
	void enqueue(async () => {
		await disconnectedKeypad?.close();
		await connectDevice();
		if (display) {
			await renderCurrent();
		}
	}).catch(reconnectError => console.error(formatError(reconnectError)));
}

async function handleKey(controlId: number): Promise<void> {
	await enqueue(async () => handleKeyCore(controlId));
}

async function handleKeyCore(controlId: number): Promise<void> {
	if (dashboardOpen) {
		await handleDashboardKey(controlId);
		return;
	}
	if (controlId === PREVIOUS_PAGE_CONTROL_ID || controlId === NEXT_PAGE_CONTROL_ID) {
		const page = pager.move(controlId === PREVIOUS_PAGE_CONTROL_ID ? -1 : 1);
		if (display) {
			await display.render(page, model.connected, selectedResource);
		}
		return;
	}

	const session = pager.sessionForControl(controlId);
	if (session) {
		const previousResource = selectedResource;
		if (selectedResource === session.resource) {
			dashboardOpen = true;
			armedAction = undefined;
			await model.selectSession(session.resource, scheduleRender);
			console.log(`Opened dashboard for ${session.title} [${session.resource}]`);
		} else {
			selectedResource = session.resource;
			console.log(`Selected ${session.title} [${session.resource}]`);
		}
		if (display && (dashboardOpen || previousResource !== selectedResource)) {
			await renderCurrent();
		}
	}
}

async function handleDashboardKey(controlId: number): Promise<void> {
	if (controlId === PREVIOUS_PAGE_CONTROL_ID || controlId === 1) {
		dashboardOpen = false;
		armedAction = undefined;
		await model.clearSelection();
		await renderCurrent();
		return;
	}
	const selected = currentSelection();
	if (!selected) {
		return;
	}
	const action = actionForControl(controlId, selected);
	if (!action || action === 'back') {
		return;
	}
	const now = Date.now();
	if (armedAction?.action === action && armedAction.readyAt > now) {
		return;
	}
	if (armedAction?.action === action && armedAction.expiresAt > now) {
		const command = commandForAction(action, selected);
		armedAction = undefined;
		if (command) {
			model.dispatch(command.channel, command.action);
			console.log(`Dispatched ${command.description} for ${selected.summary.title}`);
		}
		await renderCurrent();
		return;
	}
	armedAction = { action, readyAt: Number.MAX_SAFE_INTEGER, expiresAt: Number.MAX_SAFE_INTEGER };
	await renderCurrent();
	const renderedAt = Date.now();
	armedAction = {
		action,
		readyAt: renderedAt + 750,
		expiresAt: renderedAt + CONFIRMATION_TIMEOUT_MS
	};
	console.log(`Armed ${action} for ${selected.summary.title}; press again within ${CONFIRMATION_TIMEOUT_MS / 1000}s to confirm`);
}

function currentSelection() {
	const summary = pager.sessionForResource(selectedResource);
	return summary ? { summary, session: model.sessionState, chat: model.chatState } : undefined;
}

function scheduleRender(): void {
	void enqueue(renderCurrent).catch(error => console.error(formatError(error)));
}

async function renderCurrent(): Promise<void> {
	if (!display) {
		return;
	}
	const selected = dashboardOpen ? currentSelection() : undefined;
	if (selected) {
		if (armedAction && armedAction.expiresAt <= Date.now()) {
			armedAction = undefined;
		}
		await display.renderDashboard(dashboardPage(selected, armedAction, Date.now()));
	} else {
		await display.render(pager.current, model.connected, selectedResource);
	}
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
	const next = operation.then(task, task);
	operation = next.then(() => undefined, () => undefined);
	return next;
}

async function stop(): Promise<void> {
	if (!stopPromise) {
		stopPromise = stopCore();
	}
	await stopPromise;
}

async function stopCore(): Promise<void> {
	stopped = true;
	console.log('Stopping bridge...');
	try {
		await keypad?.close();
	} finally {
		await model.close();
	}
}

process.once('SIGINT', () => void stop().catch(error => {
	console.error(error);
	process.exitCode = 1;
}));
process.once('SIGTERM', () => void stop().catch(error => {
	console.error(error);
	process.exitCode = 1;
}));

try {
	const devices = await MxKeypad.discover();
	console.log(`Found ${devices.length} MX Keypad vendor HID interface(s)`);

	if (!options.dryRun) {
		await connectDevice();
		if (display) {
			await display.render(pager.current, false);
		}
		console.log('Press Ctrl+C to restore key reporting and exit');
	} else {
		console.log('Dry run: device writes and key diversion are disabled');
	}

	while (!stopped) {
		await enqueue(refresh);
		await new Promise(resolve => setTimeout(resolve, options.pollIntervalMs));
	}
} catch (error) {
	console.error(error);
	process.exitCode = 1;
	await stop();
}

function logSummary(summary: string): void {
	if (summary !== lastSummary) {
		lastSummary = summary;
		console.log(summary);
	}
}

function logDeviceSummary(summary: string): void {
	if (summary !== lastDeviceSummary) {
		lastDeviceSummary = summary;
		console.log(summary);
	}
}

function formatError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replaceAll(/([?&]tkn=)[^&\s]+/g, '$1***');
}
