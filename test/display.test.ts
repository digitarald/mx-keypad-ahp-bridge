import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KeypadDisplay, buildImagePackets, gridLocation, locationForKey, wrapText } from '../src/display.js';
import type { DashboardPage } from '../src/types.js';

test('maps nine keys to the physical display grid', () => {
	assert.deepEqual(
		[locationForKey(0), locationForKey(4), locationForKey(8)],
		[
			{ x: 23, y: 6, w: 118, h: 118 },
			{ x: 181, y: 164, w: 118, h: 118 },
			{ x: 339, y: 322, w: 118, h: 118 }
		]
	);
});

test('maps an atomic render to the complete three-by-three grid', () => {
	assert.deepEqual(gridLocation(), { x: 23, y: 6, w: 434, h: 434 });
});

test('wraps display text onto bounded lines with a final ellipsis', () => {
	assert.deepEqual(
		[
			wrapText('Latest tool call is writing a workspace file', 14, 2),
			wrapText('first line\nsecond line', 14, 2),
			wrapText('an-unbroken-identifier-that-is-too-long', 14, 2)
		],
		[
			['Latest tool', 'call is writi…'],
			['first line', 'second line'],
			['an-unbroken-i…']
		]
	);
});

test('frames a multi-packet JPEG with VLP sequence flags', () => {
	const image = Buffer.alloc(9000, 0xa5);
	const packets = buildImagePackets(image, locationForKey(0), true);
	assert.deepEqual(
		packets.map((packet, index) => ({
			length: packet.length,
			reportId: packet[0],
			status: packet[4],
			displayIndex: index === 0 ? packet[5] : undefined,
			imageLength: index === 0 ? (packet[17] ?? 0) << 16 | packet.readUInt16BE(18) : undefined
		})),
		[
			{ length: 4095, reportId: 0x14, status: 0xa1, displayIndex: 1, imageLength: 9000 },
			{ length: 4095, reportId: 0x14, status: 0x22, displayIndex: undefined, imageLength: undefined },
			{ length: 4095, reportId: 0x14, status: 0x63, displayIndex: undefined, imageLength: undefined }
		]
	);
});

test('uses one full-grid image for transitions and one tile image for small updates', async () => {
	const writes: Buffer[] = [];
	const display = new KeypadDisplay({
		write: async data => {
			writes.push(Buffer.from(data));
			return data.length;
		}
	});
	const page = (changedTitle = 'ONE'): DashboardPage => ({
		signature: changedTitle,
		tiles: Array.from({ length: 9 }, (_, index) => ({
			title: index === 4 ? changedTitle : `TILE ${index + 1}`,
			label: 'IDLE',
			background: '#1f1f1f',
			icon: 'agent',
			accent: '#4ec9b0'
		}))
	});

	await display.renderDashboard(page());
	const transitionFirstPackets = writes.filter(packet => ((packet[4] ?? 0) & 0x80) !== 0);
	const transitionLocation = transitionFirstPackets.map(packet => ({
		x: packet.readUInt16BE(9),
		y: packet.readUInt16BE(11),
		w: packet.readUInt16BE(13),
		h: packet.readUInt16BE(15)
	}));

	writes.length = 0;
	await display.renderDashboard(page('CHANGED'));
	const updateFirstPackets = writes.filter(packet => ((packet[4] ?? 0) & 0x80) !== 0);
	const updateLocation = updateFirstPackets.map(packet => ({
		x: packet.readUInt16BE(9),
		y: packet.readUInt16BE(11),
		w: packet.readUInt16BE(13),
		h: packet.readUInt16BE(15)
	}));

	assert.deepEqual({
		transitionImageOperations: transitionFirstPackets.length,
		transitionLocation,
		updateImageOperations: updateFirstPackets.length,
		updateLocation
	}, {
		transitionImageOperations: 1,
		transitionLocation: [{ x: 23, y: 6, w: 434, h: 434 }],
		updateImageOperations: 1,
		updateLocation: [{ x: 181, y: 164, w: 118, h: 118 }]
	});
});
