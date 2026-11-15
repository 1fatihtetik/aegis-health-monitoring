import React from 'react';
import { clauseId, limitKindOf, notNasaLabel } from '../api/limits';
import { ConfigLimit } from '../api/types';

/**
 * Shows whether a configured limit is a NASA clause (AGENTS.md ground rule 2) or what else it is (Block L:
 * "Not a NASA limit · <kind>"). Nothing when no limit is configured.
 */
export const LimitBadge: React.FC<{ limit: ConfigLimit | undefined }> = ({ limit }) => {
  if (!limit) return null;
  return limit.verified ? (
    <span className="text-emerald-300 font-mono" title={limit.source_ref}>
      ✓ NASA {clauseId(limit.source_ref) ?? 'verified'}
    </span>
  ) : (
    <span className="text-amber-300 font-mono" data-testid="not-nasa-limit" title={limit.source_ref}>
      {notNasaLabel(limitKindOf({ kind: limit.source_kind, ref: limit.key, sourceRef: limit.source_ref }))}
    </span>
  );
};
