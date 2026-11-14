import React, { useState } from 'react';
import {
  HAZARD_CATALOG,
  HRP_RISK_CATALOG,
  STATUS_DISPLAY,
  Severity,
  severityToStatus,
} from '../api/types';
import { useAegis } from '../api/useLiveSocket';
import { AlertChecklist } from '../components/AlertChecklist';
import { ContextBadge, EvidenceDetails } from '../components/EvidenceDetails';

export const AlertCenter: React.FC = () => {
  const {
    state,
    acknowledgeAlert,
    setAlertInTreatment,
    resolveAlert,
    addAlertNote,
    triggerScenario,
  } = useAegis();

  const { alerts } = state;
  const [severityFilter, setSeverityFilter] = useState<Severity | 'ALL'>('ALL');
  const [stateFilter, setStateFilter] = useState<'ACTIVE' | 'RESOLVED' | 'ALL'>('ALL');
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});

  const filtered = alerts.filter((a) => {
    if (severityFilter !== 'ALL' && a.severity !== severityFilter) return false;
    if (stateFilter === 'ACTIVE' && a.state === 'RESOLVED') return false;
    if (stateFilter === 'RESOLVED' && a.state !== 'RESOLVED') return false;
    return true;
  });

  const handleAddNote = (alertId: string) => {
    const text = noteInputs[alertId];
    if (!text || !text.trim()) return;
    const cmo = state.crew.find((c) => c.role === 'CMO');
    addAlertNote(alertId, cmo ? `CMO (${cmo.name})` : 'Crew', text);
    setNoteInputs((prev) => ({ ...prev, [alertId]: '' }));
  };

  return (
    <div className="space-y-6" data-testid="alert-center-view">
      {/* Header & Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-space-900/95 p-5">
        <div>
          <h1 className="text-xl font-black text-white">
            CMO Autonomous Alert Triage & Explainability Audit Center
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Every alert links to NASA RIDGE hazards, HRP-01..HRP-17 risks, explicit signal evidence, and config limit verification state.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-slate-700 bg-space-950 p-1">
            {(['ALL', 'EMERGENCY', 'WARNING', 'CAUTION'] as const).map((sev) => (
              <button
                key={sev}
                type="button"
                onClick={() => setSeverityFilter(sev)}
                className={`min-h-[44px] rounded px-3 py-1 text-xs font-bold transition-colors ${
                  severityFilter === sev
                    ? 'bg-cyan-500 text-slate-950'
                    : 'text-slate-300 hover:bg-space-800'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>

          <div className="flex items-center rounded-lg border border-slate-700 bg-space-950 p-1">
            {(['ALL', 'ACTIVE', 'RESOLVED'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStateFilter(st)}
                className={`min-h-[44px] rounded px-3 py-1 text-xs font-bold transition-colors ${
                  stateFilter === st
                    ? 'bg-purple-500 text-white'
                    : 'text-slate-300 hover:bg-space-800'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Empty State with quick scenario triggers */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-space-900/80 p-8 text-center space-y-4">
          <div className="text-lg font-bold text-emerald-300">
            ✓ Nominal Operations — No Alerts Matching Current Filter
          </div>
          <p className="text-xs text-slate-400 max-w-xl mx-auto">
            All 4 crew members and habitat environmental parameters are within configured envelopes. Trigger a scenario below to inspect rule explainability, evidence payloads, and lifecycle state transitions.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => triggerScenario('co2_scrubber_degradation')}
              className="min-h-[44px] rounded-lg border border-amber-400/60 bg-amber-500/20 px-4 py-2 text-xs font-bold text-amber-100 hover:bg-amber-500/30"
            >
              ▲ Inject CO₂ Scrubber Degradation (CAUTION)
            </button>
            <button
              type="button"
              onClick={() => triggerScenario('insomnia_streak')}
              className="min-h-[44px] rounded-lg border border-amber-400/60 bg-amber-500/20 px-4 py-2 text-xs font-bold text-amber-100 hover:bg-amber-500/30"
            >
              ▲ Inject Compound Cognitive Risk (CAUTION)
            </button>
            <button
              type="button"
              onClick={() => triggerScenario('orthostatic_intolerance')}
              className="min-h-[44px] rounded-lg border border-orange-400/60 bg-orange-500/20 px-4 py-2 text-xs font-bold text-orange-100 hover:bg-orange-500/30"
            >
              ■ Inject Landing Orthostatic Drop (WARNING)
            </button>
            <button
              type="button"
              onClick={() => triggerScenario('spe_event')}
              className="min-h-[44px] rounded-lg border border-red-500/70 bg-red-500/20 px-4 py-2 text-xs font-bold text-red-100 hover:bg-red-500/30"
            >
              ✖ Inject Solar Particle Event (EMERGENCY)
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((alert) => {
            const stMeta = STATUS_DISPLAY[severityToStatus(alert.severity)];

            return (
              <article
                key={alert.id}
                data-testid={`alert-card-${alert.rule_id}`}
                className={`rounded-2xl border p-5 space-y-4 ${stMeta.borderClass} bg-space-900/95 shadow-md`}
              >
                {/* Top metadata & lifecycle controls */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-md border px-2.5 py-1 text-xs font-bold uppercase ${stMeta.badgeClass}`}
                    >
                      {stMeta.label}
                    </span>

                    <span className="rounded bg-slate-800 px-2.5 py-1 text-xs font-mono font-bold text-slate-200">
                      Lifecycle: {alert.state}
                    </span>

                    <ContextBadge evidence={alert.evidence} />

                    <span className="rounded bg-space-950 border border-slate-700 px-2.5 py-1 text-xs font-mono text-cyan-300">
                      Rule: {alert.rule_id}
                    </span>

                    <span className="rounded bg-space-950 border border-slate-700 px-2.5 py-1 text-xs font-mono text-slate-300">
                      Subject: {alert.crew_id ?? 'Whole Cabin (C1–C4)'}
                    </span>

                    <span className="text-xs font-mono text-slate-400">
                      Raised: {alert.raised_ts.slice(11, 19)} UTC · Origin: {alert.origin}
                    </span>
                  </div>

                  {/* Lifecycle State Machine Buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    {alert.state === 'RAISED' && (
                      <button
                        type="button"
                        onClick={() => acknowledgeAlert(alert.id)}
                        className="min-h-[44px] rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400"
                      >
                        Acknowledge
                      </button>
                    )}

                    {(alert.state === 'RAISED' || alert.state === 'ACKNOWLEDGED') && (
                      <button
                        type="button"
                        onClick={() => setAlertInTreatment(alert.id)}
                        className="min-h-[44px] rounded-lg border border-cyan-400/60 bg-cyan-500/20 px-3.5 py-2 text-xs font-bold text-cyan-100 hover:bg-cyan-500/30"
                      >
                        Mark In Treatment
                      </button>
                    )}

                    {alert.state !== 'RESOLVED' && (
                      <button
                        type="button"
                        onClick={() => resolveAlert(alert.id)}
                        className="min-h-[44px] rounded-lg border border-emerald-400/60 bg-emerald-600/25 px-3.5 py-2 text-xs font-bold text-emerald-100 hover:bg-emerald-600/35"
                      >
                        ✓ Resolve Alert
                      </button>
                    )}
                  </div>
                </div>

                {/* Title, Rationale, Action */}
                <div className="space-y-2">
                  <h2 className="text-lg font-bold text-white">{alert.title}</h2>
                  <p className="text-xs text-slate-300 leading-relaxed">{alert.rationale}</p>
                  <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/25 px-3.5 py-2.5 text-xs text-cyan-100">
                    <strong>Recommended action:</strong> {alert.action}
                  </div>
                  {alert.state !== 'RESOLVED' && <AlertChecklist alertId={alert.id} steps={alert.checklist} />}
                </div>

                {/* Hazard & HRP Risk Traceability Chips */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase text-slate-400">Traceability:</span>
                  {alert.hazards.map((hz) => (
                    <span
                      key={hz}
                      className="rounded-md bg-slate-800 border border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-100"
                    >
                      Hazard [{HAZARD_CATALOG[hz].letter}]: {HAZARD_CATALOG[hz].fullName}
                    </span>
                  ))}
                  {alert.hrp_risks.map((rId) => (
                    <span
                      key={rId}
                      className="rounded-md bg-cyan-950 border border-cyan-500/40 px-2.5 py-1 text-xs font-mono text-cyan-200"
                    >
                      {rId} — {HRP_RISK_CATALOG[rId]?.name}
                    </span>
                  ))}
                </div>

                {/* Explainability Evidence Payload */}
                <div className="rounded-xl border border-slate-800 bg-space-950/90 p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Explainable Evidence Payload (No Black-Box Scoring)
                    </span>
                    {alert.evidence.limit_verified ? (
                      <span className="rounded bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                        ✓ verified limit · {alert.evidence.source_ref}
                      </span>
                    ) : (
                      <span className="rounded bg-amber-500/20 border border-amber-400/50 px-2 py-0.5 text-xs font-semibold text-amber-200">
                        ⚠ unverified limit · {alert.evidence.source_ref ?? 'config/limits.yaml'}
                      </span>
                    )}
                  </div>

                  <EvidenceDetails evidence={alert.evidence} />
                </div>

                {/* Audit Notes & CMO Annotation Input */}
                <div className="space-y-2 pt-1">
                  {alert.notes.length > 0 && (
                    <div className="space-y-1">
                      {alert.notes.map((n, i) => (
                        <div
                          key={i}
                          className="rounded bg-space-950 border border-slate-800 px-3 py-1.5 text-xs text-slate-300"
                        >
                          <span className="font-mono text-cyan-300">
                            [{n.ts.slice(11, 19)} UTC · {n.author}]:
                          </span>{' '}
                          {n.text}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      aria-label={`Add clinical note for ${alert.rule_id}`}
                      placeholder="Add CMO clinical observation or procedure note..."
                      value={noteInputs[alert.id] ?? ''}
                      onChange={(e) =>
                        setNoteInputs((prev) => ({ ...prev, [alert.id]: e.target.value }))
                      }
                      className="min-h-[44px] flex-1 rounded-lg border border-slate-700 bg-space-950 px-3 py-2 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddNote(alert.id)}
                      className="min-h-[44px] rounded-lg border border-slate-700 bg-space-800 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-space-700"
                    >
                      + Log Note
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
