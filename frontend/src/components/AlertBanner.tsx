import React, { useState } from 'react';
import {
  AlertItem,
  HAZARD_CATALOG,
  HRP_RISK_CATALOG,
  STATUS_DISPLAY,
  severityToStatus,
} from '../api/types';
import { clauseId } from '../api/limits';
import { signalLabel } from '../api/backend';
import { AlertChecklist } from './AlertChecklist';
import { AutonomyNotice } from './AutonomyNotice';
import { DataSourceBadge } from './DataSourceBadge';

export interface AlertBannerProps {
  alerts: AlertItem[];
  onAcknowledge: (alertId: string) => void;
  onInspectAlert?: (alertId: string) => void;
  onOpenEmergencyModal?: () => void;
  /** Earth link state, for the "act onboard now" notice (F-007). */
  linkBlackout?: boolean;
  commDelaySeconds?: number;
}

export const AlertBanner: React.FC<AlertBannerProps> = ({
  alerts,
  onAcknowledge,
  onInspectAlert,
  onOpenEmergencyModal,
  linkBlackout = false,
  commDelaySeconds = 0,
}) => {
  const [stepsOpen, setStepsOpen] = useState<boolean>(true);
  const activeAlerts = alerts.filter(
    (a) => a.state === 'RAISED' || a.state === 'ACKNOWLEDGED' || a.state === 'IN_TREATMENT'
  );

  if (activeAlerts.length === 0) {
    return null;
  }

  // Sort by severity: EMERGENCY -> WARNING -> CAUTION -> INFO
  const rank: Record<AlertItem['severity'], number> = {
    EMERGENCY: 4,
    WARNING: 3,
    CAUTION: 2,
    INFO: 1,
  };
  const sorted = [...activeAlerts].sort((a, b) => rank[b.severity] - rank[a.severity]);
  const top = sorted[0];
  const statusMeta = STATUS_DISPLAY[severityToStatus(top.severity)];

  return (
    <div
      role="region"
      aria-label="Active Onboard Health Alerts"
      data-testid="alert-banner"
      className={`rounded-xl border px-4 py-3 shadow-lg transition-all ${
        top.severity === 'EMERGENCY'
          ? 'border-red-500 bg-red-950/60'
          : top.severity === 'WARNING'
          ? 'border-orange-500/80 bg-orange-950/45'
          : 'border-amber-500/70 bg-amber-950/35'
      }`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-1.5 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${statusMeta.badgeClass}`}
            >
              {statusMeta.label}
            </span>

            <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-mono text-slate-300">
              State: {top.state}
            </span>

            {top.crew_id ? (
              <span className="rounded bg-cyan-500/20 border border-cyan-400/40 px-2 py-0.5 text-xs font-bold text-cyan-200">
                Crew: {top.crew_id}
              </span>
            ) : (
              <span className="rounded bg-purple-500/20 border border-purple-400/40 px-2 py-0.5 text-xs font-bold text-purple-200">
                Whole-Cabin / All Crew
              </span>
            )}

            {top.hazards.map((hz) => (
              <span
                key={hz}
                className="rounded bg-slate-800/90 border border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-200"
              >
                [{HAZARD_CATALOG[hz].letter}] {HAZARD_CATALOG[hz].shortName}
              </span>
            ))}

            {top.hrp_risks.map((riskId) => (
              <span
                key={riskId}
                title={HRP_RISK_CATALOG[riskId]?.name}
                className="rounded bg-cyan-950 border border-cyan-600/40 px-2 py-0.5 text-[11px] font-mono text-cyan-300"
              >
                {riskId}
              </span>
            ))}

            {activeAlerts.length > 1 && (
              <span className="text-xs font-semibold text-slate-300">
                (+{activeAlerts.length - 1} more active alert{activeAlerts.length - 1 > 1 ? 's' : ''})
              </span>
            )}
          </div>

          <h2 className="text-base font-bold text-slate-100">{top.title}</h2>
          <p className="text-xs text-slate-300">{top.rationale}</p>

          <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs font-mono text-slate-200">
            <span className="rounded bg-space-950/80 border border-slate-700/80 px-2 py-1">
              {top.evidence.signal === 'compound' ? (
                <span data-testid="banner-compound-evidence">
                  Combined indicators: <strong>{top.evidence.value}</strong> of <strong>{top.evidence.limit}</strong>{' '}
                  conditions met
                </span>
              ) : (
                <>
                  Evidence: <strong>{signalLabel(top.evidence.signal)}</strong> = {top.evidence.value}
                  {top.evidence.unit ? ` ${top.evidence.unit}` : ''} (limit {top.evidence.op ? `${top.evidence.op} ` : ''}
                  {top.evidence.limit}
                  {top.evidence.unit ? ` ${top.evidence.unit}` : ''}
                  {top.evidence.window ? ` over ${top.evidence.window}` : ''})
                </>
              )}
            </span>

            <DataSourceBadge
              compact
              source={{ provenance: top.evidence.provenance, dataset_id: top.evidence.dataset_id ?? null, basis: top.evidence.basis, dataset: top.evidence.dataset }}
            />

            {top.evidence.limit_verified && (
              <span
                className="rounded bg-emerald-500/15 border border-emerald-400/50 px-2 py-1 text-[11px] font-semibold text-emerald-200"
                title={top.evidence.source_ref}
              >
                ✓ NASA limit {clauseId(top.evidence.source_ref) ?? ''}
              </span>
            )}

            {!top.evidence.limit_verified && (
              <span className="rounded bg-amber-500/20 border border-amber-400/50 px-2 py-1 text-[11px] font-semibold text-amber-200">
                ⚠ unverified limit ({top.evidence.source_ref ?? 'config/limits.yaml'})
              </span>
            )}
          </div>

          <p className="text-xs font-medium text-cyan-200">
            Suggested CMO Action: <span className="font-normal text-slate-200">{top.action}</span>
          </p>

          <AutonomyNotice blackout={linkBlackout} delaySeconds={commDelaySeconds} compact />

          {top.checklist && top.checklist.length > 0 && (
            <div className="space-y-1.5">
              <button
                type="button"
                aria-expanded={stepsOpen}
                onClick={() => setStepsOpen((o) => !o)}
                className="min-h-[44px] rounded-lg border border-cyan-500/50 bg-cyan-950/40 px-3 py-2 text-xs font-bold text-cyan-100 hover:bg-cyan-900/40"
              >
                {stepsOpen ? '▾ Hide steps' : `▸ Show what to do now (${top.checklist.length} steps)`}
              </button>
              {stepsOpen && <AlertChecklist alertId={top.id} steps={top.checklist} compact />}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {top.severity === 'EMERGENCY' && onOpenEmergencyModal && (
            <button
              type="button"
              onClick={onOpenEmergencyModal}
              className="min-h-[44px] rounded-lg bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white shadow hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              ✖ Open SPE Shelter Takeover
            </button>
          )}

          {top.state === 'RAISED' && (
            <button
              type="button"
              onClick={() => onAcknowledge(top.id)}
              className="min-h-[44px] rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-950 shadow hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300"
            >
              Acknowledge Alert
            </button>
          )}

          {onInspectAlert && (
            <button
              type="button"
              onClick={() => onInspectAlert(top.id)}
              className="min-h-[44px] rounded-lg border border-slate-600 bg-space-800 px-3.5 py-2 text-xs font-semibold text-slate-100 hover:bg-space-700"
            >
              Triage & Evidence ({activeAlerts.length})
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
