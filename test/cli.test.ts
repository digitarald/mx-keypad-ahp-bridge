import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOptions } from '../src/cli.js';

test('defaults to a loopback dry run', () => {
	const options = parseOptions([]);
	assert.deepEqual(
		{
			ahpUrl: options.ahpUrl?.toString(),
			dryRun: options.dryRun,
			updateDisplay: options.updateDisplay,
			pollIntervalMs: options.pollIntervalMs
		},
		{
			ahpUrl: undefined,
			dryRun: true,
			updateDisplay: true,
			pollIntervalMs: 2000
		}
	);
});

test('rejects remote hosts unless explicitly allowed', () => {
	assert.throws(() => parseOptions(['--ahp', 'wss://example.com']), /--allow-remote/);
	assert.equal(parseOptions(['--ahp', 'wss://example.com', '--allow-remote']).allowRemote, true);
});
