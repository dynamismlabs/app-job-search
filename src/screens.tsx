import React, { useEffect, useState } from "react";
import { Routes, Route } from "react-router";
import { ConnectionSettings, ConsentScreen } from "@app-builder/core/react";
import { RiAppProvider } from "./view/kit/app.js";
import { JobSearchApp } from "./view/app.js";
import { JOB_SEARCH_CSS } from "./view/styles.js";
import { locationFrom } from "./view/location.js";
import { routeSection } from "./view/route.js";
import { OpportunitiesCard, TodayCard } from "./view/cards.js";
import type { ViewState } from "./api/view.js";

/** The setup state plus the place in the address: what the screens open with. */
function toData(state: unknown, path: string, query: Record<string, string>) {
  const view = state as ViewState;
  const location = locationFrom(path, query, view.landing);
  return { mode: "app" as const, path, query, ...routeSection(location), ...view };
}

/**
 * Job Search's screens. They draw on the client only: they were built for a
 * view that loads everything through actions, and the server renders the
 * app's shell around them.
 */
export function JobSearch() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return <main className="js-loading" aria-busy="true">Opening Job Search…</main>;
  return <RiAppProvider stateAction="get_view_state" toData={toData} css={JOB_SEARCH_CSS}><JobSearchApp /></RiAppProvider>;
}

/** Cards for the app's show_* tools. Anything else in an assistant draws the whole app. */
export const viewCards = { show_opportunities: OpportunitiesCard, show_today: TodayCard };

export function AppScreens() {
  return <Routes>
    <Route path="/settings" element={<ConnectionSettings />} />
    <Route path="/oauth/consent" element={<ConsentScreen />} />
    <Route path="*" element={<JobSearch />} />
  </Routes>;
}
