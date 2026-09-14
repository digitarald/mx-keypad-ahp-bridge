import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	ActionType,
	ConfirmationOptionKind,
	MessageKind,
	ResponsePartKind,
	SessionInputRequestKind,
	SessionLifecycle,
	SessionStatus,
	ToolCallStatus,
	TurnState,
	type ChatState,
	type SessionState,
	type SessionSummary
} from '@microsoft/agent-host-protocol';
import { actionForControl, commandForAction, dashboardPage } from '../src/dashboard.js';
import type { SelectedSession } from '../src/types.js';

const sessionResource = 'copilotcli:/fixture';
const chatResource = 'ahp-chat://default/fixture';

function selectedSession(inputNeeded: SessionState['inputNeeded'] = undefined): SelectedSession {
	const summary: SessionSummary = {
		resource: sessionResource,
		provider: 'copilotcli',
		title: 'Fixture Session',
		status: SessionStatus.InputNeeded,
		createdAt: '2026-09-09T00:00:00.000Z',
		modifiedAt: '2026-09-09T00:00:00.000Z'
	};
	const chat: ChatState = {
		resource: chatResource,
		title: 'Default',
		status: SessionStatus.InputNeeded,
		modifiedAt: summary.modifiedAt,
		turns: []
	};
	const session: SessionState = {
		provider: summary.provider,
		title: summary.title,
		status: summary.status,
		lifecycle: SessionLifecycle.Ready,
		activeClients: [],
		chats: [{
			resource: chatResource,
			title: chat.title,
			status: chat.status,
			modifiedAt: chat.modifiedAt
		}],
		defaultChat: chatResource,
		...(inputNeeded ? { inputNeeded } : {})
	};
	return { summary, session, chat };
}

test('renders an armed dashboard action as a visible confirmation', () => {
	const selected = selectedSession();
	const page = dashboardPage(selected, { action: 'archive', readyAt: 1000, expiresAt: 6000 }, 1000);
	assert.deepEqual(
		{
			tileCount: page.tiles.length,
			archiveTile: page.tiles[4],
			statusTile: page.tiles[1]
		},
		{
			tileCount: 9,
			archiveTile: {
				title: 'CONFIRM',
				label: 'ARCHIVE',
				background: '#1f1f1f',
				icon: 'check',
				accent: '#ff9d00',
				selected: true
			},
			statusTile: {
				title: 'Fixture Session',
				label: 'INPUT NEEDED',
				background: '#1f1f1f',
				icon: 'agent',
				accent: '#a85f00'
			}
		}
	);
});

test('builds a typed approval command for an unambiguous tool confirmation', () => {
	const selected = selectedSession([{
		id: 'input-1',
		kind: SessionInputRequestKind.ToolConfirmation,
		chat: chatResource,
		turnId: 'turn-1',
		toolCall: {
			status: ToolCallStatus.PendingConfirmation,
			toolCallId: 'tool-1',
			toolName: 'write_file',
			displayName: 'Write File',
			invocationMessage: 'Write a file'
		}
	}]);
	assert.deepEqual(commandForAction('approve', selected), {
		channel: chatResource,
		action: {
			type: ActionType.ChatToolCallConfirmed,
			turnId: 'turn-1',
			toolCallId: 'tool-1',
			approved: true,
			confirmed: 'user-action'
		},
		description: 'approval of Write File'
	});
});

test('requires VS Code when a tool exposes multiple approval scopes', () => {
	const selected = selectedSession([{
		id: 'input-1',
		kind: SessionInputRequestKind.ToolConfirmation,
		chat: chatResource,
		turnId: 'turn-1',
		toolCall: {
			status: ToolCallStatus.PendingConfirmation,
			toolCallId: 'tool-1',
			toolName: 'write_file',
			displayName: 'Write File',
			invocationMessage: 'Write a file',
			options: [
				{ id: 'once', label: 'Allow Once', kind: ConfirmationOptionKind.Approve },
				{ id: 'session', label: 'Allow in Session', kind: ConfirmationOptionKind.Approve }
			]
		}
	}]);
	assert.deepEqual({
		controlAction: actionForControl(7, selected),
		command: commandForAction('approve', selected),
		tile: dashboardPage(selected, undefined, 0).tiles[6]
	}, {
		controlAction: undefined,
		command: undefined,
		tile: {
			title: 'CHOOSE IN',
			label: 'VS CODE',
			background: '#1f1f1f',
			icon: 'info',
			accent: '#cca700'
		}
	});
});

test('shows the latest tool call with compact session change statistics', () => {
	const base = selectedSession();
	const selected: SelectedSession = {
		...base,
		summary: {
			...base.summary,
			changes: { files: 2, additions: 14, deletions: 3 }
		},
		chat: {
			...base.chat!,
			turns: [{
				id: 'turn-1',
				message: { text: 'Update the workspace', origin: { kind: MessageKind.User } },
				responseParts: [{
					kind: ResponsePartKind.ToolCall,
					toolCall: {
						status: ToolCallStatus.Streaming,
						toolCallId: 'tool-1',
						toolName: 'write_file',
						displayName: 'Write Workspace File'
					}
				}],
				usage: undefined,
				state: TurnState.Complete
			}]
		}
	};

	assert.deepEqual(dashboardPage(selected, undefined, 0).tiles[8], {
		title: 'Write Workspace\nFile',
		label: 'STREAMING\n1T  2F  +14  -3',
		icon: 'tools',
		accent: '#4ec9b0',
		background: '#1f1f1f'
	});
});
