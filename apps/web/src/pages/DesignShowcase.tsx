import { useState } from 'react';
import { BRAND } from '../lib/brand';
import {
  Avatar, Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Input,
  Modal, PageHeader, Pagination, Progress, ProgressSteps, SearchInput, Segmented,
  Select, Skeleton, Spinner, StatCard, StatusBadge, Stepper, Tabs, Textarea, Toast, Toggle,
  useToast,
} from '../components/ui';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="flex flex-wrap items-center gap-3">{children}</CardBody>
    </Card>
  );
}

// One-stop visual reference for the app design system. Visit /design.
export function DesignShowcase() {
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [tab, setTab] = useState('one');
  const [seg, setSeg] = useState<'grid' | 'list'>('grid');
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  return (
    <div className="space-y-6">
      <PageHeader title="Design system" subtitle={`Live reference for the ${BRAND.name} UI kit - every element below is the real component.`} />

      <Section title="Buttons - variants × sizes × states">
        <Button>Primary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="subtle">Subtle</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button disabled>Disabled</Button>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
      </Section>

      <Section title="Badges & status (info + LIVE are new)">
        <Badge tone="brand">brand</Badge>
        <Badge tone="green">green</Badge>
        <Badge tone="amber">amber</Badge>
        <Badge tone="rose">rose</Badge>
        <Badge tone="slate">slate</Badge>
        <Badge tone="violet">violet</Badge>
        <Badge tone="info">info</Badge>
        <Badge tone="live">LIVE</Badge>
        <StatusBadge status="registration_open" />
        <StatusBadge status="completed" />
        <StatusBadge status="roster_locked" />
      </Section>

      <Section title="Form controls (focus an input to see the brand ring)">
        <div className="w-full max-w-sm space-y-3">
          <Field label="Text input"><Input placeholder="Type here…" /></Field>
          <Field label="Select"><Select><option>Option A</option><option>Option B</option></Select></Field>
          <Field label="Textarea"><Textarea rows={2} placeholder="Notes…" /></Field>
          <SearchInput value={search} onChange={setSearch} placeholder="Search…" className="w-full" />
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={checked} onChange={setChecked} /> Checkbox</label>
            <Toggle checked={on} onChange={setOn} />
            <Segmented value={seg} onChange={setSeg} options={[{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }]} />
          </div>
        </div>
      </Section>

      <Section title="Stat cards & avatars">
        <div className="grid w-full gap-3 sm:grid-cols-3">
          <StatCard label="Teams" value={128} />
          <StatCard label="Matches" value={342} accent />
          <StatCard label="Live now" value={6} hint="across 5 venues" />
        </div>
        <div className="flex items-center gap-2">
          <Avatar name="Rohit Gupta" size={48} />
          <Avatar name="Mumbai Tigers" size={36} />
          <Avatar name="AB" size={28} />
        </div>
      </Section>

      <Section title="Progress & step progress (mono percentages)">
        <div className="w-full max-w-md space-y-3">
          <Progress value={75} label="Teams registered" />
          <Progress value={48} tone="green" label="Fixtures scheduled" />
          <Progress value={90} tone="rose" label="Capacity used" />
          <ProgressSteps total={5} current={3} label="Setup progress" />
        </div>
      </Section>

      <Section title="Skeleton loaders & spinner">
        <div className="w-full max-w-md space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10" rounded="rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-2.5 w-2/5" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Spinner label="Loading fixtures…" />
        </div>
      </Section>

      <Section title="Toasts - click to fire (bottom-right)">
        <Button variant="outline" onClick={() => toast.push({ type: 'success', title: 'Match signed off', message: 'Result recorded.' })}>Success</Button>
        <Button variant="outline" onClick={() => toast.push({ type: 'info', title: 'Draw generated', message: '48 fixtures created.' })}>Info</Button>
        <Button variant="outline" onClick={() => toast.push({ type: 'warning', title: 'Approval pending', message: '3 organizations waiting.' })}>Warning</Button>
        <Button variant="outline" onClick={() => toast.push({ type: 'error', title: 'Save failed', message: 'Network error.' })}>Error</Button>
        <Toast type="success" title="Inline toast" message="Also usable standalone." />
      </Section>

      <Section title="Tabs, stepper, pagination & modal">
        <div className="w-full space-y-4">
          <Tabs active={tab} onChange={setTab} tabs={[{ id: 'one', label: 'Overview' }, { id: 'two', label: 'Schedule' }, { id: 'three', label: 'Results' }]} />
          <Stepper current={1} steps={['Profile', 'Tournaments', 'Venues', 'Go live']} />
          <Pagination page={page} pageCount={5} total={58} pageSize={12} onPage={setPage} />
          <Button onClick={() => setModal(true)}>Open modal</Button>
        </div>
      </Section>

      <Section title="Cards - hover to see the lift">
        <div className="grid w-full gap-3 sm:grid-cols-3">
          {['Cricket', 'Football', 'Basketball'].map((s) => (
            <Card key={s} interactive className="p-4">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{s}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Hover me</div>
            </Card>
          ))}
        </div>
      </Section>

      <EmptyState icon="◆" title="EmptyState component" description="Used across the app for zero-data screens." action={<Button>Primary action</Button>} />

      {modal && (
        <Modal title="Confirm final result" onClose={() => setModal(false)}>
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">This completes the match and updates standings.</p>
          <div className="rounded-xl bg-slate-50 p-4 text-center dark:bg-slate-800/60">
            <div className="font-mono text-3xl font-extrabold text-slate-900 dark:text-slate-100">62 – 58</div>
            <div className="mt-1 text-sm font-semibold text-emerald-600">Mumbai Tigers win</div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={() => { setModal(false); toast.push({ type: 'success', title: 'Result signed off' }); }}>Sign off</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
