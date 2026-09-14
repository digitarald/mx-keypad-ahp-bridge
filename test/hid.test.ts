import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRawVlpControlIds } from '../src/hid.js';

test('parses pressed LCD keys from raw VLP reports', () => {
	const report = Buffer.from([
		0x13, 0xff, 0x02, 0x00, 0x00, 0x00,
		0x01, 0x05, 0x09, 0x00
	]);
	assert.deepEqual([...parseRawVlpControlIds(report)], [1, 5, 9]);
});

test('ignores unrelated raw VLP reports', () => {
	const report = Buffer.from([
		0x13, 0xff, 0x03, 0x00, 0x00, 0x00,
		0x01, 0x00
	]);
	assert.deepEqual([...parseRawVlpControlIds(report)], []);
});
