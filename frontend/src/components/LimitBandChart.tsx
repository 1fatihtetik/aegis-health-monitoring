import React from 'react';
import { notNasaLabel, limitKindOf } from '../api/limits';
import {
  Area,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ConfigLimit, HrpRiskId, SignalSource, TimeSeriesPoint } from '../api/types';
import { DataSourceBadge } from './DataSourceBadge';

export interface LimitBandChartProps {
  title: string;
  subtitle?: string;
  data: TimeSeriesPoint[];
  unit: string;
  limit?: ConfigLimit;
  secondaryLabel?: string;
  color?: string;
  secondaryColor?: string;
  hrpRisks?: HrpRiskId[];
  height?: number;
  /** Where the plotted values come from (snapshot provenance). Always shown. */
  source?: SignalSource;
}

/** Header value: 1 decimal under 100, whole numbers above (raw backend values carry 3+ decimals). */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return '–';
  return Math.abs(v) >= 100 ? v.toFixed(0) : String(Number(v.toFixed(Math.abs(v) < 10 ? 2 : 1)));
}

export const LimitBandChart: React.FC<LimitBandChartProps> = ({
  title,
  subtitle,
  data,
  unit,
  limit,
  secondaryLabel,
  color = '#38bdf8',
  secondaryColor = '#a855f7',
  hrpRisks = [],
  height = 210,
  source,
}) => {
  const latest = data[data.length - 1];
  const values = data.flatMap((d) =>
    d.secondaryValue !== undefined ? [d.value, d.secondaryValue] : [d.value]
  );
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 100;

  const domainMin = Math.floor(
    Math.min(rawMin, limit?.min ?? rawMin, limit?.value ?? rawMin) * 0.92
  );
  const domainMax = Math.ceil(
    Math.max(rawMax, limit?.max ?? rawMax, limit?.value ?? rawMax) * 1.08
  );

  const upperThreshold = limit?.max ?? limit?.value;
  const lowerThreshold = limit?.min;

  const isOutOfBounds =
    latest !== undefined &&
    ((upperThreshold !== undefined && latest.value > upperThreshold) ||
      (lowerThreshold !== undefined && latest.value < lowerThreshold));

  return (
    <div
      className="rounded-xl border border-slate-800 bg-space-900/90 p-4 shadow-sm"
      data-testid="limit-band-chart"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
            {hrpRisks.map((riskId) => (
              <span
                key={riskId}
                className="rounded bg-cyan-500/10 border border-cyan-500/30 px-1.5 py-0.5 text-[10px] font-mono text-cyan-300"
              >
                {riskId}
              </span>
            ))}
            <DataSourceBadge source={source} compact />
          </div>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex flex-col items-end">
          {latest && (
            <div className="flex items-baseline gap-1.5">
              <span
                className={`text-lg font-bold font-mono ${
                  isOutOfBounds ? 'text-amber-300' : 'text-slate-100'
                }`}
              >
                {fmt(latest.value)}
                {latest.secondaryValue !== undefined ? ` / ${fmt(latest.secondaryValue)}` : ''}
              </span>
              <span className="text-xs text-slate-400">{unit}</span>
            </div>
          )}

          {limit && (
            <div className="mt-1 flex items-center gap-1.5 text-[11px]">
              <span className="text-slate-400 font-mono">
                Limit:{' '}
                {limit.min !== undefined && limit.max !== undefined
                  ? `${limit.min}–${limit.max} ${limit.unit}`
                  : `${limit.value} ${limit.unit}`}
              </span>
              {limit.verified ? (
                <span className="rounded bg-emerald-500/15 border border-emerald-500/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                  ✓ NASA limit ({limit.source_ref})
                </span>
              ) : (
                <span className="rounded bg-amber-500/20 border border-amber-400/50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                  {notNasaLabel(limitKindOf({ kind: limit.source_kind, ref: limit.key, sourceRef: limit.source_ref }))} · {limit.source_ref}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <XAxis
              dataKey="label"
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              minTickGap={20}
            />
            <YAxis
              domain={[domainMin, domainMax]}
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0b101d',
                borderColor: '#334155',
                borderRadius: '0.5rem',
                fontSize: '12px',
                color: '#f1f5f9',
              }}
            />

            {lowerThreshold !== undefined && upperThreshold !== undefined && (
              <ReferenceArea
                y1={lowerThreshold}
                y2={upperThreshold}
                fill="#10b981"
                fillOpacity={0.07}
              />
            )}

            {upperThreshold !== undefined && (
              <ReferenceLine
                y={upperThreshold}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: `Max ${upperThreshold} ${unit}${limit && !limit.verified ? ' (not a NASA limit)' : ''}`,
                  position: 'insideTopRight',
                  fill: '#fcd34d',
                  fontSize: 10,
                }}
              />
            )}

            {lowerThreshold !== undefined && (
              <ReferenceLine
                y={lowerThreshold}
                stroke="#38bdf8"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: `Min ${lowerThreshold} ${unit}${limit && !limit.verified ? ' (not a NASA limit)' : ''}`,
                  position: 'insideBottomRight',
                  fill: '#7dd3fc',
                  fontSize: 10,
                }}
              />
            )}

            <Area
              type="monotone"
              dataKey="value"
              name={title}
              stroke={color}
              fill={color}
              fillOpacity={0.14}
              strokeWidth={2}
              isAnimationActive={false}
            />

            {secondaryLabel && (
              <Line
                type="monotone"
                dataKey="secondaryValue"
                name={secondaryLabel}
                stroke={secondaryColor}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
