import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';
import { AhpSessionModel } from '../src/ahp.js';

test('connects and lists sessions over AHP WebSocket JSON-RPC', async t => {
	const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
	await once(server, 'listening');
	server.on('connection', socket => {
		socket.on('message', data => {
			const request = JSON.parse(data.toString()) as { id: number; method: string };
			if (request.method === 'initialize') {
				socket.send(JSON.stringify({
					jsonrpc: '2.0',
					id: request.id,
					result: {
						protocolVersion: '0.9.0',
						serverSeq: 0,
						snapshots: [{
							resource: 'ahp-root://',
							state: { agents: [] },
							fromSeq: 0
						}]
					}
				}));
			} else if (request.method === 'listSessions') {
				socket.send(JSON.stringify({
					jsonrpc: '2.0',
					id: request.id,
					result: {
						items: [{
							resource: 'ahp-session:/fixture',
							provider: 'fixture',
							title: 'Fixture Session',
							status: 1,
							createdAt: '2026-09-09T00:00:00.000Z',
							modifiedAt: '2026-09-09T00:00:00.000Z'
						}]
					}
				}));
			}
		});
	});

	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Fixture server did not bind a TCP port');
	}
	const model = new AhpSessionModel(new URL(`ws://127.0.0.1:${address.port}`));
	await model.connect();
	const sessions = await model.listSessions();
	assert.deepEqual(sessions.map(session => session.title), ['Fixture Session']);
	await model.close();
	await new Promise<void>(resolve => server.close(() => resolve()));
});

test('follows AHP cursors beyond one hundred sessions', async () => {
	const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
	await once(server, 'listening');
	const requestedCursors: Array<string | undefined> = [];
	server.on('connection', socket => {
		socket.on('message', data => {
			const request = JSON.parse(data.toString()) as {
				id: number;
				method: string;
				params?: { cursor?: string; limit?: number };
			};
			if (request.method === 'initialize') {
				socket.send(JSON.stringify({
					jsonrpc: '2.0',
					id: request.id,
					result: {
						protocolVersion: '0.9.0',
						serverSeq: 0,
						snapshots: [{ resource: 'ahp-root://', state: { agents: [] }, fromSeq: 0 }]
					}
				}));
				return;
			}
			if (request.method === 'listSessions') {
				requestedCursors.push(request.params?.cursor);
				const start = request.params?.cursor ? Number(request.params.cursor) : 0;
				const end = Math.min(start + 100, 205);
				socket.send(JSON.stringify({
					jsonrpc: '2.0',
					id: request.id,
					result: {
						items: Array.from({ length: end - start }, (_, offset) => ({
							resource: `ahp-session:/${start + offset}`,
							provider: 'fixture',
							title: `Session ${start + offset}`,
							status: 1,
							createdAt: '2026-09-09T00:00:00.000Z',
							modifiedAt: '2026-09-09T00:00:00.000Z'
						})),
						...(end < 205 ? { nextCursor: String(end) } : {})
					}
				}));
			}
		});
	});

	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Fixture server did not bind a TCP port');
	}
	const model = new AhpSessionModel(new URL(`ws://127.0.0.1:${address.port}`));
	await model.connect();
	const sessions = await model.listSessions();
	assert.deepEqual({
		sessionCount: sessions.length,
		first: sessions[0]?.title,
		last: sessions.at(-1)?.title,
		requestedCursors
	}, {
		sessionCount: 205,
		first: 'Session 0',
		last: 'Session 204',
		requestedCursors: [undefined, '100', '200']
	});
	await model.close();
	await new Promise<void>(resolve => server.close(() => resolve()));
});
