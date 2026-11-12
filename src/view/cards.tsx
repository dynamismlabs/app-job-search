/** @jsxRuntime automatic */
/**
 * The cards the show_* tools draw in an assistant's chat: a snapshot of
 * opportunities or of today, each line selectable so the assistant knows
 * which one the person means, and a way into the whole app.
 */
import { useEffect, useInsertionEffect } from 'react';
import { useAppClient, ViewCard } from '@app-builder/core/react';
import { installStyles } from './kit/styles.js';
import { StatusLabel } from './kit/feedback.js';
import { JOB_SEARCH_CSS } from './styles.js';
import { locationText, nextText, stageText, whenText } from './format.js';
import type { OpportunitySummary, TodayData } from './types.js';

function useCardStyles() {
  useInsertionEffect(() => { installStyles(JOB_SEARCH_CSS); }, []);
}

export function OpportunitiesCard({ data }: { data: { title: string; items: OpportunitySummary[]; more: boolean; total: number } }) {
  const client = useAppClient();
  useCardStyles();
  useEffect(() => () => client.select(null), [client]);
  return (
    <ViewCard title={data.title} count={data.items.length ? `${data.items.length}${data.more ? ` of ${data.total}` : ''}` : undefined} footer={data.more ? `More in ${client.config.name}.` : undefined}>
      {data.items.length ? (
        <ul className="view-list">
          {data.items.map((item) => (
            <li key={item.id} className="view-row">
              <button type="button" className="view-row-body" onClick={() => client.select({ id: item.id, title: `${item.company} · ${item.role}` })}>
                <strong>{item.company}</strong>
                <span>{item.role}{locationText(item) ? ` · ${locationText(item)}` : ''}</span>
                <span className="ri-small ri-muted">{nextText(item.next)}</span>
              </button>
              <StatusLabel tone={item.stage === 'offer' ? 'success' : item.stage === 'closed' ? 'neutral' : 'info'}>{stageText(item.stage, item.outcome)}</StatusLabel>
            </li>
          ))}
        </ul>
      ) : <p className="view-empty">No opportunities match.</p>}
    </ViewCard>
  );
}

export function TodayCard({ data }: { data: TodayData }) {
  const client = useAppClient();
  useCardStyles();
  useEffect(() => () => client.select(null), [client]);
  const empty = !data.interviews.length && !data.scheduling.length && !data.deadlines.length && !data.responses.length;
  return (
    <ViewCard title="Today in your job search">
      {empty && <p className="view-empty">Nothing needs attention today.</p>}
      {data.interviews.length > 0 && (
        <section aria-label="Upcoming interviews">
          <h2 className="ri-h3">Interviews</h2>
          <ul className="view-list">{data.interviews.map((item) => (
            <li key={item.interviewId} className="view-row">
              <button type="button" className="view-row-body" onClick={() => client.select({ id: item.interviewId, title: `${item.title} at ${item.company}` })}>
                <strong>{item.company} · {item.role}</strong>
                <span>{item.title}</span>
                <span className="ri-small ri-muted">{whenText(item.startAt, item.zone)}{item.prepared ? ' · Prepared' : ''}</span>
              </button>
            </li>
          ))}</ul>
        </section>
      )}
      {data.scheduling.length > 0 && (
        <section aria-label="Waiting for a time">
          <h2 className="ri-h3">Choose a time</h2>
          <ul className="view-list">{data.scheduling.map((item) => <li key={item.interviewId} className="view-row"><span className="view-row-body"><strong>{item.company} · {item.role}</strong><span>{item.title}. No time is confirmed yet.</span></span></li>)}</ul>
        </section>
      )}
      {data.deadlines.length > 0 && (
        <section aria-label="Deadlines and next actions">
          <h2 className="ri-h3">Deadlines and next actions</h2>
          <ul className="view-list">{data.deadlines.slice(0, 8).map((item, index) => <li key={`${item.opportunityId}-${index}`} className="view-row"><span className="view-row-body"><strong>{item.label}</strong><span>{item.company} · {item.role}{item.date ? ` · ${item.date}` : ''}{item.overdue ? ' · Overdue' : ''}</span></span></li>)}</ul>
        </section>
      )}
      {data.responses.length > 0 && <p className="ri-small">{data.responses.length} response{data.responses.length === 1 ? '' : 's'} waiting for your review in {client.config.name}.</p>}
    </ViewCard>
  );
}
