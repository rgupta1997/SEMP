import { api } from '../../lib/api';
import { fmtDateTime, useApi, useApiMutation } from '../../lib/hooks';
import { Badge, Card, confirmDialog, Spinner, toast, Toggle } from '../../components/ui';

interface PlanSettings { plans_enforced: boolean; updated_at: string | null; updated_by: string | null }

// The one switch for the whole plans system. Off, every organisation and person is
// treated as Enterprise / Elite and the Billing tab is hidden; on, everyone's saved
// plan applies again exactly as it was - nothing is deleted either way.
export function PlatformPlansPage() {
  const { data, isLoading } = useApi<PlanSettings>('/platform/settings');
  const save = useApiMutation(
    (enforced: boolean) => api('PUT', '/platform/settings/plans-enforced', { enforced }),
    ['/platform/settings', '/me/entitlements'],
  );

  if (isLoading || !data) return <div className="grid h-40 place-items-center"><Spinner /></div>;
  const on = data.plans_enforced;

  const flip = async (next: boolean) => {
    const ok = await confirmDialog({
      title: next ? 'Turn plans on?' : 'Turn plans off?',
      message: next
        ? 'Every organisation goes back to its saved plan. Free organisations lose paid features and limits apply again, and the Billing tab reappears.'
        : 'Every organisation and person gets every feature with no limits, and the Billing tab is hidden. Saved plans are kept for when you turn this back on.',
      confirmLabel: next ? 'Turn plans on' : 'Turn plans off',
      tone: next ? 'danger' : 'primary',
    });
    if (!ok) return;
    save.mutate(next, {
      onSuccess: () => toast.success(next ? 'Plans are on' : 'Plans are off - everyone has Enterprise'),
      onError: (e: any) => toast.error('Could not change plans', e.message),
    });
  };

  return (
    <div className="max-w-2xl">
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Platform-wide. Only platform admins can see or change this.
      </p>
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold dark:text-slate-100">
              Plans &amp; billing
              <Badge tone={on ? 'amber' : 'green'}>{on ? 'On - plans apply' : 'Off - everyone has Enterprise'}</Badge>
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {on
                ? 'Each organisation gets what its plan includes, and admins see the Billing & Subscription tab.'
                : 'Every organisation and person has every feature with no limits. The Billing & Subscription tab is hidden.'}
            </p>
          </div>
          <Toggle checked={on} onChange={(v) => { if (!save.isPending) void flip(v); }} />
        </div>
        {data.updated_at && (
          <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
            Last changed {fmtDateTime(data.updated_at)}{data.updated_by ? ` by ${data.updated_by}` : ''}. Other servers pick up a change within about 15 seconds.
          </p>
        )}
      </Card>
    </div>
  );
}
