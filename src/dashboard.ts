import {
	ActionType,
	ChatInputResponseKind,
	ConfirmationOptionKind,
	ResponsePartKind,
	SessionInputRequestKind,
	SessionStatus,
	ToolCallCancellationReason,
	ToolCallConfirmationReason,
	ToolCallStatus,
	TurnState,
	type SessionInputRequest,
	type StateAction
} from '@microsoft/agent-host-protocol';
import type { CodiconName, DashboardPage, DisplayTile, SelectedSession } from './types.js';

export const CONFIRMATION_TIMEOUT_MS = 5000;

export type DashboardAction = 'back' | 'read' | 'archive' | 'cancel' | 'resume' | 'approve' | 'reject';

export interface ArmedDashboardAction {
	action: DashboardAction;
	readyAt: number;
	expiresAt: number;
}

export interface DashboardCommand {
	channel: string;
	action: StateAction;
	description: string;
}

export function dashboardPage(selected: SelectedSession, armed: ArmedDashboardAction | undefined, now: number): DashboardPage {
	const session = selected.session;
	const chat = selected.chat;
	const input = actionableInput(session?.inputNeeded);
	const activeArmed = armed && armed.expiresAt > now ? armed : undefined;
	const workspace = session?.project?.displayName
		?? displayWorkspace(session?.workingDirectories?.[0])
		?? 'NO WORKSPACE';
	const activity = session?.activity ?? selected.summary.activity ?? chat?.activity ?? 'WAITING';
	const status = selected.summary.status;
	const stats = sessionStats(selected);
	const turnAction = chat?.activeTurn
		? tileForAction('cancel', 'CANCEL', 'ACTIVE TURN', 'debug-stop', '#f14c4c', activeArmed)
		: resumableTurnId(chat)
			? tileForAction('resume', 'RESUME', 'FAILED TURN', 'play', '#c586c0', activeArmed)
			: infoTile('NO ACTIVE', 'TURN', 'pulse', '#6e7681');
	const [positiveInputTile, negativeInputTile] = input
		? inputActionTiles(input, activeArmed)
		: [
			infoTile('NO INPUT', 'REQUEST', 'info', '#6e7681'),
			infoTile('ALL CLEAR', 'READY', 'check', '#4ec9b0')
		] as const;

	const tiles = [
		infoTile('BACK', selected.summary.provider.toUpperCase(), 'arrow-left', '#8b949e'),
		infoTile(wrapLabel(selected.summary.title, 15, 2), statusText(status), 'agent', statusBackground(status)),
		infoTile(wrapLabel(activity, 15, 2), 'ACTIVITY', 'pulse', '#3794ff'),
		tileForAction('read', hasStatus(status, SessionStatus.IsRead) ? 'UNREAD' : 'MARK READ', 'SESSION', hasStatus(status, SessionStatus.IsRead) ? 'eye-closed' : 'eye', '#9cdcfe', activeArmed),
		tileForAction('archive', hasStatus(status, SessionStatus.IsArchived) ? 'RESTORE' : 'ARCHIVE', 'SESSION', hasStatus(status, SessionStatus.IsArchived) ? 'sync' : 'archive', '#cca700', activeArmed),
		turnAction,
		positiveInputTile,
		negativeInputTile,
		infoTile(stats.latestTool ?? wrapLabel(workspace, 15, 2), stats.label, stats.latestTool ? 'tools' : 'folder', '#4ec9b0')
	];
	return {
		signature: tiles.map(tileSignature).join('|'),
		tiles
	};
}

export function actionForControl(controlId: number, selected: SelectedSession): DashboardAction | undefined {
	switch (controlId) {
		case 1: return 'back';
		case 4: return 'read';
		case 5: return 'archive';
		case 6: return selected.chat?.activeTurn ? 'cancel' : resumableTurnId(selected.chat) ? 'resume' : undefined;
		case 7: return approveCommand(selected) ? 'approve' : undefined;
		case 8: return rejectCommand(selected) ? 'reject' : undefined;
		default: return undefined;
	}
}

export function commandForAction(action: DashboardAction, selected: SelectedSession): DashboardCommand | undefined {
	const session = selected.session;
	const chat = selected.chat;
	switch (action) {
		case 'read':
			return {
				channel: selected.summary.resource,
				action: {
					type: ActionType.SessionIsReadChanged,
					isRead: !hasStatus(selected.summary.status, SessionStatus.IsRead)
				},
				description: 'session read state'
			};
		case 'archive':
			return {
				channel: selected.summary.resource,
				action: {
					type: ActionType.SessionIsArchivedChanged,
					isArchived: !hasStatus(selected.summary.status, SessionStatus.IsArchived)
				},
				description: 'session archive state'
			};
		case 'cancel':
			if (!chat?.activeTurn) {
				return undefined;
			}
			return {
				channel: chat.resource,
				action: {
					type: ActionType.ChatTurnCancelled,
					turnId: chat.activeTurn.id,
					duration: Math.max(0, nowDuration(chat.activeTurn.startedAt))
				},
				description: 'active turn cancellation'
			};
		case 'resume': {
			const turnId = resumableTurnId(chat);
			return turnId && chat ? {
				channel: chat.resource,
				action: { type: ActionType.ChatTurnResume, turnId },
				description: 'failed turn resume'
			} : undefined;
		}
		case 'approve':
			return approveCommand(selected);
		case 'reject':
			return rejectCommand(selected);
		default:
			return undefined;
	}
}

function approveCommand(selected: SelectedSession): DashboardCommand | undefined {
	const input = actionableInput(selected.session?.inputNeeded);
	if (!input) {
		return undefined;
	}
	if (input.kind === SessionInputRequestKind.ToolConfirmation) {
		const options = input.toolCall.status === ToolCallStatus.PendingConfirmation ? input.toolCall.options : undefined;
		const matchingOptions = options?.filter(candidate => candidate.kind === ConfirmationOptionKind.Approve);
		if (options && matchingOptions?.length !== 1) {
			return undefined;
		}
		const option = matchingOptions?.[0];
		return {
			channel: input.chat,
			action: input.toolCall.status === ToolCallStatus.PendingResultConfirmation
				? {
					type: ActionType.ChatToolCallResultConfirmed,
					turnId: input.turnId,
					toolCallId: input.toolCall.toolCallId,
					approved: true
				}
				: {
					type: ActionType.ChatToolCallConfirmed,
					turnId: input.turnId,
					toolCallId: input.toolCall.toolCallId,
					approved: true,
					confirmed: ToolCallConfirmationReason.UserAction,
					...(option ? { selectedOptionId: option.id } : {})
				},
			description: `approval of ${input.toolCall.displayName}`
		};
	}
	if (input.kind === SessionInputRequestKind.ChatInput && canAcceptInput(input)) {
		return {
			channel: input.chat,
			action: {
				type: ActionType.ChatInputCompleted,
				requestId: input.request.id,
				response: ChatInputResponseKind.Accept,
				...(input.request.answers ? { answers: input.request.answers } : {})
			},
			description: 'input acceptance'
		};
	}
	return undefined;
}

function rejectCommand(selected: SelectedSession): DashboardCommand | undefined {
	const input = actionableInput(selected.session?.inputNeeded);
	if (!input) {
		return undefined;
	}
	if (input.kind === SessionInputRequestKind.ToolConfirmation) {
		const options = input.toolCall.status === ToolCallStatus.PendingConfirmation ? input.toolCall.options : undefined;
		const matchingOptions = options?.filter(candidate => candidate.kind === ConfirmationOptionKind.Deny);
		if (options && matchingOptions?.length !== 1) {
			return undefined;
		}
		const option = matchingOptions?.[0];
		return {
			channel: input.chat,
			action: input.toolCall.status === ToolCallStatus.PendingResultConfirmation
				? {
					type: ActionType.ChatToolCallResultConfirmed,
					turnId: input.turnId,
					toolCallId: input.toolCall.toolCallId,
					approved: false
				}
				: {
					type: ActionType.ChatToolCallConfirmed,
					turnId: input.turnId,
					toolCallId: input.toolCall.toolCallId,
					approved: false,
					reason: ToolCallCancellationReason.Denied,
					...(option ? { selectedOptionId: option.id } : {})
				},
			description: `rejection of ${input.toolCall.displayName}`
		};
	}
	if (input.kind === SessionInputRequestKind.ChatInput) {
		return {
			channel: input.chat,
			action: {
				type: ActionType.ChatInputCompleted,
				requestId: input.request.id,
				response: ChatInputResponseKind.Decline
			},
			description: 'input decline'
		};
	}
	return undefined;
}

function inputActionTiles(input: SessionInputRequest, armed: ArmedDashboardAction | undefined): [DisplayTile, DisplayTile] {
	if (input.kind === SessionInputRequestKind.ToolConfirmation) {
		const approveAvailable = approveCommandForInput(input) !== undefined;
		const rejectAvailable = rejectCommandForInput(input) !== undefined;
		return [
			approveAvailable
				? tileForAction('approve', 'APPROVE', wrapLabel(input.toolCall.displayName, 14, 2), 'check', '#4ec9b0', armed)
				: infoTile('CHOOSE IN', 'VS CODE', 'info', '#cca700'),
			rejectAvailable
				? tileForAction('reject', 'REJECT', wrapLabel(input.toolCall.displayName, 14, 2), 'close', '#f14c4c', armed)
				: infoTile('CHOOSE IN', 'VS CODE', 'info', '#cca700')
		];
	}

	function approveCommandForInput(input: Extract<SessionInputRequest, { kind: SessionInputRequestKind.ToolConfirmation }>): boolean | undefined {
		const options = input.toolCall.status === ToolCallStatus.PendingConfirmation ? input.toolCall.options : undefined;
		return !options || options.filter(candidate => candidate.kind === ConfirmationOptionKind.Approve).length === 1
			? true
			: undefined;
	}

	function rejectCommandForInput(input: Extract<SessionInputRequest, { kind: SessionInputRequestKind.ToolConfirmation }>): boolean | undefined {
		const options = input.toolCall.status === ToolCallStatus.PendingConfirmation ? input.toolCall.options : undefined;
		return !options || options.filter(candidate => candidate.kind === ConfirmationOptionKind.Deny).length === 1
			? true
			: undefined;
	}
	if (input.kind === SessionInputRequestKind.ChatInput) {
		return [
			canAcceptInput(input)
				? tileForAction('approve', 'ACCEPT', 'INPUT', 'check', '#4ec9b0', armed)
				: infoTile('OPEN IN', 'VS CODE', 'info', '#cca700'),
			tileForAction('reject', 'DECLINE', 'INPUT', 'close', '#f14c4c', armed)
		];
	}
	return [
		infoTile('ACTION', 'VS CODE', 'info', '#cca700'),
		infoTile('BLOCKED', input.kind === SessionInputRequestKind.ToolAuthentication ? 'AUTH' : 'CLIENT TOOL', 'close', '#f14c4c')
	];
}

function actionableInput(inputNeeded: readonly SessionInputRequest[] | undefined): SessionInputRequest | undefined {
	return inputNeeded?.find(input => input.kind !== SessionInputRequestKind.ToolClientExecution) ?? inputNeeded?.[0];
}

function canAcceptInput(input: Extract<SessionInputRequest, { kind: SessionInputRequestKind.ChatInput }>): boolean {
	const questions = input.request.questions ?? [];
	return questions.length === 0 || questions.every(question => !question.required || input.request.answers?.[question.id] !== undefined);
}

function resumableTurnId(chat: SelectedSession['chat']): string | undefined {
	const turn = chat?.turns.at(-1);
	const lastPart = turn?.responseParts.at(-1);
	return turn?.state === TurnState.Error && lastPart?.kind === ResponsePartKind.Error && lastPart.resumable
		? turn.id
		: undefined;
}

function tileForAction(action: DashboardAction, title: string, label: string, icon: CodiconName, accent: string, armed: ArmedDashboardAction | undefined): DisplayTile {
	const isArmed = armed?.action === action;
	return {
		...infoTile(isArmed ? 'CONFIRM' : title, isArmed ? title : label, isArmed ? 'check' : icon, isArmed ? '#ff9d00' : accent),
		...(isArmed ? { selected: true } : {})
	};
}

function infoTile(title: string, label: string, icon: CodiconName, accent: string): DisplayTile {
	return { title, label, icon, accent, background: '#1f1f1f' };
}

function statusText(status: SessionStatus): string {
	if (hasStatus(status, SessionStatus.InputNeeded)) {
		return 'INPUT NEEDED';
	}
	if (hasStatus(status, SessionStatus.Error)) {
		return 'ERROR';
	}
	if (hasStatus(status, SessionStatus.InProgress)) {
		return 'RUNNING';
	}
	return 'IDLE';
}

function statusBackground(status: SessionStatus): string {
	switch (statusText(status)) {
		case 'INPUT NEEDED': return '#a85f00';
		case 'ERROR': return '#8b1e2d';
		case 'RUNNING': return '#125a9c';
		default: return '#275d38';
	}
}

function sessionStats(selected: SelectedSession): { latestTool: string | undefined; label: string } {
	const turns = selected.chat?.turns.length ?? 0;
	const activeTurn = selected.chat?.activeTurn;
	const responseParts = [
		...(activeTurn?.responseParts.toReversed() ?? []),
		...(selected.chat?.turns.toReversed().flatMap(turn => turn.responseParts.toReversed()) ?? [])
	];
	const latestTool = responseParts.find(part => part.kind === ResponsePartKind.ToolCall);
	const changes = selected.summary.changes;
	const counts = [
		`${turns + (activeTurn ? 1 : 0)}T`,
		changes?.files !== undefined ? `${changes.files}F` : undefined,
		changes?.additions !== undefined ? `+${changes.additions}` : undefined,
		changes?.deletions !== undefined ? `-${changes.deletions}` : undefined
	].filter(value => value !== undefined).join('  ');
	return {
		latestTool: latestTool ? wrapLabel(latestTool.toolCall.displayName, 15, 2) : undefined,
		label: latestTool ? `${latestTool.toolCall.status.toUpperCase()}\n${counts}` : counts || `${selected.session?.chats.length ?? 0} CHAT(S)`
	};
}

function hasStatus(status: SessionStatus, flag: SessionStatus): boolean {
	return (status & flag) === flag;
}

function displayWorkspace(resource: string | undefined): string | undefined {
	if (!resource) {
		return undefined;
	}
	try {
		const url = new URL(resource);
		return decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? url.hostname);
	} catch {
		return resource.split('/').filter(Boolean).at(-1);
	}
}

function nowDuration(startedAt: string): number {
	const started = Date.parse(startedAt);
	return Number.isFinite(started) ? Date.now() - started : 0;
}

function shorten(value: string, maximum: number): string {
	return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function wrapLabel(value: string, maximum: number, maximumLines: number): string {
	const words = value.trim().split(/\s+/);
	const lines: string[] = [];
	for (const word of words) {
		const current = lines.at(-1);
		if (!current || current.length + 1 + word.length > maximum) {
			if (lines.length === maximumLines) {
				lines[maximumLines - 1] = shorten(`${lines[maximumLines - 1]} ${word}`, maximum);
				break;
			}
			lines.push(shorten(word, maximum));
		} else {
			lines[lines.length - 1] = `${current} ${word}`;
		}
	}
	return lines.join('\n');
}

function tileSignature(tile: DisplayTile): string {
	return `${tile.title}:${tile.label}:${tile.background}:${tile.icon ?? ''}:${tile.accent ?? ''}:${tile.selected ?? false}`;
}
