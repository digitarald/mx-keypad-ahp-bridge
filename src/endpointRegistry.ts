import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

interface EndpointRegistryEntry {
	schemaVersion: number;
	type: 'editor' | 'standalone';
	pid: number;
	connectionToken: string;
	endpoint: {
		type: 'socket' | 'tcp';
		host?: string;
		port?: number;
	};
}

interface EndpointCandidate {
	modifiedAt: number;
	url: URL;
}

export async function discoverAhpEndpoint(userDataPaths = defaultUserDataPaths()): Promise<URL> {
	const candidates: EndpointCandidate[] = [];
	for (const userDataPath of userDataPaths) {
		const entriesDirectory = join(userDataPath, 'agent-host', 'local-endpoint', 'entries');
		let entryNames: string[];
		try {
			entryNames = await readdir(entriesDirectory);
		} catch {
			continue;
		}

		for (const entryName of entryNames) {
			if (!entryName.endsWith('.json')) {
				continue;
			}
			const path = join(entriesDirectory, entryName);
			const candidate = await readCandidate(path);
			if (candidate) {
				candidates.push(candidate);
			}
		}
	}

	candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
	const endpoint = candidates[0]?.url;
	if (!endpoint) {
		throw new Error('No live local AHP TCP endpoint is registered');
	}
	return endpoint;
}

async function readCandidate(path: string): Promise<EndpointCandidate | undefined> {
	try {
		const entry = JSON.parse(await readFile(path, 'utf8')) as EndpointRegistryEntry;
		const { endpoint } = entry;
		const port = endpoint.port;
		if (entry.schemaVersion !== 2
			|| entry.type !== 'standalone'
			|| endpoint.type !== 'tcp'
			|| typeof endpoint.host !== 'string'
			|| !isLoopback(endpoint.host)
			|| typeof port !== 'number'
			|| !Number.isInteger(port)
			|| port <= 0
			|| port > 65535
			|| typeof entry.connectionToken !== 'string'
			|| !entry.connectionToken
			|| !Number.isInteger(entry.pid)
			|| !(await isProcessAlive(entry.pid))) {
			return undefined;
		}

		const url = new URL(`ws://${formatHost(endpoint.host)}:${port}`);
		url.searchParams.set('tkn', entry.connectionToken);
		return { modifiedAt: (await stat(path)).mtimeMs, url };
	} catch {
		return undefined;
	}
}

async function isProcessAlive(pid: number): Promise<boolean> {
	if (pid === process.pid) {
		return true;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

function defaultUserDataPaths(): string[] {
	const applicationSupport = join(homedir(), 'Library', 'Application Support');
	return [
		join(applicationSupport, 'Code - Insiders'),
		join(applicationSupport, 'Code')
	];
}

function isLoopback(host: string): boolean {
	return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function formatHost(host: string): string {
	return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}
