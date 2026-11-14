import React, { useState } from 'react';
import { QuestionnaireItem, SelfTestDef, SubmitOutcome } from '../api/types';

/** The answers combine into the test's single field (catalog `score`); only `mean` exists. */
export function scoreAnswers(answers: number[]): number {
  return Math.round((answers.reduce((s, v) => s + v, 0) / answers.length) * 10) / 10;
}

function options(item: QuestionnaireItem): number[] {
  const out: number[] = [];
  for (let v = item.min; v <= item.max + 1e-9; v += item.step) out.push(Math.round(v * 100) / 100);
  return out;
}

/** "Stays on board" marker for onboard-only answers (T-4: the link never sends them). */
export const OnboardOnlyBadge: React.FC = () => (
  <span
    data-testid="onboard-only-badge"
    className="inline-flex min-h-[28px] items-center gap-1 rounded-md border border-violet-400/70 bg-violet-950/40 px-2 text-xs font-bold text-violet-100"
  >
    🔒 Stays on board: never sent to Earth
  </span>
);

/**
 * T-4 questionnaire (KSS, NASA-TLX, motion sickness, mood). Items and their verbal anchors come from the catalog.
 * Short scales are big tap buttons; 0-100 scales are sliders that must be moved before saving. Answers stay on
 * board: the onboard server never sends them over the link.
 */
export const Questionnaire: React.FC<{
  test: SelfTestDef;
  connected: boolean;
  onSubmit: (values: Record<string, number>) => Promise<SubmitOutcome>;
}> = ({ test, connected, onSubmit }) => {
  const items = test.items ?? [];
  const [answers, setAnswers] = useState<(number | null)[]>(() => items.map(() => null));
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const complete = answers.every((a) => a !== null);
  const field = test.fields[0];

  const set = (i: number, v: number): void => {
    setAnswers((prev) => prev.map((a, j) => (j === i ? v : a)));
    setOutcome(null);
  };

  const save = async (): Promise<void> => {
    if (!complete || !field) return;
    setBusy(true);
    const res = await onSubmit({ [field.signal]: scoreAnswers(answers as number[]) });
    setBusy(false);
    setOutcome(res);
  };

  return (
    <div className="space-y-4" data-testid={`questionnaire-${test.id}`}>
      {test.onboard_only && <OnboardOnlyBadge />}
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-100" data-testid="selftest-steps">
        {test.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      {items.map((item, i) => {
        const opts = options(item);
        const tap = opts.length <= 11;
        return (
          <fieldset key={i} className="space-y-2 rounded-lg border border-slate-800 bg-space-950/70 p-3">
            <legend className="px-1 text-sm font-semibold text-slate-100">{item.label}</legend>
            {tap ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {opts.map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={answers[i] === v}
                    data-testid={`answer-${i}-${v}`}
                    onClick={() => set(i, v)}
                    className={`min-h-[56px] rounded-lg border px-2 py-1 text-left text-xs ${
                      answers[i] === v
                        ? 'border-cyan-300 bg-cyan-500 text-slate-950'
                        : 'border-slate-700 bg-space-900 text-slate-100 hover:bg-space-800'
                    }`}
                  >
                    <span className="block text-lg font-black">{v}</span>
                    {item.anchors[String(v)] && <span className="block leading-tight">{item.anchors[String(v)]}</span>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                <input
                  type="range"
                  min={item.min}
                  max={item.max}
                  step={item.step}
                  value={answers[i] ?? (item.min + item.max) / 2}
                  aria-label={item.label}
                  data-testid={`slider-${i}`}
                  onChange={(e) => set(i, Number(e.target.value))}
                  className="h-11 w-full"
                />
                <div className="flex justify-between text-xs text-slate-400">
                  <span>{item.anchors[String(item.min)] ?? item.min}</span>
                  <span className="font-mono text-slate-200">{answers[i] ?? 'move the slider'}</span>
                  <span>{item.anchors[String(item.max)] ?? item.max}</span>
                </div>
              </div>
            )}
          </fieldset>
        );
      })}
      <button
        type="button"
        data-testid="questionnaire-save"
        disabled={!connected || busy || !complete}
        onClick={() => void save()}
        className="min-h-[56px] w-full rounded-xl bg-cyan-500 px-6 text-base font-black text-slate-950 hover:bg-cyan-400 disabled:opacity-40"
      >
        Save
      </button>
      {!complete && <p className="text-xs text-slate-400">Answer every question to save.</p>}
      {outcome && (
        <p role="status" className={`text-sm font-semibold ${outcome.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
          {outcome.ok ? '✓ Stored on board only.' : `▲ ${outcome.message}`}
        </p>
      )}
    </div>
  );
};
