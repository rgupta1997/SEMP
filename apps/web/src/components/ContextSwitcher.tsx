import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronsUpDown } from 'lucide-react';
import { KIND_META, landingFor, type WorkspaceContext } from '../lib/workspace';
import type { CapabilityKey } from '@semp/entitlements';

// The context switcher (F-012).
//
// Grouped by kind with the personal space first, because that is the one every
// account has. Selecting a context does NOT keep the current page: it lands on that
// context's first permitted nav item, because a page open in the old context must
// never persist into the new one - the same route can mean something different, or
// nothing at all, to a different role.

const POP = "'Poppins',ui-sans-serif,system-ui,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";

const initials = (s: string) => s.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function ContextSwitcher({
  contexts, active, granted, onSwitch,
}: {
  contexts: WorkspaceContext[];
  active: WorkspaceContext | null;
  granted: ReadonlySet<CapabilityKey>;
  onSwitch: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  if (!active) return null;

  const pick = (c: WorkspaceContext) => {
    onSwitch(c.id);
    setOpen(false);
    nav(landingFor(c, granted));
  };

  // Preserve the order the contexts arrived in within each group, so the list does
  // not reshuffle between visits.
  const groups = ['Personal', 'Organizations', 'Events', 'Assignments']
    .map((g) => ({ group: g, items: contexts.filter((c) => KIND_META[c.kind].group === g) }))
    .filter((g) => g.items.length > 0);

  const meta = KIND_META[active.kind];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', cursor: 'pointer',
          padding: '10px 11px', borderRadius: 10, border: '1px solid rgba(255,255,255,.12)',
          background: 'rgba(255,255,255,.05)', color: '#fff', textAlign: 'left',
        }}
      >
        <span aria-hidden style={{
          flex: '0 0 auto', width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center',
          background: meta.tile, color: meta.ink, fontFamily: POP, fontWeight: 800, fontSize: 11.5,
        }}>{initials(active.name)}</span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontFamily: POP, fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {active.name}
          </span>
          <span style={{ display: 'block', fontFamily: MONO, fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase', color: '#9BA9BE', marginTop: 2 }}>
            {active.sub ?? KIND_META[active.kind].group}
          </span>
        </span>
        <ChevronsUpDown size={14} style={{ color: '#9BA9BE', flex: '0 0 auto' }} />
      </button>

      {open && (
        <div role="listbox" style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 40,
          background: '#fff', border: '1px solid #E1E7F0', borderRadius: 12,
          boxShadow: '0 18px 40px -18px rgba(10,26,51,.45)', padding: 6, maxHeight: 380, overflowY: 'auto',
        }}>
          {groups.map((g) => (
            <div key={g.group}>
              <div style={{
                fontFamily: MONO, fontSize: 9, letterSpacing: '.14em', textTransform: 'uppercase',
                color: '#9BA9BE', padding: '8px 9px 4px',
              }}>{g.group}</div>
              {g.items.map((c) => {
                const m = KIND_META[c.kind];
                const isActive = c.id === active.id;
                return (
                  <button
                    key={c.id}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => pick(c)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%', cursor: 'pointer',
                      padding: '8px 9px', borderRadius: 9, border: 'none', textAlign: 'left',
                      background: isActive ? '#F1F6FE' : 'transparent',
                    }}
                  >
                    <span aria-hidden style={{
                      flex: '0 0 auto', width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center',
                      background: m.tile, color: m.ink, fontFamily: POP, fontWeight: 800, fontSize: 11,
                    }}>{initials(c.name)}</span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: POP, fontWeight: 700, fontSize: 13, color: '#0A1A33' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                        {/* Verification is a trust signal, not an access gate - an
                            unverified org still works, it just does not carry the tick. */}
                        {c.kind === 'org' && c.verified && (
                          <Check size={12} style={{ color: '#1E9E5A', flex: '0 0 auto' }} aria-label="Verified" />
                        )}
                      </span>
                      <span style={{ display: 'block', fontSize: 11.5, color: '#6E7E96', marginTop: 1 }}>
                        {c.roleCodes.length
                          ? [...new Set(c.roleCodes)].map((r) => r.replace(/_/g, ' ')).join(' · ')
                          : c.sub ?? 'My Space'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
