import sharp from 'sharp';
import type { HIDAsync } from 'node-hid';
import { codiconSvg } from './codicons.js';
import { statusColor, statusLabel } from './sessionPage.js';
import type { DashboardPage, DisplayTile, SessionPage } from './types.js';

const REPORT_ID = 0x14;
const REPORT_LENGTH = 4095;
const DISPLAY_FEATURE_INDEX = 0x02;
const DISPLAY_INDEX = 1;
const LCD_SIZE = 118;
const BUTTON_GAP = 40;
const ORIGIN_X = 23;
const ORIGIN_Y = 6;
const GRID_SIZE = LCD_SIZE * 3 + BUTTON_GAP * 2;
const SURFACE = '#1f1f1f';

export class KeypadDisplay {
	private signatures: readonly string[] = [];

	constructor(private readonly device: Pick<HIDAsync, 'write'>) {
	}

	async render(page: SessionPage, connected = true, selectedResource?: string): Promise<void> {
		const tiles = Array.from({ length: 9 }, (_, index): DisplayTile => {
			const session = page.sessions[index];
			if (!connected && index === 0) {
				return { title: 'AHP', label: 'OFFLINE', background: SURFACE, icon: 'debug-stop', accent: '#f14c4c' };
			}
			return session
				? {
					title: session.title,
					label: statusLabel(session.status),
					background: SURFACE,
					icon: 'agent',
					accent: statusColor(session.status),
					selected: session.resource === selectedResource
				}
				: { title: 'EMPTY', label: `${page.page + 1}/${page.pageCount}`, background: SURFACE, icon: 'info', accent: '#6e7681' };
		});
		await this.renderTiles(tiles, tiles.map((_, index) => tileSignature(page, index, connected, selectedResource)));
	}

	async renderDashboard(page: DashboardPage): Promise<void> {
		await this.renderTiles(page.tiles, page.tiles.map(tile => `${tile.title}:${tile.label}:${tile.background}:${tile.icon ?? ''}:${tile.accent ?? ''}:${tile.selected ?? false}`));
	}

	private async renderTiles(tiles: readonly DisplayTile[], signatures: readonly string[]): Promise<void> {
		const changedIndices = signatures
			.map((signature, index) => signature !== this.signatures[index] ? index : -1)
			.filter(index => index >= 0);
		if (!changedIndices.length) {
			return;
		}

		if (changedIndices.length >= 3) {
			const jpeg = await renderGrid(tiles);
			for (const packet of buildImagePackets(jpeg, gridLocation(), false)) {
				await this.device.write(packet);
			}
			this.signatures = signatures;
			return;
		}

		for (const [changedIndex, index] of changedIndices.entries()) {
			const tile = tiles[index] ?? { title: '', label: '', background: SURFACE };
			const jpeg = await renderTile(tile);
			const location = locationForKey(index);
			const packets = buildImagePackets(jpeg, location, changedIndex !== changedIndices.length - 1);
			for (const packet of packets) {
				await this.device.write(packet);
			}
		}
		this.signatures = signatures;
	}
}

export interface ImageLocation {
	x: number;
	y: number;
	w: number;
	h: number;
}

export function locationForKey(index: number): ImageLocation {
	if (!Number.isInteger(index) || index < 0 || index >= 9) {
		throw new RangeError('Key index must be between 0 and 8');
	}
	const row = Math.floor(index / 3);
	const column = index % 3;
	return {
		x: ORIGIN_X + column * (LCD_SIZE + BUTTON_GAP),
		y: ORIGIN_Y + row * (LCD_SIZE + BUTTON_GAP),
		w: LCD_SIZE,
		h: LCD_SIZE
	};
}

export function gridLocation(): ImageLocation {
	return { x: ORIGIN_X, y: ORIGIN_Y, w: GRID_SIZE, h: GRID_SIZE };
}

export function buildImagePackets(image: Uint8Array, location: ImageLocation, deferDisplayUpdate: boolean): Buffer[] {
	if (image.byteLength > 0xffffff) {
		throw new RangeError('Image exceeds the protocol 24-bit size field');
	}

	const packets: Buffer[] = [];
	let offset = 0;
	let sequence = 1;
	do {
		const first = offset === 0;
		const headerLength = first ? 20 : 5;
		const chunkLength = Math.min(image.byteLength - offset, REPORT_LENGTH - headerLength);
		const last = offset + chunkLength >= image.byteLength;
		const packet = Buffer.alloc(REPORT_LENGTH);
		packet[0] = REPORT_ID;
		packet[1] = 0xff;
		packet[2] = DISPLAY_FEATURE_INDEX;
		packet[3] = 0x2b;
		packet[4] = vlpStatus(sequence, first, last);
		if (first) {
			packet[5] = DISPLAY_INDEX;
			packet[6] = deferDisplayUpdate ? 1 : 0;
			packet[7] = 1;
			packet[8] = 0;
			packet.writeUInt16BE(location.x, 9);
			packet.writeUInt16BE(location.y, 11);
			packet.writeUInt16BE(location.w, 13);
			packet.writeUInt16BE(location.h, 15);
			packet[17] = (image.byteLength >> 16) & 0xff;
			packet.writeUInt16BE(image.byteLength & 0xffff, 18);
		}
		packet.set(image.subarray(offset, offset + chunkLength), headerLength);
		packets.push(packet);
		offset += chunkLength;
		sequence++;
	} while (offset < image.byteLength);
	return packets;
}

function vlpStatus(sequence: number, first: boolean, last: boolean): number {
	return (sequence & 0x0f) | 0x20 | (first ? 0x80 : 0) | (last ? 0x40 : 0);
}

async function renderTile(tile: DisplayTile): Promise<Buffer> {
	const svg = `
		<svg width="${LCD_SIZE}" height="${LCD_SIZE}" xmlns="http://www.w3.org/2000/svg">
			${renderTileSvg(tile, 0, 0)}
		</svg>`;
	return sharp(Buffer.from(svg)).jpeg({ quality: 78, chromaSubsampling: '4:4:4' }).toBuffer();
}

async function renderGrid(tiles: readonly DisplayTile[]): Promise<Buffer> {
	const tileMarkup = tiles.map((tile, index) => {
		const location = locationForGridIndex(index);
		return renderTileSvg(tile, location.x, location.y);
	}).join('');
	const svg = `
		<svg width="${GRID_SIZE}" height="${GRID_SIZE}" xmlns="http://www.w3.org/2000/svg">
			<rect width="100%" height="100%" fill="#000000"/>
			${tileMarkup}
		</svg>`;
	return sharp(Buffer.from(svg)).jpeg({ quality: 78, chromaSubsampling: '4:4:4' }).toBuffer();
}

function renderTileSvg(tile: DisplayTile, x: number, y: number): string {
	const accent = tile.accent ?? '#8b949e';
	const icon = tile.icon ? codiconSvg(tile.icon, x + 43, y + 12, 32, accent) : '';
	const titleLines = wrapText(tile.title, 18, tile.icon ? 2 : 3);
	const labelLines = wrapText(tile.label, 18, 2);
	const titleStart = tile.icon ? y + 64 : y + 37;
	const selection = tile.selected
		? `<rect x="${x + 3}" y="${y + 3}" width="112" height="112" rx="8" fill="none" stroke="${accent}" stroke-width="4"/>`
		: '';
	return `
		<g>
			<rect x="${x}" y="${y}" width="${LCD_SIZE}" height="${LCD_SIZE}" rx="7" fill="${tile.background}"/>
			<rect x="${x}" y="${y}" width="${LCD_SIZE}" height="4" rx="2" fill="${accent}"/>
			${selection}
			${icon}
			${svgText(titleLines, x + 59, titleStart, 14, 17, '#f0f0f0', 600)}
			${svgText(labelLines, x + 59, y + 101 - (labelLines.length - 1) * 13, 11, 13, '#a8a8a8', 400)}
		</g>`;
}

function svgText(lines: readonly string[], x: number, y: number, size: number, lineHeight: number, color: string, weight: number): string {
	return lines.map((line, index) =>
		`<text x="${x}" y="${y + index * lineHeight}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Arial, sans-serif">${escapeXml(line)}</text>`
	).join('');
}

export function wrapText(value: string, maximum: number, maximumLines: number): string[] {
	const lines = value.split('\n').flatMap(line => wrapLine(line, maximum));
	if (lines.length <= maximumLines) {
		return lines;
	}
	return [
		...lines.slice(0, maximumLines - 1),
		shorten(lines.slice(maximumLines - 1).join(' '), maximum)
	];
}

function wrapLine(value: string, maximum: number): string[] {
	if (value.length <= maximum) {
		return [value];
	}
	const words = value.trim().split(/\s+/);
	const lines: string[] = [];
	for (const word of words) {
		const current = lines.at(-1);
		if (!current || current.length + 1 + word.length > maximum) {
			lines.push(shorten(word, maximum));
		} else {
			lines[lines.length - 1] = `${current} ${word}`;
		}
	}
	return lines;
}

function locationForGridIndex(index: number): { x: number; y: number } {
	return {
		x: (index % 3) * (LCD_SIZE + BUTTON_GAP),
		y: Math.floor(index / 3) * (LCD_SIZE + BUTTON_GAP)
	};
}

function shorten(value: string, maximum: number): string {
	return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function tileSignature(page: SessionPage, index: number, connected: boolean, selectedResource?: string): string {
	if (!connected && index === 0) {
		return 'offline';
	}
	const session = page.sessions[index];
	return session
		? `${page.page}:${session.resource}:${session.title}:${session.status}:${session.resource === selectedResource}`
		: `${page.page}:${page.pageCount}:empty:${index}`;
}
