import type { BridgeOptions } from './types.js';

export function parseOptions(args: readonly string[]): BridgeOptions {
	let ahpUrl: URL | undefined;
	let allowRemote = false;
	let dryRun = true;
	let updateDisplay = true;
	let pollIntervalMs = 2000;

	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		switch (argument) {
			case '--ahp': {
				const value = args[++index];
				if (!value) {
					throw new Error('--ahp requires a WebSocket URL');
				}
				ahpUrl = new URL(value);
				break;
			}
			case '--allow-remote':
				allowRemote = true;
				break;
			case '--dry-run':
				dryRun = true;
				break;
			case '--write-device':
				dryRun = false;
				break;
			case '--no-display':
				updateDisplay = false;
				break;
			case '--poll': {
				const value = Number(args[++index]);
				if (!Number.isInteger(value) || value < 250) {
					throw new Error('--poll requires an integer of at least 250 milliseconds');
				}
				pollIntervalMs = value;
				break;
			}
			default:
				throw new Error(`Unknown argument: ${argument}`);
		}
	}

	if (ahpUrl && ahpUrl.protocol !== 'ws:' && ahpUrl.protocol !== 'wss:') {
		throw new Error('AHP URL must use ws: or wss:');
	}

	if (ahpUrl && !allowRemote && !isLoopback(ahpUrl.hostname)) {
		throw new Error('Remote AHP endpoints require --allow-remote');
	}

	return { ahpUrl, allowRemote, dryRun, updateDisplay, pollIntervalMs };
}

function isLoopback(hostname: string): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}
