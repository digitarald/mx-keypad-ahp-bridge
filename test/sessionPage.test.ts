import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SessionStatus, type SessionSummary } from '@microsoft/agent-host-protocol';
import { SessionPager, statusLabel } from '../src/sessionPage.js';

function session(index: number, status = SessionStatus.Idle): SessionSummary {
	return {
		resource: `ahp-session:/${index}`,
		provider: 'test',
		title: `Session ${index}`,
		status,
		createdAt: new Date(index * 1000).toISOString(),
		modifiedAt: new Date(index * 1000).toISOString()
	};
}

test('orders sessions by recency and pages by nine', () => {
	const pager = new SessionPager();
	const first = pager.update(Array.from({ length: 10 }, (_, index) => session(index)));
	const second = pager.move(1);
	assert.deepEqual(
		{
			firstTitles: first.sessions.map(item => item.title),
			pageCount: first.pageCount,
			secondTitles: second.sessions.map(item => item.title)
		},
		{
			firstTitles: ['Session 9', 'Session 8', 'Session 7', 'Session 6', 'Session 5', 'Session 4', 'Session 3', 'Session 2', 'Session 1'],
			pageCount: 2,
			secondTitles: ['Session 0']
		}
	);
});

test('hides archived sessions from the grid while retaining them for dashboard restore', () => {
	const pager = new SessionPager();
	const archived = session(2, SessionStatus.Idle | SessionStatus.IsArchived);
	const page = pager.update([session(1), archived, session(3)]);
	assert.deepEqual({
		gridTitles: page.sessions.map(item => item.title),
		archivedSelection: pager.sessionForResource(archived.resource)?.title
	}, {
		gridTitles: ['Session 3', 'Session 1'],
		archivedSelection: 'Session 2'
	});
});

test('pages more than one hundred active sessions nine at a time', () => {
	const pager = new SessionPager();
	const archived = Array.from({ length: 8 }, (_, index) => session(200 + index, SessionStatus.Idle | SessionStatus.IsArchived));
	const first = pager.update([
		...Array.from({ length: 117 }, (_, index) => session(index)),
		...archived
	]);
	let last = first;
	for (let index = 1; index < first.pageCount; index++) {
		last = pager.move(1);
	}
	assert.deepEqual({
		pageCount: first.pageCount,
		firstTitles: first.sessions.map(item => item.title),
		lastPage: last.page,
		lastTitles: last.sessions.map(item => item.title)
	}, {
		pageCount: 13,
		firstTitles: ['Session 116', 'Session 115', 'Session 114', 'Session 113', 'Session 112', 'Session 111', 'Session 110', 'Session 109', 'Session 108'],
		lastPage: 12,
		lastTitles: ['Session 8', 'Session 7', 'Session 6', 'Session 5', 'Session 4', 'Session 3', 'Session 2', 'Session 1', 'Session 0']
	});
});

test('prioritizes input-needed bit combinations', () => {
	assert.equal(statusLabel(SessionStatus.InputNeeded | SessionStatus.IsRead), 'INPUT');
});
