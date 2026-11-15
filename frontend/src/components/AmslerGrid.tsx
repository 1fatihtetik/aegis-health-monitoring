import React, { useState } from 'react';
import { SelfTestDef, SubmitOutcome } from '../api/types';

export type Eye = 'right' | 'left';
export type MarkKind = 'wavy' | 'blurred' | 'missing';
/** Marks per eye: cell index (row * grid + column) -> what the crew saw there. Screen state only, never stored. */
export type EyeMarks = Record<number, MarkKind>;

const KINDS: { kind: MarkKind; label: string; letter: string; cls: string }[] = [
  { kind: 'wavy', label: 'Wavy or bent', letter: 'W', cls: 'bg-amber-400 text-slate-950' },
  { kind: 'blurred', label: 'Blurred or faded', letter: 'B', cls: 'bg-sky-400 text-slate-950' },
  { kind: 'missing', label: 'Missing or dark', letter: 'M', cls: 'bg-rose-500 text-white' },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<MarkKind, (typeof KINDS)[number]>;

const EYE_TEXT: Record<Eye, { title: string; cover: string }> = {
  right: { title: 'Right eye', cover: 'Cover your LEFT eye. Look only at the dot in the middle.' },
  left: { title: 'Left eye', cover: 'Cover your RIGHT eye. Look only at the dot in the middle.' },
};

/** What the tablet sends: the flag and the number of marked squares per eye. The marked grid itself is not sent. */
export function amslerValues(marks: Record<Eye, EyeMarks>): Record<string, number> {
  const right = Object.keys(marks.right).length;
  const left = Object.keys(marks.left).length;
  return { amsler_flag: right + left > 0 ? 1 : 0, amsler_cells_right: right, amsler_cells_left: left };
}

/** Plain summary of one eye's marks: "2 wavy, 1 missing" or "nothing marked". */
export function marksSummary(marks: EyeMarks): string {
  const counts = KINDS.map((k) => [k.kind, Object.values(marks).filter((m) => m === k.kind).length] as const).filter(
    ([, n]) => n > 0,
  );
  return counts.length ? counts.map(([kind, n]) => `${n} ${kind}`).join(', ') : 'nothing marked';
}

/** One eye's grid. Each square is a ≥ 44 px button; the centre dot sits where the four middle squares meet. */
const Grid: React.FC<{
  grid: number;
  marks: EyeMarks;
  eye: Eye;
  onTap?: (cell: number) => void;
  small?: boolean;
}> = ({ grid, marks, eye, onTap, small = false }) => {
  const size = small ? 'h-5 w-5' : 'h-11 w-11';
  return (
    <div className="relative inline-block rounded border-2 border-slate-900 bg-white" data-testid={`amsler-grid-${eye}${small ? '-review' : ''}`}>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${grid}, minmax(0, 1fr))` }}>
        {Array.from({ length: grid * grid }, (_, cell) => {
          const row = Math.floor(cell / grid) + 1;
          const col = (cell % grid) + 1;
          const mark = marks[cell];
          const style = mark ? KIND[mark].cls : 'bg-white';
          const label = `Row ${row}, column ${col}${mark ? `, marked ${mark}` : ''}`;
          return onTap ? (
            <button
              key={cell}
              type="button"
              aria-label={label}
              aria-pressed={Boolean(mark)}
              data-testid={`amsler-cell-${eye}-${cell}`}
              onClick={() => onTap(cell)}
              className={`${size} border border-slate-900 text-sm font-black focus:outline focus:outline-2 focus:outline-cyan-500 ${style}`}
            >
              {mark ? KIND[mark].letter : ''}
            </button>
          ) : (
            <span key={cell} aria-label={label} className={`${size} flex items-center justify-center border border-slate-900 text-[10px] font-black ${style}`}>
              {mark ? KIND[mark].letter : ''}
            </span>
          );
        })}
      </div>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-950 ${small ? 'h-1.5 w-1.5' : 'h-3 w-3'}`}
      />
    </div>
  );
};

/**
 * T-9 Amsler grid self-check. One eye at a time: the crew taps the squares that look wavy, blurred or missing while
 * looking at the centre dot. The flag and the count per eye go through the observation path as CREW_ENTERED. The
 * marked grid is shown for the CMO on this screen only; it is never sent or stored (no image, no camera).
 */
export const AmslerGrid: React.FC<{
  test: SelfTestDef;
  connected: boolean;
  onSubmit: (values: Record<string, number>) => Promise<SubmitOutcome>;
}> = ({ test, connected, onSubmit }) => {
  const grid = Math.round(test.params.grid ?? 10);
  const [stage, setStage] = useState<Eye | 'review'>('right');
  const [kind, setKind] = useState<MarkKind>('wavy');
  const [marks, setMarks] = useState<Record<Eye, EyeMarks>>({ right: {}, left: {} });
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  const tap = (eye: Eye) => (cell: number) => {
    setMarks((prev) => {
      const next = { ...prev[eye] };
      if (next[cell] === kind) delete next[cell];
      else next[cell] = kind;
      return { ...prev, [eye]: next };
    });
  };
  const clear = (eye: Eye): void => setMarks((prev) => ({ ...prev, [eye]: {} }));
  const values = amslerValues(marks);
  const flagged = values.amsler_flag === 1;

  const save = async (): Promise<void> => {
    setBusy(true);
    const res = await onSubmit(values);
    setBusy(false);
    setOutcome(res);
  };

  return (
    <div className="space-y-4" data-testid={`amsler-${test.id}`}>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-100" data-testid="selftest-steps">
        {test.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <p className="text-xs text-slate-400">The marked grid stays on this screen for the CMO. It is not stored or sent; only the counts are saved.</p>

      {stage !== 'review' ? (
        <section className="space-y-3 rounded-xl border border-slate-800 bg-space-950/70 p-4" data-testid={`amsler-stage-${stage}`}>
          <div>
            <h4 className="text-base font-black text-white">
              {stage === 'right' ? 'Step 1 of 2' : 'Step 2 of 2'} · {EYE_TEXT[stage].title}
            </h4>
            <p className="text-sm font-semibold text-amber-100">{EYE_TEXT[stage].cover}</p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="What does the area look like?">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                aria-pressed={kind === k.kind}
                data-testid={`amsler-kind-${k.kind}`}
                onClick={() => setKind(k.kind)}
                className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 text-sm font-bold ${
                  kind === k.kind ? 'border-cyan-300 ring-2 ring-cyan-400' : 'border-slate-700'
                } bg-space-900 text-slate-100`}
              >
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded text-xs font-black ${k.cls}`}>{k.letter}</span>
                {k.label}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <Grid grid={grid} marks={marks[stage]} eye={stage} onTap={tap(stage)} />
          </div>
          <p className="text-sm text-slate-200" data-testid={`amsler-count-${stage}`}>
            Marked: {marksSummary(marks[stage])}. Everything looks straight and even? Mark nothing and go on.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => clear(stage)}
              className="min-h-[48px] rounded-xl border border-slate-600 bg-space-900 px-4 text-sm font-bold text-slate-100"
            >
              Clear marks
            </button>
            {stage === 'left' && (
              <button
                type="button"
                onClick={() => setStage('right')}
                className="min-h-[48px] rounded-xl border border-slate-600 bg-space-900 px-4 text-sm font-bold text-slate-100"
              >
                ← Back to right eye
              </button>
            )}
            <button
              type="button"
              data-testid="amsler-next"
              onClick={() => setStage(stage === 'right' ? 'left' : 'review')}
              className="min-h-[48px] flex-1 rounded-xl bg-cyan-500 px-6 text-base font-black text-slate-950 hover:bg-cyan-400"
            >
              {stage === 'right' ? 'Next: left eye →' : 'Done: see summary'}
            </button>
          </div>
        </section>
      ) : (
        <section className="space-y-3 rounded-xl border border-slate-800 bg-space-950/70 p-4" data-testid="amsler-review">
          <h4 className="text-base font-black text-white">Summary</h4>
          <div className="flex flex-wrap gap-6">
            {(['right', 'left'] as Eye[]).map((eye) => (
              <div key={eye} className="space-y-1">
                <p className="text-sm font-bold text-slate-100">
                  {EYE_TEXT[eye].title}: {marksSummary(marks[eye])}
                </p>
                <Grid grid={grid} marks={marks[eye]} eye={eye} small />
              </div>
            ))}
          </div>
          {flagged ? (
            <p className="rounded-lg border border-amber-500/50 bg-amber-950/30 p-3 text-sm text-amber-100" data-testid="amsler-flagged">
              ▲ Areas marked. {test.escalation}
            </p>
          ) : (
            <p className="text-sm text-emerald-300" data-testid="amsler-clear">
              ✓ Nothing marked with either eye.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setStage('right');
                setOutcome(null);
              }}
              className="min-h-[48px] rounded-xl border border-slate-600 bg-space-900 px-4 text-sm font-bold text-slate-100"
            >
              ← Redo
            </button>
            <button
              type="button"
              data-testid="amsler-save"
              disabled={!connected || busy || outcome?.ok === true}
              onClick={() => void save()}
              className="min-h-[56px] flex-1 rounded-xl bg-cyan-500 px-6 text-base font-black text-slate-950 hover:bg-cyan-400 disabled:opacity-40"
            >
              Save
            </button>
          </div>
          {outcome && (
            <p role="status" className={`text-sm font-semibold ${outcome.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
              {outcome.ok ? (flagged ? '✓ Saved. Show this screen to the CMO now, before you close it.' : '✓ Saved.') : `▲ ${outcome.message}`}
            </p>
          )}
        </section>
      )}
    </div>
  );
};
