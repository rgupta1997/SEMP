import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import type { CapabilityKey } from '@semp/entitlements';
import { CAPABILITIES } from '@semp/entitlements';
import { api } from '../lib/api';
import { useWorkspace } from '../lib/useWorkspace';
import { Button, toast } from './ui';

// What a surface looks like when the subscription does not include it.
//
// One component, because the rule it embodies has to hold everywhere: name the
// CAPABILITY, never the price. A locked screen that quotes a figure turns every
// wall in the product into a sales page, and the plan screen is the one place
// where naming what it costs is the whole job.
//
// Shown rather than hidden, too. Somebody who cannot find a feature assumes it
// does not exist; somebody who can see it locked knows what to ask for.
//
// What it now also does is give them somewhere to go. A wall with no way past it
// is a dead end, and the two ways past differ by who is standing at it: whoever
// can buy is sent to the plan surface, and whoever cannot can ask them to. That
// second case is the common one - a Sports Admin hits these walls far more often
// than an owner does.

export function CapabilityLock({ capability, title }: { capability: CapabilityKey; title?: string }) {
  const def = CAPABILITIES[capability];
  const navigate = useNavigate();
  const ws = useWorkspace();

  const isOrg = def.ladder === 'org';
  // The institution this wall stands in. Org capabilities are a property of the
  // tenant, so the route out has to name it rather than assume one.
  const orgId = isOrg && ws.active?.kind === 'org' ? ws.active.id : null;

  async function askForIt() {
    if (!orgId) return;
    try {
      await api('POST', `/billing/org/${orgId}/request-upgrade`, { capability });
      toast.success('Sent', 'The people who can change the plan have been notified.');
    } catch (e: any) {
      toast.error('Could not send that', e?.message);
    }
  }

  return (
    <div className="rounded-card border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
      <div
        aria-hidden
        className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
      >
        <Lock size={20} />
      </div>

      <div className="text-lg font-extrabold tracking-tight dark:text-slate-100">
        {title ?? def.label} is not on this plan
      </div>

      {/* The capability and what it unlocks. Never the tier, never the price -
          see the structural test in the registry that asserts this copy cannot
          learn either. */}
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        {def.surface} needs{' '}
        <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{capability}</span>,
        which is not granted on your current plan.
      </p>

      <div className="mt-5 flex justify-center gap-2">
        {isOrg ? (
          orgId ? (
            // Both actions exist for a reason: the plan page is where the buyer
            // goes, and it is also where somebody who cannot buy sees what they
            // are asking for before they ask. So the ask is offered here too,
            // rather than only being reachable through a page they may not open.
            <>
              <Button onClick={() => navigate(`/organizations/${orgId}/admin?tab=billing`)}>
                See plans
              </Button>
              <Button variant="outline" onClick={askForIt}>Ask an admin</Button>
            </>
          ) : null
        ) : (
          <Button onClick={() => navigate(`/plans?capability=${capability}`)}>
            See plans
          </Button>
        )}
      </div>
    </div>
  );
}
