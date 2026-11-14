import React from 'react';
import { ConfigLimit } from '../api/types';

/** Shows whether a configured limit is verified (AGENTS.md ground rule 2). Nothing when no limit is configured. */
export const LimitBadge: React.FC<{ limit: ConfigLimit | undefined }> = ({ limit }) => {
  if (!limit) return null;
  return limit.verified ? (
    <span className="text-emerald-300 font-mono" title={limit.source_ref}>
      ✓ verified
    </span>
  ) : (
    <span className="text-amber-300 font-mono" title={`Unverified: ${limit.source_ref}`}>
      ⚠ unverified
    </span>
  );
};
