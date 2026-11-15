import React, { useEffect, useRef, useState } from 'react';
import { BUNDLED_LIMITS, SOURCE_KIND_LABEL, limitCounts } from '../api/limits';
import { AegisSystemState, ConfigLimit, LimitSourceKind } from '../api/types';

/**
 * Block L, L-2 (ROADMAP §0a): one "Where our data comes from" panel, opened from the footer and from any
 * DataSourceBadge's details. Plain words, no new data. The limit counts are computed from limits.yaml (live limits
 * when connected, the bundled copy offline), never typed. The panel opens inside the footer, so it never covers the
 * EmergencyTakeover or the AlertBanner.
 */
const OPEN_EVENT = 'aegis:open-data-sources';

/** Opens the panel from anywhere (a badge's details) and scrolls it into view. */
export function openDataSourcesPanel(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

const KIND_ORDER: LimitSourceKind[] = ['published', 'clinical', 'nasa_reference', 'design'];

const KIND_HELP: Record<LimitSourceKind, string> = {
  published: 'a number from a paper or a public scale (e.g. Basner 2011 PVT-B, NOAA storm scale, ADA glucose)',
  clinical: 'a common clinical rule of thumb (e.g. SpO₂ below 92 %)',
  nasa_reference: 'a number from a NASA page that is not a NASA-STD-3001 clause (the HRP bone-loss rate)',
  design: 'a setting we chose for this tool (flag cuts, Go minimums, alert levels with no outside number)',
};

export interface DataSourcesPanelProps {
  provenance: AegisSystemState['provenance'];
  limits?: Record<string, ConfigLimit>;
}

export const DataSourcesPanel: React.FC<DataSourcesPanelProps> = ({ provenance, limits }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const source = limits && Object.keys(limits).length ? limits : BUNDLED_LIMITS;
  const counts = limitCounts(source);

  useEffect(() => {
    const onOpen = (): void => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);

  const active = Object.values(provenance);
  const replaying = [
    ...new Set(
      active
        .filter((v) => v.provenance === 'NASA_MEASURED' || v.provenance === 'NASA_DERIVED')
        .map((v) => v.dataset?.label ?? v.dataset_id ?? 'NASA archive'),
    ),
  ];
  const otherNow = [
    ...new Set(
      active.filter((v) => v.provenance === 'MEASURED_OTHER').map((v) => v.dataset?.label ?? v.dataset_id ?? ''),
    ),
  ].filter(Boolean);

  return (
    <div className="w-full">
      <button
        type="button"
        data-testid="data-sources-panel-toggle"
        aria-expanded={open}
        aria-controls="data-sources-panel"
        onClick={() => setOpen((v) => !v)}
        className="min-h-[44px] rounded-md border border-slate-600 px-3 text-xs font-semibold text-sky-200 hover:bg-slate-800"
      >
        {open ? 'Hide: where our data comes from' : 'Where our data comes from ›'}
      </button>
      {open && (
        <section
          id="data-sources-panel"
          ref={ref}
          data-testid="data-sources-panel"
          aria-label="Where our data comes from"
          className="mt-2 rounded-lg border border-slate-700 bg-space-900 p-4 text-left text-sm text-slate-200"
        >
          <h2 className="text-base font-bold text-slate-100">Where our data comes from</h2>
          <p className="mt-1 text-slate-300">
            Everything on screen is either replayed NASA data or a simulation built from published parameters, and
            every number shows which on its badge.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div data-testid="panel-nasa">
              <h3 className="font-semibold text-sky-200">◆ Real NASA data (replayed offline)</h3>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-300">
                <li>Radiation dose rates: MSL/RAD (Mars cruise, Gale crater, March 2012 solar storm), ISS DOSTEL-1 (low Earth orbit, DLR instrument in NASA's archive), LRO CRaTER (Moon).</li>
                <li>Space weather: NASA DONKI event records and OMNIWeb proton flux.</li>
                <li>Earth–Mars comm delay: JPL Horizons distance ÷ speed of light.</li>
                <li>{counts.nasa} limits read clause by clause in NASA-STD-3001 (marked ✓ NASA with the clause id).</li>
              </ul>
              {replaying.length > 0 && (
                <p className="mt-1 text-xs text-slate-400">Replaying now: {replaying.join(', ')}.</p>
              )}
            </div>
            <div data-testid="panel-other">
              <h3 className="font-semibold text-amber-200">▣ Other measured data</h3>
              <p className="mt-1 text-slate-300">
                After landing, ground radiation comes from US EPA RadNet (Houston). It is a real measurement by another
                agency, labelled &quot;Measured · EPA&quot;, never NASA.
              </p>
              {otherNow.length > 0 && <p className="mt-1 text-xs text-slate-400">Active now: {otherNow.join(', ')}.</p>}
            </div>
            <div data-testid="panel-simulated">
              <h3 className="font-semibold text-slate-100">○ Simulated, and why</h3>
              <p className="mt-1 text-slate-300">
                Crew physiology (heart rate, blood pressure, sleep, bone) and cabin air are simulated. NASA keeps
                in-flight astronaut vitals restricted for crew privacy, so no public dataset exists. The simulator&apos;s
                parameters cite their sources in config/mission.yaml and config/crew.yaml (HRP pages, OCHMO briefs);
                badges read &quot;Simulated · NASA-calibrated&quot; or &quot;Simulated&quot;.
              </p>
            </div>
            <div data-testid="panel-crew">
              <h3 className="font-semibold text-violet-200">✎ Crew entries</h3>
              <p className="mt-1 text-slate-300">
                Values typed or tapped on this tablet (self-tests, headache report) are real inputs, labelled
                &quot;Crew-entered&quot;. They are kept in memory only, never written to disk.
              </p>
            </div>
          </div>
          <div className="mt-3" data-testid="panel-limits">
            <h3 className="font-semibold text-slate-100">Limits ({counts.total} in config/limits.yaml)</h3>
            <ul className="mt-1 space-y-0.5 text-slate-300">
              <li>
                <span className="font-mono text-emerald-300">✓ NASA</span>: {counts.nasa}, each with document, revision
                and clause id.
              </li>
              {KIND_ORDER.map((k) => (
                <li key={k} data-testid={`panel-kind-${k}`}>
                  <span className="font-mono text-amber-300">Not a NASA limit · {SOURCE_KIND_LABEL[k]}</span>:{' '}
                  {counts.byKind[k]}, {KIND_HELP[k]}.
                </li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-3 min-h-[44px] rounded-md border border-slate-600 px-3 text-xs font-semibold text-slate-200 hover:bg-slate-800"
          >
            Close
          </button>
        </section>
      )}
    </div>
  );
};
