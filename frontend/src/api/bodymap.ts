/**
 * T-6 body map status: pure functions, no thresholds of their own. A region's colour is the highest severity among
 * the open alerts of its rules (config/selftests.yaml `body_map`) for this crew member, plus cabin-wide alerts
 * (crew_id null), which concern everyone on board. Only open alerts count (raised, acknowledged, in treatment). No alert = ✓ nominal.
 */
import { AlertItem, BodyRegion, CrewId, Severity } from './types';

const RANK: Record<Severity, number> = { INFO: 0, CAUTION: 1, WARNING: 2, EMERGENCY: 3 };
const OPEN = new Set(['RAISED', 'ACKNOWLEDGED', 'IN_TREATMENT']);

export interface RegionStatus {
  severity: Severity | null;
  alerts: AlertItem[];
}

export function regionAlerts(region: BodyRegion, alerts: AlertItem[], crewId: CrewId): AlertItem[] {
  const ids = new Set(region.rules.map((r) => r.id));
  return alerts
    .filter((a) => OPEN.has(a.state) && ids.has(a.rule_id) && (a.crew_id === crewId || a.crew_id === null))
    .sort((a, b) => RANK[b.severity] - RANK[a.severity]);
}

export function regionStatus(region: BodyRegion, alerts: AlertItem[], crewId: CrewId): RegionStatus {
  const mine = regionAlerts(region, alerts, crewId);
  return { severity: mine[0]?.severity ?? null, alerts: mine };
}

/** Plain status line; never a diagnosis ("Indicators consistent with … / Recommend CMO review"). */
export function regionStatusText(region: BodyRegion, status: RegionStatus): string {
  if (!status.severity) return `✓ No open alerts linked to ${region.label.toLowerCase()}.`;
  const titles = status.alerts.map((a) => a.title.replace(/[.\s]+$/, '')).filter((t, i, all) => all.indexOf(t) === i);
  const head = status.severity === 'INFO' ? 'Note' : 'Indicators consistent with';
  return `${head}: ${titles.join('; ')}. Recommend CMO review.`;
}
