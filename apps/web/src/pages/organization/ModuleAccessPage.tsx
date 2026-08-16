import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { OrgTabs } from '../../components/OrgTabs';
import { Button, Card, CardBody, CardHeader, PageHeader, Spinner, toast } from '../../components/ui';

// Module access by audience (J6-E2-S1).
//
// A grid of modules against the two audiences, which is the whole feature: one
// screen, one place to switch something off. Unticking a box does not merely
// hide navigation - the same flags gate `can()` on the server, so the module is
// genuinely unreachable for that audience (J6-E2-S3).

type Audience = 'staff' | 'students';

interface ModuleSettings { [key: string]: Audience[] | undefined }

interface Payload {
  catalogue: { key: string; label: string }[];
  audiences: Audience[];
  settings: ModuleSettings;
  my_audience: Audience | null;
  my_modules: string[];
}

const AUDIENCE_LABEL: Record<Audience, string> = { staff: 'Staff', students: 'Students' };

export function ModuleAccessPage() {
  const { orgId } = useParams();
  const { data, isLoading, refetch } = useApi<Payload>(orgId ? `/organizations/${orgId}/settings/modules` : null);
  const [draft, setDraft] = useState<ModuleSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (data) setDraft(data.settings); }, [data]);

  // The tabs render before the payload does - this screen is reached from them, so
  // waiting on the fetch to draw the way back would strand the admin on a spinner.
  if (isLoading || !data || !draft) {
    return <div>{orgId && <OrgTabs orgId={orgId} />}<Spinner /></div>;
  }

  // A module absent from the stored map is ON for everyone, so an unconfigured
  // module renders with both boxes ticked rather than as an empty row nobody can
  // interpret.
  const allowed = (key: string): Audience[] => draft[key] ?? data.audiences;
  const isOn = (key: string, audience: Audience) => allowed(key).includes(audience);

  const toggle = (key: string, audience: Audience) => {
    const current = allowed(key);
    const next = current.includes(audience) ? current.filter((a) => a !== audience) : [...current, audience];
    setDraft({ ...draft, [key]: next });
  };

  const save = async () => {
    setSaving(true);
    try {
      // Every module is written explicitly, including the ones left at their
      // default. Storing "absent = on" only for untouched rows would make the
      // saved state depend on what the admin happened to click.
      const modules: ModuleSettings = {};
      for (const m of data.catalogue) modules[m.key] = allowed(m.key);
      await api('PATCH', `/organizations/${orgId}/settings/modules`, { modules });
      toast.success('Module access updated');
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {orgId && <OrgTabs orgId={orgId} />}
      <PageHeader
        title="Module access"
        subtitle="Choose which parts of the workspace each audience can reach. A module switched off disappears from their navigation and its endpoints refuse them."
      />

      <Card>
        <CardHeader
          title="Modules"
          subtitle="Staff are owners, admins and captains. Students are members and alumni."
        />
        <CardBody className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-2 pr-4">Module</th>
                  {data.audiences.map((a) => <th key={a} className="px-3 py-2 text-center">{AUDIENCE_LABEL[a]}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.catalogue.map((m) => (
                  <tr key={m.key}>
                    <td className="py-2.5 pr-4 font-medium">{m.label}</td>
                    {data.audiences.map((a) => (
                      <td key={a} className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand-600"
                          checked={isOn(m.key, a)}
                          onChange={() => toggle(m.key, a)}
                          aria-label={`${m.label} for ${AUDIENCE_LABEL[a]}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Switching a module off applies to everyone in that audience, whatever roles they hold.
            </p>
            <Button size="sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
