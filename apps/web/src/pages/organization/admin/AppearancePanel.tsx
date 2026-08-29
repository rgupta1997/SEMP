import { useEffect, useState } from 'react';
import { Check, Info, Palette, RotateCcw } from 'lucide-react';
import { api } from '../../../lib/api';
import { useApi } from '../../../lib/hooks';
import { usePermissions } from '../../../lib/permissions';
import {
  applyTenantTheme, contrastsWithWhite, hexToHsl, BRAND_PRESETS, DEFAULT_BRAND, type TenantTheme,
} from '../../../lib/tenant-theme';
import { Badge, Button, Card, CardBody, Input, cn, toast } from '../../../components/ui';
import { QueryState } from '../../../components/primitives';

/**
 * Administration → Appearance.
 *
 * An institution picks ONE colour and the whole workspace follows it: the sidebar,
 * the active nav item, primary buttons, focus rings, links, chips, the bottom tab
 * bar. Everything is derived from that colour by index.css, which expresses every
 * `--color-brand-*` step as an hsl() of three seed variables - so this screen
 * writes three numbers and the product rebrands.
 *
 * WHY NOT A TEN-STOP PALETTE EDITOR. A school is choosing their colour, not
 * authoring a design system. Deriving the ramp keeps the lightness relationships
 * the interface was drawn against, which is what makes the same screens legible in
 * maroon, forest green and orange rather than only in a blue of the same value. Ten
 * free-hand steps would let somebody set a 400 darker than their 600 and break
 * contrast everywhere at once, with no way to see it until a customer complained.
 *
 * THE PREVIEW IS THE PAGE. Picking a swatch repaints the live interface
 * immediately - the sidebar beside you, the button under your cursor - rather than
 * a postage-stamp mock. Leaving without saving puts it back. A colour picker whose
 * result you cannot see until you commit is how tenants end up with a workspace
 * nobody likes and nobody will admit to choosing.
 */
export function AppearancePanel({ orgId }: { orgId: string }) {
  const canManage = usePermissions().hasOrgPermission('org.manage', orgId);
  const q = useApi<{ theme: TenantTheme }>(`/organizations/${orgId}/settings/appearance`);

  const saved = q.data?.theme?.brand ?? null;
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The colour on screen is the draft where there is one, the saved value
  // otherwise - so the preview and the controls can never disagree.
  const current = draft ?? saved ?? DEFAULT_BRAND;
  const dirty = draft !== null && draft !== (saved ?? DEFAULT_BRAND);

  // Live preview, and put it back on the way out. The cleanup is what makes it
  // safe to try six colours and walk away: an unsaved choice must not follow you
  // to the next screen.
  useEffect(() => {
    if (draft === null) return;
    applyTenantTheme({ brand: draft });
    return () => applyTenantTheme({ brand: saved });
  }, [draft, saved]);

  const legible = contrastsWithWhite(current);
  const hsl = hexToHsl(current);

  async function save(value: string | null) {
    setBusy(true);
    try {
      await api('PATCH', `/organizations/${orgId}/settings/appearance`, { brand: value });
      await q.refetch();
      setDraft(null);
      applyTenantTheme({ brand: value });
      toast.success(value ? 'Workspace colour saved' : 'Back to the Sportagon colour');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save that');
    } finally { setBusy(false); }
  }

  return (
    <QueryState query={q} errorTitle="Could not load appearance settings">
      <div className="flex flex-col gap-4">
        <Card>
          <CardBody className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white"
              ><Palette size={18} /></span>
              <div className="min-w-0">
                <h3 className="t-section text-slate-900 dark:text-slate-100">Workspace colour</h3>
                <p className="t-meta mt-1 max-w-prose">
                  One colour, and the whole workspace follows it — the sidebar, buttons,
                  links and highlights. Everyone in this organisation sees it; people in
                  their own space or in someone else’s event do not.
                </p>
              </div>
            </div>

            {/* ---- presets ---- */}
            <div>
              <div className="t-eyebrow mb-2">Pick one</div>
              <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
                {BRAND_PRESETS.map((p) => {
                  const on = current.toLowerCase() === p.hex.toLowerCase();
                  return (
                    <button
                      key={p.hex}
                      type="button"
                      disabled={!canManage || busy}
                      onClick={() => setDraft(p.hex)}
                      title={p.name}
                      aria-label={p.name}
                      aria-pressed={on}
                      className={cn(
                        // Square, 44px, and the check is inside the swatch - a tick
                        // beside it would double the row height on a phone.
                        'grid aspect-square w-full place-items-center rounded-xl ring-offset-2 transition-transform',
                        'ring-offset-white dark:ring-offset-slate-900',
                        on ? 'ring-2 ring-slate-900 dark:ring-white' : 'hover:scale-105',
                        !canManage && 'cursor-not-allowed opacity-60',
                      )}
                      style={{ backgroundColor: p.hex }}
                    >
                      {on && <Check size={16} className="text-white" strokeWidth={3} />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ---- exact value ---- */}
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-0 flex-1">
                <span className="t-eyebrow mb-1.5 block">Or enter your own</span>
                <div className="flex items-center gap-2">
                  {/* The native picker and the hex field edit the same value. An
                      institution with a brand book types the hex; everyone else drags. */}
                  <input
                    type="color"
                    value={current}
                    disabled={!canManage || busy}
                    onChange={(e) => setDraft(e.target.value.toUpperCase())}
                    aria-label="Choose a colour"
                    className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800"
                  />
                  <Input
                    value={current}
                    disabled={!canManage || busy}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase();
                      setDraft(v.startsWith('#') ? v : `#${v}`);
                    }}
                    className="font-mono uppercase"
                    maxLength={7}
                    spellCheck={false}
                    aria-label="Colour hex value"
                  />
                </div>
              </label>
              {hsl && (
                <div className="t-meta hidden shrink-0 pb-2.5 font-mono sm:block">
                  H {hsl.h}° · S {Math.round(hsl.s)}% · L {Math.round(hsl.l)}%
                </div>
              )}
            </div>

            {/* The one warning worth giving: every primary surface puts white text
                on this colour, so a pale choice is unreadable rather than merely
                unusual. It is darkened rather than refused, and told why. */}
            {!legible && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/30">
                <Info size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="t-body-sm text-amber-800 dark:text-amber-200">
                  That colour is too light to carry white text, so buttons and the sidebar
                  would be hard to read. We’ll darken it slightly and keep your hue.
                </p>
              </div>
            )}

            {/* ---- what it affects ---- */}
            <div className="rounded-xl border border-eos-line p-3.5 dark:border-slate-800">
              <div className="t-eyebrow mb-2.5">Preview</div>
              <div className="flex flex-wrap items-center gap-2.5">
                <Button size="sm">Primary action</Button>
                <Button size="sm" variant="subtle">Secondary</Button>
                <Badge tone="brand">Chip</Badge>
                <a href="#preview" onClick={(e) => e.preventDefault()} className="text-sm font-semibold text-brand-600 dark:text-brand-400">A link</a>
                <span className="h-8 w-16 rounded-lg" style={{ background: 'var(--sidebar-bg)' }} title="Sidebar" />
              </div>
              <p className="t-meta mt-2.5">
                The sidebar, the mobile tab bar and every focus ring follow the same colour.
              </p>
            </div>
          </CardBody>
        </Card>

        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => save(current)} disabled={!dirty || busy}>
              {busy ? 'Saving…' : 'Save colour'}
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft(null)} disabled={busy}>Cancel</Button>
            )}
            {saved && !dirty && (
              <Button variant="ghost" onClick={() => save(null)} disabled={busy}>
                <RotateCcw size={14} /> Reset to Sportagon blue
              </Button>
            )}
          </div>
        ) : (
          <p className="t-meta">
            An owner or administrator of this organisation can change the workspace colour.
          </p>
        )}
      </div>
    </QueryState>
  );
}
