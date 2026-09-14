import { SessionStatus, type SessionSummary } from '@microsoft/agent-host-protocol';
import type { SessionPage } from './types.js';

export const PAGE_SIZE = 9;
export const PREVIOUS_PAGE_CONTROL_ID = 0x01a1;
export const NEXT_PAGE_CONTROL_ID = 0x01a2;

export class SessionPager {
	private allSessions: readonly SessionSummary[] = [];
	private sessions: readonly SessionSummary[] = [];
	private page = 0;

	update(sessions: readonly SessionSummary[]): SessionPage {
		this.allSessions = [...sessions].sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt));
		this.sessions = this.allSessions.filter(session => (session.status & SessionStatus.IsArchived) === 0);
		this.page = Math.min(this.page, Math.max(0, this.pageCount - 1));
		return this.current;
	}

	move(delta: number): SessionPage {
		const count = this.pageCount;
		this.page = count === 0 ? 0 : (this.page + delta + count) % count;
		return this.current;
	}

	sessionForControl(controlId: number): SessionSummary | undefined {
		if (controlId < 1 || controlId > PAGE_SIZE) {
			return undefined;
		}
		return this.current.sessions[controlId - 1];
	}

	sessionForResource(resource: string | undefined): SessionSummary | undefined {
		return resource ? this.allSessions.find(session => session.resource === resource) : undefined;
	}

	get current(): SessionPage {
		const start = this.page * PAGE_SIZE;
		return {
			page: this.page,
			pageCount: this.pageCount,
			sessions: this.sessions.slice(start, start + PAGE_SIZE)
		};
	}

	private get pageCount(): number {
		return Math.max(1, Math.ceil(this.sessions.length / PAGE_SIZE));
	}
}

export function statusLabel(status: SessionStatus): string {
	if ((status & SessionStatus.InputNeeded) === SessionStatus.InputNeeded) {
		return 'INPUT';
	}
	if ((status & SessionStatus.Error) !== 0) {
		return 'ERROR';
	}
	if ((status & SessionStatus.InProgress) !== 0) {
		return 'RUN';
	}
	return 'IDLE';
}

export function statusColor(status: SessionStatus): string {
	switch (statusLabel(status)) {
		case 'INPUT': return '#a85f00';
		case 'ERROR': return '#8b1e2d';
		case 'RUN': return '#125a9c';
		default: return '#275d38';
	}
}
