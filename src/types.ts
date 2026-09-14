import type { ChatState, SessionState, SessionSummary } from '@microsoft/agent-host-protocol';

export interface BridgeOptions {
	ahpUrl: URL | undefined;
	allowRemote: boolean;
	dryRun: boolean;
	updateDisplay: boolean;
	pollIntervalMs: number;
}

export interface SessionPage {
	page: number;
	pageCount: number;
	sessions: readonly SessionSummary[];
}

export interface SelectedSession {
	summary: SessionSummary;
	session: SessionState | undefined;
	chat: ChatState | undefined;
}

export interface DisplayTile {
	title: string;
	label: string;
	background: string;
	icon?: CodiconName;
	accent?: string;
	selected?: boolean;
}

export type CodiconName =
	| 'agent'
	| 'archive'
	| 'arrow-left'
	| 'check'
	| 'close'
	| 'debug-stop'
	| 'eye'
	| 'eye-closed'
	| 'folder'
	| 'info'
	| 'mail'
	| 'mail-read'
	| 'play'
	| 'pulse'
	| 'sync'
	| 'tools';

export interface DashboardPage {
	signature: string;
	tiles: readonly DisplayTile[];
}

export type KeyHandler = (controlId: number) => void | Promise<void>;
