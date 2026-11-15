import React from 'react';

export interface SparklineProps {
  data: number[];
  label: string;
  unit: string;
  currentValue: number;
  limitMin?: number;
  limitMax?: number;
  limitVerified?: boolean;
  color?: string;
  warn?: boolean;
}

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  label,
  unit,
  currentValue,
  limitMin,
  limitMax,
  limitVerified = false,
  color = '#38bdf8',
  warn = false,
}) => {
  const width = 132;
  const height = 34;
  const pts = data.length > 1 ? data : [currentValue, currentValue];
  const minVal = Math.min(...pts, limitMin ?? Infinity);
  const maxVal = Math.max(...pts, limitMax ?? -Infinity);
  const span = Math.max(1e-3, maxVal - minVal);

  const coordinates = pts.map((val, idx) => {
    const x = (idx / (pts.length - 1)) * (width - 6) + 3;
    const y = height - 4 - ((val - minVal) / span) * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const strokeColor = warn ? '#f59e0b' : color;

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/90 bg-space-900/70 px-2.5 py-1.5">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-slate-400 truncate">{label}</span>
          {(limitMin !== undefined || limitMax !== undefined) && !limitVerified && (
            <span
              title="Not a NASA limit: threshold from config/limits.yaml"
              className="text-[10px] text-amber-300/90 font-mono"
            >
              not NASA
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1">
          <span
            className={`text-sm font-bold font-mono ${
              warn ? 'text-amber-300' : 'text-slate-100'
            }`}
          >
            {currentValue}
          </span>
          <span className="text-[11px] text-slate-400">{unit}</span>
        </div>
      </div>

      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="shrink-0 overflow-visible"
        aria-label={`${label} sparkline`}
      >
        {limitMax !== undefined && (
          <line
            x1={0}
            x2={width}
            y1={height - 4 - ((limitMax - minVal) / span) * (height - 8)}
            y2={height - 4 - ((limitMax - minVal) / span) * (height - 8)}
            stroke="#f59e0b"
            strokeDasharray="3 3"
            strokeWidth={1}
            opacity={0.55}
          />
        )}
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={coordinates.join(' ')}
        />
      </svg>
    </div>
  );
};
