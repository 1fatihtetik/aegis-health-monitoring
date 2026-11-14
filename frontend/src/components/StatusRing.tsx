import React from 'react';
import { OperationalStatus, STATUS_DISPLAY } from '../api/types';

export interface StatusRingProps {
  status: OperationalStatus;
  score: number;
  size?: number;
  label?: string;
  sublabel?: string;
}

export const StatusRing: React.FC<StatusRingProps> = ({
  status,
  score,
  size = 88,
  label,
  sublabel,
}) => {
  const meta = STATUS_DISPLAY[status];
  const strokeWidth = 7;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const offset = circumference - (clampedScore / 100) * circumference;

  return (
    <div
      className="inline-flex flex-col items-center select-none"
      data-testid="status-ring"
      aria-label={`Status ${meta.label}, readiness score ${clampedScore}`}
    >
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90 transform">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="rgba(148, 163, 184, 0.16)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke={meta.ringColor}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-500 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className={`text-xs font-bold leading-none ${meta.textClass}`} aria-hidden="true">
            {meta.symbol}
          </span>
          <span className="text-lg font-extrabold tracking-tight text-slate-100 font-mono">
            {clampedScore}
          </span>
          {sublabel && (
            <span className="text-[10px] uppercase tracking-wider text-slate-400">{sublabel}</span>
          )}
        </div>
      </div>

      <span
        className={`mt-1.5 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide ${meta.badgeClass}`}
      >
        <span>{meta.label}</span>
        {label ? <span className="opacity-80">· {label}</span> : null}
      </span>
    </div>
  );
};
