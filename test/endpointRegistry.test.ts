import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { discoverAhpEndpoint } from '../src/endpointRegistry.js';

test('discovers a live loopback standalone endpoint', async t => {
	const userDataPath = await mkdtemp(join(tmpdir(), 'mx-keypad-ahp-'));
	t.after(() => rm(userDataPath, { recursive: true, force: true }));
	const entriesDirectory = join(userDataPath, 'agent-host', 'local-endpoint', 'entries');
	await mkdir(entriesDirectory, { recursive: true });
	await writeFile(join(entriesDirectory, 'entry.json'), JSON.stringify({
		schemaVersion: 2,
		type: 'standalone',
		pid: process.pid,
		connectionToken: 'fixture-token',
		endpoint: { type: 'tcp', host: '127.0.0.1', port: 54321 }
	}));

	const endpoint = await discoverAhpEndpoint([userDataPath]);
	assert.equal(endpoint.toString(), 'ws://127.0.0.1:54321/?tkn=fixture-token');
});

test('rejects remote and dead registry entries', async t => {
	const userDataPath = await mkdtemp(join(tmpdir(), 'mx-keypad-ahp-'));
	t.after(() => rm(userDataPath, { recursive: true, force: true }));
	const entriesDirectory = join(userDataPath, 'agent-host', 'local-endpoint', 'entries');
	await mkdir(entriesDirectory, { recursive: true });
	await writeFile(join(entriesDirectory, 'remote.json'), JSON.stringify({
		schemaVersion: 2,
		type: 'standalone',
		pid: process.pid,
		connectionToken: 'fixture-token',
		endpoint: { type: 'tcp', host: 'example.com', port: 443 }
	}));
	await writeFile(join(entriesDirectory, 'dead.json'), JSON.stringify({
		schemaVersion: 2,
		type: 'standalone',
		pid: 2147483647,
		connectionToken: 'fixture-token',
		endpoint: { type: 'tcp', host: '127.0.0.1', port: 54321 }
	}));

	await assert.rejects(discoverAhpEndpoint([userDataPath]), /No live local AHP TCP endpoint/);
});
