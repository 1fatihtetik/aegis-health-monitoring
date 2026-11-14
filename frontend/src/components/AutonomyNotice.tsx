import React from 'react';
import { formatDurationSeconds } from '../api/client';

/** At or above this one-way delay the crew cannot hold a real conversation with Mission Control. */
export const AUTONOMY_DELAY_THRESHOLD_S = 60;

export interface AutonomyNoticeProps {
  /** Earth link blacked out (no traffic either way). */
  blackout: boolean;
  /** One-way light-time delay to Earth in seconds. */
  delaySeconds: number;
  compact?: boolean;
}

/**
 * F-007 (2): tells the crew, in plain words, that ground cannot help in time and the checklist is
 * theirs to run now. Shown on crew alert surfaces when the link is blacked out or the one-way delay
 * is a minute or more. Renders nothing on a near-real-time link.
 */
export const AutonomyNotice: React.FC<AutonomyNoticeProps> = ({ blackout, delaySeconds, compact = false }) => {
  if (!blackout && delaySeconds < AUTONOMY_DELAY_THRESHOLD_S) return null;
  const headline = blackout
    ? 'Earth link BLACKED OUT: no contact with Mission Control'
    : `Mission Control is ${formatDurationSeconds(delaySeconds)} away (one way); a reply takes at least ${formatDurationSeconds(2 * delaySeconds)}`;
  return (
    <div
      role="note"
      data-testid="autonomy-notice"
      className={`rounded-lg border border-fuchsia-400/60 bg-fuchsia-950/40 text-fuchsia-100 ${
        compact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-xs'
      }`}
    >
      <span className="font-bold">⚑ Act onboard now. </span>
      <span>{headline}. </span>
      <span className="font-semibold">
        Run the checklist with the onboard CMO; do not wait for ground confirmation.
      </span>
    </div>
  );
};
