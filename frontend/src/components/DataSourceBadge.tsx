import React, { useState } from 'react';
import { AegisSystemState, DatasetMeta, Provenance, SignalSource } from '../api/types';

/** Plain labels + a shape per provenance, so the badge reads without colour (AGENTS.md §8). */
const META: Record<Provenance, { icon: string; label: string; className: string; help: string }> = {
  NASA_MEASURED: {
    icon: '◆',
    label: 'NASA · measured',
    className: 'border-sky-400/70 bg-sky-950/50 text-sky-100',
    help: 'Replayed measurement from a NASA archive.',
  },
  NASA_DERIVED: {
    icon: '◇',
    label: 'NASA-derived',
    className: 'border-teal-400/70 bg-teal-950/40 text-teal-100',
    help: 'Computed from NASA data by a documented formula.',
  },
  SYNTHETIC_CALIBRATED: {
    icon: '○',
    label: 'Synthetic · NASA-calibrated',
    className: 'border-slate-500 bg-slate-800/60 text-slate-200',
    help: 'Simulated. Its parameters come from a cited NASA source.',
  },
  SYNTHETIC: {
    icon: '·',
    label: 'Synthetic',
    className: 'border-slate-600 bg-slate-900/60 text-slate-300',
    help: 'Simulated with project heuristics. Not a measurement.',
  },
};

const FALLBACK: SignalSource = {
  provenance: 'SYNTHETIC',
  dataset_id: null,
  basis: 'Browser-only fallback simulation (backend not connected).',
};

export interface DataSourceBadgeProps {
  /** Current source of the value; undefined means the browser fallback is running. */
  source?:
    | SignalSource
    | { provenance?: Provenance; dataset_id?: string | null; basis?: string; dataset?: DatasetMeta | null };
  /** Smaller text for dense rows; the touch target stays >= 44 px (AGENTS.md section 8). */
  compact?: boolean;
}

/** Shows where a value comes from. Tap to see the dataset and basis (PRD §6 M0). */
export const DataSourceBadge: React.FC<DataSourceBadgeProps> = ({ source, compact = false }) => {
  const [open, setOpen] = useState(false);
  const provenance: Provenance = source?.provenance ?? FALLBACK.provenance;
  const meta = META[provenance];
  const datasetId = source ? source.dataset_id ?? null : FALLBACK.dataset_id;
  const basis = source ? source.basis ?? '' : FALLBACK.basis;
  const dataset = source?.dataset ?? null;
  // AGENTS.md §8: "NASA · MSL/RAD cruise 2012" (measured) or "NASA-derived · MSL/RAD cruise 2012".
  const short = provenance === 'NASA_MEASURED' ? 'NASA' : meta.label;
  const text = dataset ? `${short} · ${dataset.label}` : datasetId && !compact ? `${meta.label} · ${datasetId}` : meta.label;
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        data-testid="data-source-badge"
        data-provenance={provenance}
        aria-expanded={open}
        aria-label={`Data source: ${meta.label}${dataset ? `, ${dataset.label}` : datasetId ? `, dataset ${datasetId}` : ''}. Tap for details.`}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 rounded-md border font-semibold ${meta.className} ${
          compact ? 'min-h-[44px] px-2 text-[11px]' : 'min-h-[44px] px-2.5 text-xs'
        }`}
      >
        <span aria-hidden="true">{meta.icon}</span>
        {text}
      </button>
      {open && (
        <span
          role="note"
          data-testid="data-source-details"
          className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-slate-700 bg-space-950 p-3 text-left text-xs font-normal text-slate-200 shadow-xl"
        >
          <strong className="block text-slate-100">{meta.label}</strong>
          <span className="mt-1 block">{meta.help}</span>
          {datasetId && <span className="mt-1 block font-mono">Dataset: {datasetId}</span>}
          {dataset && (
            <span className="mt-1 block space-y-0.5" data-testid="data-source-manifest">
              <span className="block text-slate-100">{dataset.title}</span>
              <span className="block break-all font-mono text-[10px] text-slate-400">Source: {dataset.source_url}</span>
              <span className="block text-slate-400">Retrieved {dataset.retrieved} · bundled, replayed offline</span>
              <span className="block text-slate-300">Transform: {dataset.transform}</span>
            </span>
          )}
          {basis && (!dataset || !basis.startsWith(dataset.title)) && (
            <span className="mt-1 block text-slate-300">Basis: {basis}</span>
          )}
        </span>
      )}
    </span>
  );
};

/** Footer line: what is real right now, derived from the live provenance map (AGENTS.md §8). */
export function dataSourcesLine(provenance: AegisSystemState['provenance']): string {
  const values = Object.values(provenance);
  if (values.length === 0) return 'Data: browser-only fallback simulation, all synthetic.';
  const nasa = values.filter((v) => v.provenance === 'NASA_MEASURED' || v.provenance === 'NASA_DERIVED');
  const labels = [...new Set(nasa.map((v) => v.dataset?.label ?? v.dataset_id ?? 'NASA archive'))];
  return labels.length
    ? `Radiation: NASA data (${labels.join(', ')}). Limits: NASA-STD-3001 where marked ✓. Crew physiology and cabin air: synthetic. Each value shows its source.`
    : 'Data: synthetic simulator (no NASA replay active). Limits: NASA-STD-3001 where marked ✓. Each value shows its source.';
}
