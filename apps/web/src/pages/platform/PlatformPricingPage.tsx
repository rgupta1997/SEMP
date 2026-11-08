import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, RotateCcw } from 'lucide-react';
import { api } from '../../lib/api';
import { useApi, useApiMutation } from '../../lib/hooks';
import { Badge, Button, Card, confirmDialog, Field, Input, Modal, Select, Spinner, Tabs, Textarea, toast, Toggle } from '../../components/ui';

// Super-admin console for everything commercial. Every value here overlays a
// default written in code (packages/entitlements); "Reset" drops the overlay.
// Saves reach every API server within about a minute.

type Ladder = 'org' | 'personal';
interface Price { monthly: number | null; annual: number | null }
interface Slot {
  ladder: Ladder; tier: string; name: string; tagline: string; price: Price; eventPass: number | null;
  selfServe: boolean; offered: boolean; featured: boolean; adds: string[];
  limits: Record<string, number | null>; overridden: boolean;
}
interface LimitDef { key: string; label: string; unit: string; ladder: Ladder; scope: 'org' | 'event' }
interface CapDef { key: string; label: string; surface: string; ladder: Ladder; minTier: string; defaultMinTier: string }
interface Settings { defaultOrgPlan: string; defaultFormats: string[]; graceDays: number }
interface Catalog {
  version: string; tiers: string[]; tierLabels: Record<Ladder, Record<string, string>>;
  org: Slot[]; personal: Slot[]; limits: LimitDef[]; capabilities: CapDef[]; settings: Settings;
}

const CATALOG = '/platform/billing/catalog';
const rupees = (p: number | null | undefined) => (p === null || p === undefined ? '' : String(p / 100));
const paise = (r: string): number | null => (r.trim() === '' ? null : Math.round(Number(r) * 100));

export function PlatformPricingPage() {
  const { data, isLoading } = useApi<Catalog>(CATALOG);
  const [tab, setTab] = useState('plans');
  if (isLoading || !data) return <div className="grid h-40 place-items-center"><Spinner /></div>;
  return (
    <div className="max-w-6xl">
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Plans, prices, limits, what each plan includes, add-ons and coupons. Changes apply to every server within about a minute.
        Plans are only enforced while the switch on <Link className="underline" to="/platform/plans">Plans &amp; Billing</Link> is on.
      </p>
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'plans', label: 'Plans & limits' },
          { id: 'features', label: 'Features' },
          { id: 'settings', label: 'Settings' },
          { id: 'addons', label: 'Add-ons' },
          { id: 'coupons', label: 'Coupons' },
        ]}
      />
      <div className="mt-5">
        {tab === 'plans' && <PlansTab cat={data} />}
        {tab === 'features' && <FeaturesTab cat={data} />}
        {tab === 'settings' && <SettingsTab cat={data} />}
        {tab === 'addons' && <AddonsTab cat={data} />}
        {tab === 'coupons' && <CouponsTab cat={data} />}
      </div>
    </div>
  );
}

// ---- plans -------------------------------------------------------------------

function PlansTab({ cat }: { cat: Catalog }) {
  const [ladder, setLadder] = useState<Ladder>('org');
  const slots = ladder === 'org' ? cat.org : cat.personal;
  const limits = cat.limits.filter((l) => l.ladder === ladder);
  return (
    <div>
      <div className="mb-4 flex gap-2">
        <Button size="sm" variant={ladder === 'org' ? 'primary' : 'outline'} onClick={() => setLadder('org')}>Organisation plans</Button>
        <Button size="sm" variant={ladder === 'personal' ? 'primary' : 'outline'} onClick={() => setLadder('personal')}>Personal plans</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {slots.map((s) => <SlotCard key={`${ladder}-${s.tier}-${cat.version}`} slot={s} limits={limits} />)}
      </div>
    </div>
  );
}

function SlotCard({ slot, limits }: { slot: Slot; limits: LimitDef[] }) {
  const [f, setF] = useState(() => ({
    name: slot.name, tagline: slot.tagline,
    monthly: rupees(slot.price.monthly), annual: rupees(slot.price.annual), eventPass: rupees(slot.eventPass),
    selfServe: slot.selfServe, offered: slot.offered, featured: slot.featured,
    adds: slot.adds.join('\n'),
    limits: Object.fromEntries(limits.map((l) => [l.key, slot.limits[l.key] === null || slot.limits[l.key] === undefined ? '' : String(slot.limits[l.key])])),
  }));
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const path = `/platform/billing/catalog/plans/${slot.ladder}/${slot.tier}`;
  const save = useApiMutation((b: any) => api('PUT', path, b), [CATALOG, '/billing/plans']);
  const reset = useApiMutation(() => api('DELETE', path), [CATALOG, '/billing/plans']);

  const submit = () => save.mutate({
    name: f.name, tagline: f.tagline,
    price: { monthly: paise(f.monthly), annual: paise(f.annual) },
    eventPass: paise(f.eventPass),
    selfServe: f.selfServe, offered: f.offered, featured: f.featured,
    adds: f.adds.split('\n').map((x) => x.trim()).filter(Boolean),
    limits: Object.fromEntries(Object.entries(f.limits).map(([k, v]) => [k, v.trim() === '' ? null : Math.max(0, Math.floor(Number(v)))])),
  }, {
    onSuccess: () => toast.success(`${f.name} saved`),
    onError: (e: any) => toast.error('Could not save', e.message),
  });

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-slate-400">{slot.tier}</span>
          {slot.overridden && <Badge tone="violet">edited</Badge>}
          {!slot.offered && <Badge tone="slate">hidden</Badge>}
        </div>
        {slot.overridden && (
          <button
            title="Back to the code default"
            className="text-slate-400 hover:text-slate-600"
            onClick={async () => {
              if (await confirmDialog({ title: 'Reset this plan?', message: 'Name, prices, limits and copy go back to the defaults in code.', confirmLabel: 'Reset' })) {
                reset.mutate(undefined, { onSuccess: () => toast.success('Reset to defaults') });
              }
            }}
          ><RotateCcw size={14} /></button>
        )}
      </div>
      <Field label="Name" compact><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
      <Field label="Tagline" compact><Input value={f.tagline} onChange={(e) => set('tagline', e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="₹ / month" compact hint="blank = talk to us"><Input inputMode="decimal" value={f.monthly} onChange={(e) => set('monthly', e.target.value)} /></Field>
        <Field label="₹ / year" compact><Input inputMode="decimal" value={f.annual} onChange={(e) => set('annual', e.target.value)} /></Field>
      </div>
      {slot.ladder === 'org' && (
        <Field label="₹ per event (event pass)" compact hint="blank = not sold per event"><Input inputMode="decimal" value={f.eventPass} onChange={(e) => set('eventPass', e.target.value)} /></Field>
      )}
      <div className="mb-3 space-y-2 text-sm">
        <label className="flex items-center justify-between">Shown on plan page <Toggle checked={f.offered} onChange={(v) => set('offered', v)} /></label>
        <label className="flex items-center justify-between">Buy without a call <Toggle checked={f.selfServe} onChange={(v) => set('selfServe', v)} /></label>
        <label className="flex items-center justify-between">Highlight as recommended <Toggle checked={f.featured} onChange={(v) => set('featured', v)} /></label>
      </div>
      {limits.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Limits <span className="font-normal text-slate-400">(blank = unlimited)</span></div>
          <div className="space-y-1.5">
            {limits.map((l) => (
              <label key={l.key} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-600 dark:text-slate-300">{l.label}{l.scope === 'event' && <span className="text-slate-400"> · per event</span>}</span>
                <Input className="!w-20 text-right" inputMode="numeric" value={f.limits[l.key] ?? ''} placeholder="∞" onChange={(e) => set('limits', { ...f.limits, [l.key]: e.target.value })} />
              </label>
            ))}
          </div>
        </div>
      )}
      <Field label="What it adds (one per line)" compact>
        <Textarea rows={5} className="w-full text-xs" value={f.adds} onChange={(e) => set('adds', e.target.value)} />
      </Field>
      <Button className="w-full" disabled={save.isPending} onClick={submit}>{save.isPending ? 'Saving…' : 'Save'}</Button>
    </Card>
  );
}

// ---- features -------------------------------------------------------------------

function FeaturesTab({ cat }: { cat: Catalog }) {
  const [ladder, setLadder] = useState<Ladder>('org');
  const [map, setMap] = useState<Record<string, string>>(() => Object.fromEntries(cat.capabilities.map((c) => [c.key, c.minTier])));
  useEffect(() => setMap(Object.fromEntries(cat.capabilities.map((c) => [c.key, c.minTier]))), [cat.version]);
  const save = useApiMutation((b: any) => api('PUT', '/platform/billing/catalog/capabilities', b), [CATALOG, '/billing/plans', '/me/entitlements']);
  const rows = cat.capabilities.filter((c) => c.ladder === ladder);
  const tiers = cat.tiers.filter((t) => !(ladder === 'personal' && t === 'starter'));
  const dirty = cat.capabilities.some((c) => map[c.key] !== c.minTier);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button size="sm" variant={ladder === 'org' ? 'primary' : 'outline'} onClick={() => setLadder('org')}>Organisation</Button>
          <Button size="sm" variant={ladder === 'personal' ? 'primary' : 'outline'} onClick={() => setLadder('personal')}>Personal</Button>
        </div>
        <Button
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ minTiers: map }, {
            onSuccess: () => toast.success('Features saved'),
            onError: (e: any) => toast.error('Could not save', e.message),
          })}
        >Save features</Button>
      </div>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Pick the cheapest plan that includes each feature. Every plan above it includes it too.</p>
      <Card className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2">Feature</th>
              {tiers.map((t) => <th key={t} className="px-3 py-2 text-center">{cat.tierLabels[ladder][t]}</th>)}
              <th className="px-3 py-2">Included from</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((c) => {
              const rank = tiers.indexOf(map[c.key]);
              return (
                <tr key={c.key}>
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-800 dark:text-slate-200">{c.label}{map[c.key] !== c.defaultMinTier && <Badge tone="violet" className="ml-2">edited</Badge>}</div>
                    <div className="text-xs text-slate-400">{c.surface}</div>
                  </td>
                  {tiers.map((t, i) => (
                    <td key={t} className="px-3 py-2 text-center">{i >= rank ? <span className="text-emerald-600">✓</span> : <Lock size={12} className="inline text-slate-300" />}</td>
                  ))}
                  <td className="px-3 py-2">
                    <Select value={map[c.key]} onChange={(e) => setMap({ ...map, [c.key]: e.target.value })}>
                      {tiers.map((t) => <option key={t} value={t}>{cat.tierLabels[ladder][t]}</option>)}
                    </Select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---- settings -------------------------------------------------------------------

function SettingsTab({ cat }: { cat: Catalog }) {
  const [s, setS] = useState({ ...cat.settings, formats: cat.settings.defaultFormats.join(', ') });
  const save = useApiMutation((b: any) => api('PUT', '/platform/billing/catalog/settings', b), [CATALOG]);
  return (
    <Card className="max-w-xl p-5">
      <Field label="Plan for every new organisation" hint="Applied when an organisation is created - by sign-up, by a super admin, or by an import.">
        <Select className="w-full" value={s.defaultOrgPlan} onChange={(e) => setS({ ...s, defaultOrgPlan: e.target.value })}>
          {cat.tiers.map((t) => <option key={t} value={t}>{cat.tierLabels.org[t]}</option>)}
        </Select>
      </Field>
      <Field label="Default tournament formats" hint="Comma-separated format names usable without the ‘All tournament formats’ feature. Keep Rankings so swimming and athletics work.">
        <Input value={s.formats} onChange={(e) => setS({ ...s, formats: e.target.value })} />
      </Field>
      <Field label="Grace period (days)" hint="How long a running event keeps working after its organisation’s plan drops below it. Then it becomes read-only until renewed.">
        <Input type="number" min={0} max={60} value={s.graceDays} onChange={(e) => setS({ ...s, graceDays: Number(e.target.value) })} />
      </Field>
      <Button
        disabled={save.isPending}
        onClick={() => save.mutate({
          defaultOrgPlan: s.defaultOrgPlan,
          defaultFormats: s.formats.split(',').map((x) => x.trim()).filter(Boolean),
          graceDays: s.graceDays,
        }, { onSuccess: () => toast.success('Settings saved'), onError: (e: any) => toast.error('Could not save', e.message) })}
      >Save settings</Button>
    </Card>
  );
}

// ---- add-ons -------------------------------------------------------------------

interface Addon { key: string; name: string; description: string; unit: string; price_paise: number | null; status: string; included_from: string | null; sort: number }

function AddonsTab({ cat }: { cat: Catalog }) {
  const { data = [], isLoading } = useApi<Addon[]>('/platform/billing/addons');
  const [editing, setEditing] = useState<Addon | 'new' | null>(null);
  if (isLoading) return <Spinner />;
  const statusTone = (s: string) => (s === 'available' ? 'green' : s === 'coming_soon' ? 'amber' : 'slate') as 'green' | 'amber' | 'slate';
  return (
    <div>
      <div className="mb-3 flex justify-end"><Button onClick={() => setEditing('new')}>+ Add-on</Button></div>
      <Card className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            <tr><th className="px-4 py-2">Add-on</th><th className="px-4 py-2">Price</th><th className="px-4 py-2">Included from</th><th className="px-4 py-2">Status</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.map((a) => (
              <tr key={a.key}>
                <td className="px-4 py-2"><div className="font-medium dark:text-slate-200">{a.name}</div><div className="text-xs text-slate-400">{a.description}</div></td>
                <td className="px-4 py-2 whitespace-nowrap">{a.price_paise === null ? '—' : `₹${(a.price_paise / 100).toLocaleString('en-IN')}`} <span className="text-xs text-slate-400">/ {a.unit}</span></td>
                <td className="px-4 py-2">{a.included_from ? cat.tierLabels.org[a.included_from] : '—'}</td>
                <td className="px-4 py-2"><Badge tone={statusTone(a.status)}>{a.status.replace('_', ' ')}</Badge></td>
                <td className="px-4 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(a)}>Edit</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {editing && <AddonModal addon={editing === 'new' ? null : editing} cat={cat} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AddonModal({ addon, cat, onClose }: { addon: Addon | null; cat: Catalog; onClose: () => void }) {
  const [f, setF] = useState({
    key: addon?.key ?? '', name: addon?.name ?? '', description: addon?.description ?? '', unit: addon?.unit ?? 'month',
    price: rupees(addon?.price_paise ?? null), status: addon?.status ?? 'coming_soon', included_from: addon?.included_from ?? '', sort: addon?.sort ?? 0,
  });
  const save = useApiMutation(
    (b: any) => (addon ? api('PATCH', `/platform/billing/addons/${addon.key}`, b) : api('POST', '/platform/billing/addons', b)),
    ['/platform/billing/addons', '/billing/plans'],
  );
  return (
    <Modal
      title={addon ? `Edit ${addon.name}` : 'New add-on'}
      onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button
        disabled={save.isPending}
        onClick={() => save.mutate({
          ...(addon ? {} : { key: f.key }), name: f.name, description: f.description, unit: f.unit,
          price_paise: paise(f.price), status: f.status, included_from: f.included_from || null, sort: Number(f.sort) || 0,
        }, { onSuccess: () => { toast.success('Add-on saved'); onClose(); }, onError: (e: any) => toast.error('Could not save', e.message) })}
      >Save</Button></div>}
    >
      {!addon && <Field label="Key" hint="lowercase_with_underscores, permanent"><Input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} /></Field>}
      <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Description"><Textarea rows={2} className="w-full" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Price (₹)"><Input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field label="Per"><Select className="w-full" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}><option value="month">month</option><option value="event">event</option><option value="pack">pack (one-off)</option></Select></Field>
        <Field label="Status"><Select className="w-full" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="available">Available</option><option value="coming_soon">Coming soon</option><option value="hidden">Hidden</option></Select></Field>
        <Field label="Free from plan"><Select className="w-full" value={f.included_from} onChange={(e) => setF({ ...f, included_from: e.target.value })}><option value="">Never (always paid)</option>{cat.tiers.map((t) => <option key={t} value={t}>{cat.tierLabels.org[t]}</option>)}</Select></Field>
      </div>
    </Modal>
  );
}

// ---- coupons -------------------------------------------------------------------

interface Coupon {
  code: string; description: string; kind: 'percent' | 'flat'; value: number; ladder: Ladder;
  tiers: string[]; periods: string[]; valid_from: string | null; valid_until: string | null;
  max_redemptions: number | null; redemptions: number; active: boolean;
}

function CouponsTab({ cat }: { cat: Catalog }) {
  const { data = [], isLoading } = useApi<Coupon[]>('/platform/billing/coupons');
  const [editing, setEditing] = useState<Coupon | 'new' | null>(null);
  const toggle = useApiMutation((c: Coupon) => api('PATCH', `/platform/billing/coupons/${c.code}`, { active: !c.active }), ['/platform/billing/coupons']);
  if (isLoading) return <Spinner />;
  const off = (c: Coupon) => (c.kind === 'percent' ? `${c.value / 100}% off` : `₹${(c.value / 100).toLocaleString('en-IN')} off`);
  return (
    <div>
      <div className="mb-3 flex justify-end"><Button onClick={() => setEditing('new')}>+ Coupon</Button></div>
      {data.length === 0 ? <Card className="p-6 text-center text-sm text-slate-500">No coupons yet.</Card> : (
        <Card className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <tr><th className="px-4 py-2">Code</th><th className="px-4 py-2">Discount</th><th className="px-4 py-2">Applies to</th><th className="px-4 py-2">Used</th><th className="px-4 py-2">Valid</th><th className="px-4 py-2">Active</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.map((c) => (
                <tr key={c.code}>
                  <td className="px-4 py-2"><div className="font-mono font-semibold dark:text-slate-200">{c.code}</div><div className="text-xs text-slate-400">{c.description}</div></td>
                  <td className="px-4 py-2">{off(c)}</td>
                  <td className="px-4 py-2 text-xs">{c.tiers?.length ? c.tiers.map((t) => cat.tierLabels[c.ladder][t]).join(', ') : 'All plans'} · {c.periods?.length ? c.periods.join(', ') : 'any billing'}</td>
                  <td className="px-4 py-2">{c.redemptions}{c.max_redemptions ? ` / ${c.max_redemptions}` : ''}</td>
                  <td className="px-4 py-2 text-xs">{c.valid_until ? `until ${new Date(c.valid_until).toLocaleDateString('en-IN')}` : 'no end'}</td>
                  <td className="px-4 py-2"><Toggle checked={c.active} onChange={() => toggle.mutate(c)} /></td>
                  <td className="px-4 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(c)}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {editing && <CouponModal coupon={editing === 'new' ? null : editing} cat={cat} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CouponModal({ coupon, cat, onClose }: { coupon: Coupon | null; cat: Catalog; onClose: () => void }) {
  const [f, setF] = useState({
    code: coupon?.code ?? '', description: coupon?.description ?? '', kind: coupon?.kind ?? 'percent',
    amount: coupon ? String(coupon.kind === 'percent' ? coupon.value / 100 : coupon.value / 100) : '',
    ladder: coupon?.ladder ?? 'org' as Ladder, tiers: coupon?.tiers ?? [], periods: coupon?.periods ?? [],
    valid_until: coupon?.valid_until ? coupon.valid_until.slice(0, 10) : '', max: coupon?.max_redemptions ? String(coupon.max_redemptions) : '',
  });
  const save = useApiMutation(
    (b: any) => (coupon ? api('PATCH', `/platform/billing/coupons/${coupon.code}`, b) : api('POST', '/platform/billing/coupons', b)),
    ['/platform/billing/coupons'],
  );
  const tierOpts = useMemo(() => cat.tiers.filter((t) => t !== 'free' && !(f.ladder === 'personal' && t === 'starter')), [cat.tiers, f.ladder]);
  const flip = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <Modal
      title={coupon ? `Edit ${coupon.code}` : 'New coupon'}
      onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button
        disabled={save.isPending}
        onClick={() => save.mutate({
          ...(coupon ? {} : { code: f.code, ladder: f.ladder }),
          description: f.description, kind: f.kind,
          // percent is stored in basis points, flat in paise - both are ×100
          value: Math.round(Number(f.amount) * 100),
          tiers: f.tiers.length ? f.tiers : null, periods: f.periods.length ? f.periods : null,
          valid_until: f.valid_until ? new Date(`${f.valid_until}T23:59:59`).toISOString() : null,
          max_redemptions: f.max ? Number(f.max) : null,
        }, { onSuccess: () => { toast.success('Coupon saved'); onClose(); }, onError: (e: any) => toast.error('Could not save', e.message) })}
      >Save</Button></div>}
    >
      {!coupon && <Field label="Code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="LAUNCH20" /></Field>}
      <Field label="Description"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type"><Select className="w-full" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'percent' | 'flat' })}><option value="percent">Percentage</option><option value="flat">Flat amount</option></Select></Field>
        <Field label={f.kind === 'percent' ? 'Percent off' : '₹ off'}><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        {!coupon && <Field label="Ladder"><Select className="w-full" value={f.ladder} onChange={(e) => setF({ ...f, ladder: e.target.value as Ladder, tiers: [] })}><option value="org">Organisation</option><option value="personal">Personal</option></Select></Field>}
        <Field label="Max uses" hint="blank = unlimited"><Input inputMode="numeric" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} /></Field>
        <Field label="Valid until" hint="blank = no end"><Input type="date" value={f.valid_until} onChange={(e) => setF({ ...f, valid_until: e.target.value })} /></Field>
      </div>
      <div className="mb-3 text-xs font-semibold text-slate-600 dark:text-slate-300">Plans (none ticked = all)</div>
      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        {tierOpts.map((t) => <label key={t} className="flex items-center gap-1.5"><input type="checkbox" checked={f.tiers.includes(t)} onChange={() => setF({ ...f, tiers: flip(f.tiers, t) })} />{cat.tierLabels[f.ladder][t]}</label>)}
      </div>
      <div className="mb-3 text-xs font-semibold text-slate-600 dark:text-slate-300">Billing (none ticked = both)</div>
      <div className="flex gap-3 text-sm">
        {['monthly', 'annual'].map((p) => <label key={p} className="flex items-center gap-1.5"><input type="checkbox" checked={f.periods.includes(p)} onChange={() => setF({ ...f, periods: flip(f.periods, p) })} />{p}</label>)}
      </div>
    </Modal>
  );
}
