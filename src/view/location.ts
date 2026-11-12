/**
 * Where the person is in Job Search: section, open record and filters. It
 * lives in the address (the browser's, or the assistant view's own memory
 * router), so Back and reopening return to the same place.
 */
import type { Stage } from '../domain/labels.js';

export type Tab = 'today' | 'opportunities' | 'materials' | 'sources';
export interface Location {
  tab: Tab;
  /** The open opportunity workspace. */
  opportunityId: string | null;
  /** The open preparation workspace. */
  prepare: { opportunityId: string | null; interviewId: string | null } | null;
  materialId: string | null;
  /** The selected card, shown in the inspector at wide widths. */
  selected: string | null;
  mode: 'board' | 'table';
  view: 'active' | 'closed' | 'archived';
  search: string;
  stage: Stage | null;
  section: string | null;
}

const STAGES: Stage[] = ['saved', 'applied', 'interviewing', 'offer', 'closed'];

export function locationFrom(path: string, query: Record<string, string>, landing: 'today' | 'opportunities'): Location {
  const parts = path.split('/').filter(Boolean);
  const base: Location = {
    tab: landing, opportunityId: null, prepare: null, materialId: null, selected: query.selected ?? null,
    mode: query.mode === 'table' ? 'table' : 'board', view: query.view === 'closed' || query.view === 'archived' ? query.view : 'active',
    search: query.q ?? '', stage: STAGES.includes(query.stage as Stage) ? (query.stage as Stage) : null, section: query.tab ?? null,
  };
  if (parts[0] === 'today') return { ...base, tab: 'today' };
  if (parts[0] === 'opportunities') {
    if (parts[1] && parts[2] === 'prepare') return { ...base, tab: 'opportunities', prepare: { opportunityId: parts[1], interviewId: query.interview ?? null } };
    if (parts[1]) return { ...base, tab: 'opportunities', opportunityId: parts[1], selected: parts[1] };
    return { ...base, tab: 'opportunities' };
  }
  if (parts[0] === 'interviews' && parts[1]) return { ...base, tab: 'opportunities', prepare: { opportunityId: null, interviewId: parts[1] } };
  if (parts[0] === 'materials') return { ...base, tab: 'materials', materialId: parts[1] ?? null };
  if (parts[0] === 'sources' || parts[0] === 'review') return { ...base, tab: 'sources' };
  return base;
}

export function pathOf(location: Location): string {
  const query = new URLSearchParams();
  let path = `/${location.tab}`;
  if (location.prepare?.interviewId) {
    path = `/interviews/${location.prepare.interviewId}`;
  } else if (location.prepare?.opportunityId) {
    path = `/opportunities/${location.prepare.opportunityId}/prepare`;
  } else if (location.opportunityId) {
    path = `/opportunities/${location.opportunityId}`;
    if (location.section) query.set('tab', location.section);
  } else if (location.tab === 'materials' && location.materialId) path = `/materials/${location.materialId}`;
  if (location.tab === 'opportunities') {
    if (location.mode === 'table') query.set('mode', 'table');
    if (location.view !== 'active') query.set('view', location.view);
    if (location.search) query.set('q', location.search.slice(0, 100));
    if (location.stage) query.set('stage', location.stage);
    if (location.selected && !location.opportunityId && !location.prepare) query.set('selected', location.selected);
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}
