/** @jsxRuntime automatic */
/**
 * The Job Search view: Today, Opportunities (board and table), the
 * opportunity workspace, interview preparation, Materials and Sources. The
 * location (section, record, filters) is remembered in Ri's URL so Back and
 * reopening return to the same place.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell, Button, EmptyState, LoadingState, Notice, SectionPanel, SectionTabs, useQuery, useRiApp } from './ui.js';
import type { Stage } from '../domain/labels.js';

import { TodayView } from './today.js';
import { OpportunitiesView } from './opportunities.js';
import { OpportunityWorkspace } from './workspace.js';
import { PreparationView } from './preparation.js';
import { MaterialsView } from './materials.js';
import { SourcesView } from './sources.js';
import { SaveJobDialog } from './dialogs.js';
import type { SourceSummary, ViewData } from './types.js';
import { locationFrom, pathOf, type Location, type Tab } from './location.js';
import { OpenInBrowser } from '@app-builder/core/react';


export function JobSearchApp() {
  const app = useRiApp<ViewData>();
  const data = app.data;
  if (!data && app.error) return <AppShell eyebrow="Job Search" title="Your next move"><Notice tone="danger" title="Job Search could not open">{app.error}</Notice></AppShell>;
  if (!data) return <AppShell eyebrow="Job Search" title="Your next move"><LoadingState label="Opening Job Search" /></AppShell>;

  return <Main data={data} />;
}

function Main({ data }: { data: ViewData }) {
  const app = useRiApp<ViewData>();
  // The place is the address (the browser's, or the view's own memory router). It's the one
  // source of truth, so a host's link, Back and Forward and the screens' own moves never race.
  const location = useMemo(() => locationFrom(data.path, data.query, data.landing), [data.path, data.query, data.landing]);
  const current = useRef(location);
  current.current = location;
  const [saveOpen, setSaveOpen] = useState<null | { opportunityId?: string }>(null);
  const moveTo = useCallback((next: Location) => {
    const before = current.current;
    const path = pathOf(next);
    if (path === pathOf(before)) return;
    current.current = next; // several moves in one event build on each other
    // An opportunity selected beside the board is a place Back closes, and closing it goes Back the way the person came.
    if (!before.selected && next.selected) app.setLocation(path, { push: true });
    else if (before.selected && !next.selected && pathOf({ ...before, selected: null }) === path) app.goBack(path);
    else app.setLocation(path);
  }, [app]);
  const go = useCallback((patch: Partial<Location> | ((current: Location) => Partial<Location>)) => moveTo({ ...current.current, ...(typeof patch === 'function' ? patch(current.current) : patch) }), [moveTo]);
  /** Close what is open: Back the way the person came, or to the place `patch` names when they arrived here directly. */
  const back = useCallback((patch: Partial<Location>) => {
    const next = { ...current.current, ...patch };
    current.current = next;
    app.goBack(pathOf(next));
  }, [app]);
  const sources = useQuery<{ sources: SourceSummary[] }>('list_sources', {}, { enabled: data.owner });
  const attention = useMemo(() => (sources.data?.sources ?? []).filter((source) => source.granted && (source.status === 'reconnect' || source.status === 'error')), [sources.data]);
  const empty = data.owner && data.setup.opportunities === 0 && data.setup.materials === 0;

  const tabs = [
    { id: 'today', label: 'Today' },
    { id: 'opportunities', label: 'Opportunities' },
    { id: 'materials', label: 'Materials' },
    { id: 'sources', label: 'Sources', badge: data.setup.review > 0 ? data.setup.review : undefined },
  ];
  const changeTab = (tab: string) => go({ tab: tab as Tab, opportunityId: null, prepare: null, materialId: tab === 'materials' ? location.materialId : null, section: null });

  const notice = attention.length ? (
    <Notice tone="warning" title={attention[0].status === 'reconnect' ? `${attention[0].label} needs to be reconnected in Ri` : `Updates from ${attention[0].label} stopped`} action={<Button size="sm" onClick={() => void app.openSources()}>Manage access</Button>}>
      {attention[0].status === 'reconnect' ? 'Your saved opportunities and correspondence are kept. Coverage stops at the last successful update until you reconnect.' : attention[0].lastError ?? 'The last update did not finish. Open Sources to continue.'}
    </Notice>
  ) : undefined;

  let body;
  if (empty && location.tab !== 'sources') {
    body = (
      <EmptyState
        title="Start with a job you are considering"
        action={<><Button variant="primary" onClick={() => setSaveOpen({})}>Save a job</Button><Button onClick={() => void app.openSources()}>Connect email</Button>{<Button variant="quiet" onClick={() => void app.call('load_preview', {}, { invocationId: crypto.randomUUID() }).then(() => app.changed('Loaded the fictional preview'))}>Try with fictional records</Button>}</>}
      >
        <p>Save a job with its description so it stays available even if the posting disappears. Then add your résumé, record applications and prepare for interviews in one place.</p>
        <p className="ri-small" style={{ marginTop: '0.75rem' }}>Connecting email is optional. It reads application, interview and offer mail from the last 90 days by default, and only from the account you choose.</p>
      </EmptyState>
    );
  } else if (location.prepare) {
    body = <PreparationView key={`${location.prepare.opportunityId}:${location.prepare.interviewId}`} target={location.prepare} onBack={() => back({ prepare: null })} backLabel={location.opportunityId ? 'Back to the opportunity' : 'Back to opportunities'} go={go} />;
  } else if (location.tab === 'today') {
    body = <TodayView go={go} onSaveJob={() => setSaveOpen({})} />;
  } else if (location.tab === 'opportunities') {
    body = (
      <OpportunitiesView
        location={location}
        go={go}
        onSaveJob={() => setSaveOpen({})}
        workspace={location.opportunityId ? <OpportunityWorkspace key={location.opportunityId} id={location.opportunityId} section={location.section} go={go} onAddDescription={() => setSaveOpen({ opportunityId: location.opportunityId! })} /> : null}
      />
    );
  } else if (location.tab === 'materials') {
    body = <MaterialsView selectedId={location.materialId} onSelect={(materialId) => go({ materialId })} />;
  } else {
    body = <SourcesView owner={data.owner} go={go} />;
  }

  return (
    <AppShell
      eyebrow="Job Search"
      title={empty ? 'Keep your next opportunity together' : 'Your next move'}
      context={data.fictional ? <span className="js-badge-fictional">Fictional preview records. Nothing here is real or sent anywhere.{data.onlyFictional && <> <Button variant="link" size="sm" onClick={() => void app.call('clear_preview', {}, { invocationId: crypto.randomUUID() }).then(() => app.changed('Removed the fictional preview'))}>Remove them</Button></>}</span> : 'Your opportunities, conversations and preparation in one place.'}
      primaryAction={data.owner && !empty ? <Button variant="primary" onClick={() => setSaveOpen({})}>Save a job</Button> : undefined}
      secondaryActions={app.embedded ? <OpenInBrowser className="ri-button ri-button--quiet" /> : undefined}
      tabs={<SectionTabs label="Job Search sections" panelId="js-panel" value={location.tab} onChange={changeTab} items={tabs} />}
      notice={notice}
    >
      <SectionPanel panelId="js-panel" value={location.tab}>{body}</SectionPanel>
      {saveOpen && (
        <SaveJobDialog
          open
          attachTo={saveOpen.opportunityId ?? null}
          onClose={() => setSaveOpen(null)}
          onSaved={(opportunityId) => {
            setSaveOpen(null);
            if (opportunityId) go({ tab: 'opportunities', opportunityId, selected: opportunityId, prepare: null, section: null });
          }}
        />
      )}
    </AppShell>
  );
}
