import { Lock } from 'lucide-react';
import type { CapabilityKey } from '@semp/entitlements';
import { CAPABILITIES } from '@semp/entitlements';
import { useApi } from './hooks';

// The plan ONE event runs on, as GET /championships/:id/plan reports it - the
// same resolution the API's gates use, so a lock shown here is a refusal the
// server would make, and nothing unlocked here is refused there.
//
// While it loads, everything reads as allowed: a lock flashing onto a control
// and off again is worse than a moment of an unlocked control the server would
// still guard.

export interface EventLimit {
  key: string; label: string; unit: string;
  current: number; cap: number | null; capLabel: string; ok: boolean; fraction: number | null;
}

export interface EventPlan {
  tier: string;
  name: string;
  source: 'org' | 'pass' | 'admin' | 'legacy';
  inGrace: boolean;
  locked: boolean;
  graceUntil: string | null;
  capabilities: CapabilityKey[];
  limits: EventLimit[];
  defaultFormats: string[];
}

export function useEventPlan(championshipId: string | null | undefined) {
  const q = useApi<EventPlan>(championshipId ? `/championships/${championshipId}/plan` : null);
  const plan = q.data;
  return {
    plan,
    isLoading: q.isLoading,
    has: (cap: CapabilityKey) => !plan || plan.capabilities.includes(cap),
    limit: (key: string) => plan?.limits.find((l) => l.key === key),
    /** Room for `adding` more under this ceiling? */
    roomFor: (key: string, adding = 1) => {
      const l = plan?.limits.find((x) => x.key === key);
      return !l || l.cap === null || l.current + adding <= l.cap;
    },
    formatAllowed: (formatName: string | null | undefined) => {
      if (!plan || !formatName || plan.capabilities.includes('advanced_formats')) return true;
      const n = formatName.trim().toLowerCase();
      return plan.defaultFormats.some((f) => f.trim().toLowerCase() === n);
    },
  };
}

/** A small inline lock with the capability's name as its tooltip - for options and buttons. */
export function LockMark({ capability, className = '' }: { capability: CapabilityKey; className?: string }) {
  return (
    <span title={`${CAPABILITIES[capability].label} is not on this event’s plan`} className={`inline-flex items-center text-amber-600 dark:text-amber-400 ${className}`}>
      <Lock size={12} aria-label="Locked" />
    </span>
  );
}
