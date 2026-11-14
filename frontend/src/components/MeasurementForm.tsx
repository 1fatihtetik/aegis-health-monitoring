import React, { useState } from 'react';
import { bandText, bandUnverified, needsConfirmation, parseEntry, rulesTripped } from '../api/selftests';
import { SelfTestDef, SelfTestRuleLimit, SubmitOutcome } from '../api/types';
import { SeveritySublabel } from './SeveritySublabel';

const OP_WORD: Record<string, string> = { '>': 'above', '>=': 'at or above', '<': 'below', '<=': 'at or below' };

function trippedText(r: SelfTestRuleLimit, unit: string): string {
  return `${r.severity} alert: ${OP_WORD[r.op] ?? r.op} ${r.value} ${unit}`;
}

export interface MeasurementFormProps {
  test: SelfTestDef;
  connected: boolean;
  onSubmit: (values: Record<string, number>) => Promise<SubmitOutcome>;
}

/**
 * T-3 guided measurement: numbered steps, one input per value with its unit fixed, the normal band and the
 * unverified marker visible while typing. Implausible values are refused in plain words. A value that would raise
 * a WARNING or EMERGENCY asks the crew to re-check and confirm before it is sent (supervisor note, Block T).
 * Report-type tests (0-3 scales) use big tap buttons instead of typing.
 */
export const MeasurementForm: React.FC<MeasurementFormProps> = ({ test, connected, onSubmit }) => {
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<SelfTestRuleLimit[] | null>(null);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (values: Record<string, number>): Promise<void> => {
    setBusy(true);
    const res = await onSubmit(values);
    setBusy(false);
    setConfirming(null);
    setOutcome(res);
    if (res.ok) setRaw({});
  };

  const done = async (confirmed = false): Promise<void> => {
    const values: Record<string, number> = {};
    const errs: Record<string, string> = {};
    for (const f of test.fields) {
      const { value, error } = parseEntry(f, raw[f.signal] ?? '');
      if (error || value === null) errs[f.signal] = error ?? 'Missing value.';
      else values[f.signal] = value;
    }
    setErrors(errs);
    setOutcome(null);
    if (Object.keys(errs).length) return;
    const tripped = test.fields.flatMap((f) => rulesTripped(f, values[f.signal]));
    if (!confirmed && needsConfirmation(tripped)) {
      setConfirming(tripped);
      return;
    }
    await send(values);
  };

  const isTap = test.kind === 'report' && test.fields.length === 1;

  return (
    <div className="space-y-4" data-testid={`measurement-form-${test.id}`}>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-100" data-testid="selftest-steps">
        {test.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>

      {isTap ? (
        <TapScale test={test} disabled={!connected || busy} onPick={(v) => void send({ [test.fields[0].signal]: v })} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {test.fields.map((f) => {
            const parsed = parseEntry(f, raw[f.signal] ?? '');
            const tripped = parsed.value !== null ? rulesTripped(f, parsed.value) : [];
            const band = bandText(f);
            return (
              <label key={f.signal} className="block space-y-1 rounded-lg border border-slate-800 bg-space-950/70 p-3">
                <span className="block text-sm font-semibold text-slate-100">{f.label}</span>
                <span className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`${f.label} (${f.unit})`}
                    data-testid={`field-${f.signal}`}
                    value={raw[f.signal] ?? ''}
                    onChange={(e) => setRaw((prev) => ({ ...prev, [f.signal]: e.target.value }))}
                    className="min-h-[44px] w-32 rounded-lg border border-slate-600 bg-space-900 px-3 font-mono text-lg text-white"
                  />
                  <span className="font-mono text-sm text-slate-300">{f.unit}</span>
                </span>
                {f.hint && <span className="block text-xs text-slate-400">{f.hint}</span>}
                {band && (
                  <span className="block text-xs text-slate-300" data-testid={`band-${f.signal}`}>
                    Normal: {band}{' '}
                    {bandUnverified(f) && (
                      <span className="font-mono text-amber-300" title="Project or clinical heuristic, not a NASA value">
                        ⚠ unverified
                      </span>
                    )}
                  </span>
                )}
                {tripped.length > 0 && (
                  <span className="flex flex-wrap items-center gap-1 text-xs font-semibold text-amber-200" data-testid={`tripped-${f.signal}`}>
                    ▲ Outside the band: {trippedText(tripped[0], f.unit)} <SeveritySublabel severity={tripped[0].severity} />
                  </span>
                )}
                {errors[f.signal] && (
                  <span role="alert" className="block text-xs font-semibold text-red-300">
                    {errors[f.signal]}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}

      {confirming && (
        <div role="alertdialog" aria-label="Confirm reading" className="rounded-lg border border-orange-400 bg-orange-950/50 p-3 space-y-2" data-testid="confirm-panel">
          <p className="text-sm font-bold text-orange-100">■ Re-check before sending</p>
          <p className="text-sm text-orange-50">
            {confirming.map((r) => r.severity).includes('EMERGENCY') ? 'This reading raises an EMERGENCY alert.' : 'This reading raises a WARNING alert.'}{' '}
            Make sure the sensor sits correctly and measure again if you can.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="min-h-[44px] rounded-lg border border-slate-500 bg-space-900 px-4 text-sm font-bold text-slate-100"
            >
              Measure again
            </button>
            <button
              type="button"
              data-testid="confirm-send"
              disabled={busy}
              onClick={() => void done(true)}
              className="min-h-[44px] rounded-lg bg-orange-500 px-4 text-sm font-black text-slate-950 disabled:opacity-40"
            >
              The reading is right, send it
            </button>
          </div>
        </div>
      )}

      {!isTap && !confirming && (
        <button
          type="button"
          data-testid="selftest-done"
          disabled={!connected || busy}
          onClick={() => void done()}
          className="min-h-[56px] w-full rounded-xl bg-cyan-500 px-6 text-base font-black text-slate-950 hover:bg-cyan-400 disabled:opacity-40"
        >
          Done
        </button>
      )}

      {!connected && (
        <p className="text-xs font-semibold text-amber-300">
          ▲ Onboard server not reachable: entries cannot be stored right now. The Earth link is not needed.
        </p>
      )}
      {outcome && (
        <p
          role="status"
          data-testid="selftest-outcome"
          className={`text-sm font-semibold ${outcome.ok ? 'text-emerald-300' : 'text-amber-300'}`}
        >
          {outcome.ok ? '✓ ' : '▲ '}
          {outcome.message}
        </p>
      )}
    </div>
  );
};

const TapScale: React.FC<{ test: SelfTestDef; disabled: boolean; onPick: (v: number) => void }> = ({
  test,
  disabled,
  onPick,
}) => {
  const f = test.fields[0];
  const options: number[] = [];
  for (let v = f.input_min; v <= f.input_max; v += f.step) options.push(v);
  return (
    <div className="grid grid-cols-4 gap-2" role="group" aria-label={f.label}>
      {options.map((v) => (
        <button
          key={v}
          type="button"
          disabled={disabled}
          onClick={() => onPick(v)}
          className="min-h-[56px] rounded-lg border border-slate-700 bg-space-950 text-lg font-black text-slate-100 hover:bg-space-800 disabled:opacity-40"
        >
          {v}
        </button>
      ))}
    </div>
  );
};
