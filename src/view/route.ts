import type { Location } from './location.js';
import type { Section } from './types.js';

/** The section and record a place shows, as Ri's opener reported them. */
export function routeSection(location: Location): { section: Section; id: string | null } {
  if (location.prepare) return { section: 'preparation', id: location.prepare.interviewId ?? location.prepare.opportunityId };
  if (location.opportunityId) return { section: 'opportunity', id: location.opportunityId };
  if (location.tab === 'materials') return { section: 'materials', id: location.materialId };
  return { section: location.tab, id: null };
}
