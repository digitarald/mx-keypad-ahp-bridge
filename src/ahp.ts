import {
	chatReducer,
	PROTOCOL_VERSION,
	sessionReducer,
	SUPPORTED_PROTOCOL_VERSIONS,
	type ChatAction,
	type ChatState,
	type SessionAction,
	type SessionState,
	type SessionSummary
} from '@microsoft/agent-host-protocol';
import { AhpClient, type Subscription } from '@microsoft/agent-host-protocol/client';
import { WebSocketTransport } from '@microsoft/agent-host-protocol/ws';
import { discoverAhpEndpoint } from './endpointRegistry.js';

const ROOT_CHANNEL = 'ahp-root://';

export class AhpSessionModel {
	private client: AhpClient | undefined;
	private connecting: Promise<void> | undefined;
	private selectedResource: string | undefined;
	private selectedSession: SessionState | undefined;
	private selectedChat: ChatState | undefined;
	private selectedSubscriptions: Subscription[] = [];
	private selectionGeneration = 0;
	private onSelectedChanged: (() => void) | undefined;

	constructor(private readonly configuredEndpoint?: URL) {
	}

	get connected(): boolean {
		return this.client !== undefined;
	}

	async connect(): Promise<void> {
		if (this.client) {
			return;
		}
		if (!this.connecting) {
			this.connecting = this.connectCore().finally(() => {
				this.connecting = undefined;
			});
		}
		await this.connecting;
	}

	private async connectCore(): Promise<void> {
		const endpoint = this.configuredEndpoint ?? await discoverAhpEndpoint();
		const transport = await WebSocketTransport.connect(endpoint.toString());
		const client = new AhpClient(transport);
		client.connect();
		try {
			await client.initialize({
				clientId: `mx-keypad-${process.pid}`,
				protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
				initialSubscriptions: [ROOT_CHANNEL]
			});
			this.client = client;
			console.log(`AHP ${PROTOCOL_VERSION} connected to ${formatEndpoint(endpoint)}`);
		} catch (error) {
			await client.shutdown();
			throw error;
		}
	}

	async listSessions(): Promise<readonly SessionSummary[]> {
		const client = this.requireClient();
		const sessions: SessionSummary[] = [];
		let cursor: string | undefined;
		do {
			const result = await client.request('listSessions', {
				channel: ROOT_CHANNEL,
				limit: 100,
				...(cursor ? { cursor } : {})
			});
			sessions.push(...result.items);
			cursor = result.nextCursor;
		} while (cursor);
		return sessions;
	}

	get sessionState(): SessionState | undefined {
		return this.selectedSession;
	}

	get chatState(): ChatState | undefined {
		return this.selectedChat;
	}

	async selectSession(resource: string, onChanged: () => void): Promise<void> {
		if (this.selectedResource === resource && this.selectedSession) {
			this.onSelectedChanged = onChanged;
			return;
		}
		await this.clearSelection();
		const client = this.requireClient();
		const generation = this.selectionGeneration;
		const { result, subscription } = await client.subscribe(resource);
		const snapshot = result.snapshot;
		if (!snapshot) {
			await subscription.close();
			throw new Error(`AHP session ${resource} did not provide a state snapshot`);
		}
		this.selectedResource = resource;
		this.selectedSession = snapshot.state as SessionState;
		this.onSelectedChanged = onChanged;
		this.selectedSubscriptions.push(subscription);
		void this.pumpSession(subscription, generation).catch(error => {
			console.error(`AHP session subscription failed: ${formatError(error)}`);
		});
		await this.selectChat(generation);
		onChanged();
	}

	dispatch(channel: string, action: Parameters<AhpClient['dispatch']>[1]): void {
		this.requireClient().dispatch(channel, action);
	}

	async clearSelection(): Promise<void> {
		this.selectionGeneration++;
		this.selectedResource = undefined;
		this.selectedSession = undefined;
		this.selectedChat = undefined;
		this.onSelectedChanged = undefined;
		const subscriptions = this.selectedSubscriptions;
		this.selectedSubscriptions = [];
		const client = this.client;
		if (client) {
			await Promise.all([...new Set(subscriptions.map(subscription => subscription.uri))]
				.map(uri => client.unsubscribe(uri)));
		} else {
			await Promise.all(subscriptions.map(subscription => subscription.close()));
		}
	}

	async close(): Promise<void> {
		await this.connecting?.catch(() => undefined);
		await this.clearSelection();
		const client = this.client;
		this.client = undefined;
		await client?.shutdown();
	}

	private async selectChat(generation: number): Promise<void> {
		const session = this.selectedSession;
		const chatResource = session?.defaultChat ?? session?.chats
			.toSorted((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt))[0]?.resource;
		if (!chatResource || generation !== this.selectionGeneration) {
			return;
		}
		const { result, subscription } = await this.requireClient().subscribe(chatResource);
		if (generation !== this.selectionGeneration) {
			await subscription.close();
			return;
		}
		if (result.snapshot) {
			this.selectedChat = result.snapshot.state as ChatState;
		}
		this.selectedSubscriptions.push(subscription);
		void this.pumpChat(subscription, generation).catch(error => {
			console.error(`AHP chat subscription failed: ${formatError(error)}`);
		});
	}

	private async pumpSession(subscription: Subscription, generation: number): Promise<void> {
		for await (const event of subscription) {
			if (generation !== this.selectionGeneration) {
				return;
			}
			if (event.type === 'action' && this.selectedSession) {
				this.selectedSession = sessionReducer(this.selectedSession, event.params.action as SessionAction);
				this.onSelectedChanged?.();
			}
		}
	}

	private async pumpChat(subscription: Subscription, generation: number): Promise<void> {
		for await (const event of subscription) {
			if (generation !== this.selectionGeneration) {
				return;
			}
			if (event.type === 'action' && this.selectedChat) {
				this.selectedChat = chatReducer(this.selectedChat, event.params.action as ChatAction);
				this.onSelectedChanged?.();
			}
		}
	}

	private requireClient(): AhpClient {
		if (!this.client) {
			throw new Error('AHP client is not connected');
		}
		return this.client;
	}
}

function formatEndpoint(endpoint: URL): string {
	const redacted = new URL(endpoint);
	redacted.search = '';
	redacted.hash = '';
	redacted.username = '';
	redacted.password = '';
	return redacted.toString();
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
