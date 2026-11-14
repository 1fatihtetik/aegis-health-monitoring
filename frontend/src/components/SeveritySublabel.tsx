import React from 'react';
import { Severity, SEVERITY_LOSS_CATEGORY } from '../api/types';

/**
 * NASA Standards Hierarchy Pyramid loss category next to a severity (PRD §7.4, Block T T-0):
 * CAUTION = LOMO, WARNING = LOM, EMERGENCY = LOC. INFO has none. The engine severity is unchanged.
 */
export const SeveritySublabel: React.FC<{ severity: Severity }> = ({ severity }) => {
  const cat = SEVERITY_LOSS_CATEGORY[severity];
  if (!cat) return null;
  return (
    <span
      data-testid="severity-sublabel"
      title={cat.meaning}
      className="inline-flex items-center rounded border border-slate-600 bg-space-950/80 px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-200"
    >
      {cat.code}
      <span className="sr-only"> ({cat.meaning})</span>
    </span>
  );
};
