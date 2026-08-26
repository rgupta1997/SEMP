import { useSearchParams } from 'react-router-dom';
import { CAPABILITIES, type CapabilityKey } from '@semp/entitlements';
import { PageHeader } from '../components/ui';
import { PlanSurface } from '../components/PlanSurface';

// My plan (PG-07). The personal ladder, reached from the avatar menu and from
// any locked surface on a player's own profile.
//
// The org ladder is NOT here - it lives on the institution's Billing &
// Subscription tab, where the people who can actually buy it are. Putting both
// on one screen was the prototype's arrangement and it invited the exact
// confusion the two-ladder model exists to prevent: an Enterprise institution
// does not make its players Elite, and a page showing both side by side reads
// as though it might.

export function PlanPage() {
  const [params] = useSearchParams();

  // Arrived from a wall. Naming what was blocked turns a generic plan page into
  // an answer to the question the person actually has - and it is the one place
  // where the capability and the price may appear together.
  const from = params.get('capability') as CapabilityKey | null;
  const blocked = from && CAPABILITIES[from] ? CAPABILITIES[from] : null;

  return (
    <>
      <PageHeader
        title="My plan"
        subtitle={
          blocked
            ? `${blocked.label} is not on your current plan. Here is what each one includes.`
            : 'What your plan includes, and what the others do.'
        }
      />
      <PlanSurface ladder="personal" statePath="/billing/me" actionPath="/billing/me" />
    </>
  );
}
