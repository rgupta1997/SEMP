import { useMemo } from 'react';
import { DEFAULT_UNIT_LABELS, type UnitLabels } from '@semp/shared';
import { useApi } from './hooks';

// The organisation's structure, as every screen that needs it should read it.
//
// One hook rather than three `useApi('/units')` calls, because the endpoint returns
// two things that must arrive together: the TREE and the LABELS this organisation
// calls its levels. A screen that fetched them separately would render "Campus" and
// then flip to "Office", and would print the wrong noun entirely if the second call
// failed - which is exactly the sort of thing nobody notices until a customer does.

export interface UnitNode {
  id: string;
  type: 'campus' | 'department' | string;
  name: string;
  code: string | null;
  display_order: number;
  status: string;
  admin: { id: string; name: string } | null;
  /** Rolled up: a campus's count includes everyone in its departments. */
  member_count: number;
  team_count: number;
  event_count: number;
  children: UnitNode[];
}

export interface UnitsView {
  /** Campuses, each with its departments nested. */
  units: UnitNode[];
  labels: UnitLabels;
  /** Every node, campuses and departments alike, in display order. */
  flat: Array<UnitNode & { parent: UnitNode | null }>;
  /** Just the campuses - the usual thing a picker offers. */
  campuses: UnitNode[];
  isLoading: boolean;
  /**
   * Set when the tree could not be read at all. Reading is open to any member, so
   * this is a genuine failure rather than a plan wall - `multi_campus` gates
   * creating a SECOND campus, not looking at the structure.
   */
  error: unknown;
  refetch: () => void;
}

export function useOrgUnits(orgId: string | null | undefined): UnitsView {
  const q = useApi<{ units: UnitNode[]; labels: UnitLabels }>(orgId ? `/organizations/${orgId}/units` : null);

  return useMemo(() => {
    const units = q.data?.units ?? [];
    const flat: Array<UnitNode & { parent: UnitNode | null }> = [];
    for (const c of units) {
      flat.push({ ...c, parent: null });
      for (const d of c.children ?? []) flat.push({ ...d, parent: c });
    }
    return {
      units,
      labels: q.data?.labels ?? DEFAULT_UNIT_LABELS,
      flat,
      campuses: units.filter((u) => u.type === 'campus'),
      isLoading: q.isLoading,
      error: q.error,
      refetch: q.refetch,
    };
  }, [q.data, q.isLoading, q.error, q.refetch]);
}

/**
 * "Sales · Bangalore" for a department, "Bangalore" for a campus.
 *
 * A shared formatter because two departments in different campuses can share a
 * name, and every list that shows one has to disambiguate it the same way.
 */
export const unitPath = (node: { name: string }, parent?: { name: string } | null): string =>
  (parent ? `${node.name} · ${parent.name}` : node.name);
