import React, { useEffect, useMemo, useState } from 'react';
import { backendApi } from '../api/backend';
import { Inspiration4Panel as PanelData, ReferenceAnalyte, ReferencePoint } from '../api/types';
import { DataSourceBadge } from './DataSourceBadge';
// Offline fallback (AGENTS.md rule 1): the same aggregate file the backend serves, bundled at build time.
import bundledCsv from '../../../data/nasa/derived/inspiration4_cbc_cmp_aggregate.csv?raw';

/** P-6 (ROADMAP §0.3): Inspiration4 aggregate CBC/CMP reference. Plain-language first, all analytes on request. */

const KEY_ANALYTES = [
  'HEMOGLOBIN',
  'WHITE BLOOD CELL COUNT',
  'ABSOLUTE LYMPHOCYTES',
  'PLATELET COUNT',
  'GLUCOSE',
  'CALCIUM',
  'CREATININE',
  'POTASSIUM',
];

const PLAIN: Record<string, string> = {
  HEMOGLOBIN: 'Hemoglobin (oxygen carrier)',
  'WHITE BLOOD CELL COUNT': 'White blood cells (immune)',
  'ABSOLUTE LYMPHOCYTES': 'Lymphocytes (immune)',
  'PLATELET COUNT': 'Platelets (clotting)',
  GLUCOSE: 'Glucose (blood sugar)',
  CALCIUM: 'Calcium (bone loss marker)',
  CREATININE: 'Creatinine (kidney)',
  POTASSIUM: 'Potassium (heart rhythm)',
};

const PRE = ['L-92', 'L-44', 'L-3'];
const POST = 'R+1';
const OFFLINE_ID = 'osdr_inspiration4_cbc_cmp';

function num(text: string | undefined): number | null {
  if (text === undefined || text.trim() === '') return null;
  const v = Number(text);
  return Number.isFinite(v) ? v : null;
}

/** Splits one CSV line; the bundled file quotes fields that contain commas. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Parses the bundled aggregate CSV into the API shape. Refuses per-person columns, like the backend. */
export function parseInspiration4Csv(text: string): PanelData {
  const lines = text.split(/\r?\n/);
  const comment = lines.find((l) => l.startsWith('#'))?.replace(/^#\s*/, '') ?? '';
  const body = lines.filter((l) => l.trim() && !l.startsWith('#'));
  const header = splitCsv(body[0] ?? '').map((h) => h.trim().toLowerCase());
  const empty: PanelData = {
    available: false,
    title: 'Inspiration4 crew blood panels (CBC, CMP): pre- and post-flight',
    provenance: 'NASA_MEASURED',
    dataset_id: OFFLINE_ID,
    dataset: null,
    basis: `Bundled copy (offline). ${comment}`,
    timepoints: [...PRE, POST, 'R+45', 'R+82', 'R+194'],
    crew_n: null,
    min_cell_n: 3,
    analytes: [],
    problem: '',
  };
  if (header.some((h) => ['subject_id', 'sex', 'value', 'crew_id', 'name'].includes(h))) {
    return { ...empty, problem: 'refused: per-person columns (aggregate only)' };
  }
  const col = (name: string) => header.indexOf(name);
  const byName = new Map<string, ReferenceAnalyte>();
  for (const line of body.slice(1)) {
    const c = splitCsv(line);
    const n = num(c[col('n')]) ?? 0;
    if (n < empty.min_cell_n) continue;
    const key = `${c[col('panel')]}|${c[col('analyte')]}`;
    let a = byName.get(key);
    if (!a) {
      a = {
        panel: c[col('panel')],
        analyte: c[col('analyte')],
        unit: c[col('unit')],
        ref_low: num(c[col('ref_low')]),
        ref_high: num(c[col('ref_high')]),
        ref_note: c[col('ref_note')] ?? '',
        points: [],
      };
      byName.set(key, a);
    }
    a.points.push({ timepoint: c[col('timepoint')], n, mean: num(c[col('mean')]), sd: num(c[col('sd')]) });
  }
  const analytes = [...byName.values()];
  const crewN = Math.max(0, ...analytes.flatMap((a) => a.points.map((p) => p.n)));
  return { ...empty, analytes, available: analytes.length > 0, crew_n: crewN || null };
}

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function point(a: ReferenceAnalyte, tp: string): ReferencePoint | undefined {
  return a.points.find((p) => p.timepoint === tp);
}

/** Mean of the pre-flight crew means (L-92, L-44, L-3). */
export function preflightMean(a: ReferenceAnalyte): number | null {
  const vals = PRE.map((tp) => point(a, tp)?.mean).filter((v): v is number => typeof v === 'number');
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

/** Plain-language change from the pre-flight average to the day after landing. */
export function changeText(a: ReferenceAnalyte): string {
  const pre = preflightMean(a);
  const post = point(a, POST)?.mean ?? null;
  if (pre === null || post === null || pre === 0) return 'no comparison';
  const pct = ((post - pre) / pre) * 100;
  if (Math.abs(pct) < 3) return 'about the same';
  return `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct).toFixed(0)} %`;
}

function inInterval(a: ReferenceAnalyte, v: number | null): boolean | null {
  if (v === null) return null;
  if (a.ref_low !== null && v < a.ref_low) return false;
  if (a.ref_high !== null && v > a.ref_high) return false;
  return true;
}

export const Inspiration4ReferencePanel: React.FC<{ initial?: PanelData | null; titleId?: string }> = ({
  initial,
  titleId = 'i4-title',
}) => {
  const [live, setLive] = useState<PanelData | null>(initial ?? null);
  const [showAll, setShowAll] = useState(false);
  const bundled = useMemo(() => parseInspiration4Csv(bundledCsv), []);

  useEffect(() => {
    if (initial !== undefined) return;
    let cancelled = false;
    void backendApi.inspiration4().then((p) => {
      if (!cancelled && p) setLive(p);
    });
    return () => {
      cancelled = true;
    };
  }, [initial]);

  // Backend first (manifest + sha256 checked); bundled copy when offline.
  const panel = live ?? bundled;
  const rows = (showAll ? [...panel.analytes] : panel.analytes.filter((a) => KEY_ANALYTES.includes(a.analyte))).sort((x, y) => {
    const ix = KEY_ANALYTES.indexOf(x.analyte);
    const iy = KEY_ANALYTES.indexOf(y.analyte);
    if (ix !== -1 || iy !== -1) return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy);
    return x.panel.localeCompare(y.panel) || x.analyte.localeCompare(y.analyte);
  });

  return (
    <section
      className="rounded-xl border border-sky-800/60 bg-space-900/90 p-4 space-y-3"
      data-testid="inspiration4-panel"
      aria-labelledby={titleId}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id={titleId} className="text-sm font-semibold text-slate-100">
            Reference: blood tests from a real flight crew (Inspiration4, 2021)
          </h3>
          <p className="text-xs text-slate-400">
            Average of {panel.crew_n ?? 4} civilians before and after a 3-day flight. Reference only: AEGIS does not
            measure your blood. Compare with an onboard lab result together with the CMO. Not a diagnosis.
          </p>
        </div>
        <DataSourceBadge
          source={{
            provenance: panel.provenance,
            dataset_id: panel.dataset_id,
            basis: panel.basis,
            dataset: panel.dataset,
          }}
        />
      </div>

      {!panel.available ? (
        <p className="text-xs text-amber-200" data-testid="inspiration4-unavailable">
          Reference panel unavailable: {panel.problem || 'no data'}. Nothing else depends on it.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-200" data-testid="inspiration4-table">
              <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-1.5 pr-2">Blood value</th>
                  <th className="py-1.5 pr-2">Before flight (avg)</th>
                  <th className="py-1.5 pr-2">Day after landing</th>
                  <th className="py-1.5 pr-2">Change</th>
                  <th className="py-1.5 pr-2">Lab normal range</th>
                  <th className="py-1.5">6 months later</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const post = point(a, POST);
                  const late = point(a, 'R+194');
                  const ok = inInterval(a, post?.mean ?? null);
                  return (
                    <tr key={`${a.panel}-${a.analyte}`} className="border-t border-slate-800" data-testid="inspiration4-row">
                      <td className="py-1.5 pr-2">
                        <span className="font-semibold text-slate-100">{PLAIN[a.analyte] ?? a.analyte}</span>
                        <span className="ml-1 text-[10px] text-slate-500">{a.panel}</span>
                      </td>
                      <td className="py-1.5 pr-2 font-mono">
                        {fmt(preflightMean(a))} {a.unit}
                      </td>
                      <td className="py-1.5 pr-2 font-mono">
                        {fmt(post?.mean)} ± {fmt(post?.sd)}
                        {ok === false && <span className="ml-1 text-amber-300">▲ outside range</span>}
                      </td>
                      <td className="py-1.5 pr-2">{changeText(a)}</td>
                      <td className="py-1.5 pr-2 font-mono" title={a.ref_note || undefined}>
                        {fmt(a.ref_low)}–{fmt(a.ref_high)}
                        {a.ref_note && <span className="block text-[10px] text-slate-500">{a.ref_note}</span>}
                      </td>
                      <td className="py-1.5 font-mono">{fmt(late?.mean)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500">
              Crew mean ± SD (n = {panel.crew_n}); cells with fewer than {panel.min_cell_n} people are not shown. No
              individual values are bundled.
            </p>
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="min-h-[44px] rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800"
              data-testid="inspiration4-toggle"
            >
              {showAll ? 'Show key values only' : `Show all ${panel.analytes.length} values`}
            </button>
          </div>
        </>
      )}
    </section>
  );
};
