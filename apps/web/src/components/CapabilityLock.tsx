import { Lock } from 'lucide-react';
import type { CapabilityKey } from '@semp/entitlements';
import { CAPABILITIES } from '@semp/entitlements';

// What a surface looks like when the subscription does not include it.
//
// One component, because the rule it embodies has to hold everywhere: name the
// CAPABILITY, never the price. A locked screen that quotes a figure turns every
// wall in the product into a sales page, and the plan screen is the one place
// where naming what it costs is the whole job.
//
// Shown rather than hidden, too. Somebody who cannot find a feature assumes it
// does not exist; somebody who can see it locked knows what to ask for.

const MONO = "'JetBrains Mono',ui-monospace,monospace";
const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";

export function CapabilityLock({ capability, title }: { capability: CapabilityKey; title?: string }) {
  const def = CAPABILITIES[capability];
  return (
    <div style={{
      background: '#fff', border: '1px dashed #C8D2E0', borderRadius: 14,
      padding: 44, textAlign: 'center',
    }}>
      <div aria-hidden style={{
        width: 44, height: 44, margin: '0 auto 16px', borderRadius: 12,
        background: '#FCF0DB', color: '#E9920B', display: 'grid', placeItems: 'center',
      }}><Lock size={20} /></div>
      <div style={{ fontFamily: POP, fontWeight: 800, fontSize: 19 }}>
        {title ?? def.label} is not on this plan
      </div>
      <div style={{
        fontSize: 13.5, color: '#6E7E96', marginTop: 8, maxWidth: 420,
        marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6,
      }}>
        {def.surface} needs <span style={{ fontFamily: MONO, fontSize: 12 }}>{capability}</span>,
        which is not granted on your current plan.
      </div>
    </div>
  );
}
