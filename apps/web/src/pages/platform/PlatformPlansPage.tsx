import { api } from '../../lib/api';
import { fmtDateTime, useApi, useApiMutation } from '../../lib/hooks';
import { Badge, Card, confirmDialog, Spinner, toast, Toggle } from '../../components/ui';

interface PlanSettings {
  plans_enforced: boolean; updated_at: string | null; updated_by: string | null;
  insights_enabled: boolean; insights_updated_at: string | null; insights_updated_by: string | null;
}

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

      <InsightsSwitch data={data} />
      <MatchFormatsCard />
    </div>
  );
}

interface FormatRow { presetKey: string; name: string; sport: string; shown: boolean; hiddenByDefault: boolean; isDefault: boolean }

/**
 * Which built-in racquet formats organisers can pick. Hiding one only affects new
 * choices - a draw or round already using it keeps it.
 */
function MatchFormatsCard() {
  const { data, isLoading } = useApi<{ formats: FormatRow[]; updated_at: string | null; updated_by: string | null }>('/platform/settings/match-formats');
  const save = useApiMutation(
    (v: { presetKey: string; shown: boolean }) => api('PUT', '/platform/settings/match-formats', v),
    ['/platform/settings/match-formats', '/tournament-disciplines/'],
  );
  if (isLoading || !data) return <Card className="mt-4 grid h-24 place-items-center p-5"><Spinner /></Card>;

  const sports = [...new Set(data.formats.map((f) => f.sport))];
  const flip = (f: FormatRow, shown: boolean) => save.mutate({ presetKey: f.presetKey, shown }, {
    onSuccess: () => toast.success(shown ? `"${f.name}" is offered again` : `"${f.name}" is hidden`),
    onError: (e: any) => toast.error('Could not change the format', e.message),
  });

  return (
    <Card className="mt-4 p-5">
      <h2 className="text-lg font-semibold dark:text-slate-100">Match formats</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Built-in formats organisers can choose for racquet sports. Hidden ones leave the picker for new choices only - a draw already using one keeps it.
      </p>
      <div className="mt-4 space-y-2">
        {sports.map((sport) => {
          const rows = data.formats.filter((f) => f.sport === sport);
          return (
            <details key={sport} className="rounded-lg border border-slate-200 dark:border-slate-800">
              <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm font-semibold capitalize text-slate-700 dark:text-slate-200">
                {sport}
                <span className="text-xs font-normal normal-case text-slate-400">{rows.filter((r) => r.shown).length} of {rows.length} shown</span>
              </summary>
              <ul className="divide-y divide-slate-100 border-t border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {rows.map((f) => (
                  <li key={f.presetKey} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 text-sm text-slate-700 dark:text-slate-200">
                      {f.name}
                      {f.isDefault && <Badge tone="green" className="ml-2">Default</Badge>}
                    </span>
                    {f.isDefault
                      ? <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">Always offered</span>
                      : <Toggle checked={f.shown} onChange={(v) => { if (!save.isPending) flip(f, v); }} />}
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
      {data.updated_at && (
        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
          Last changed {fmtDateTime(data.updated_at)}{data.updated_by ? ` by ${data.updated_by}` : ''}.
        </p>
      )}
    </Card>
  );
}

/**
 * Toggles the career-stats insights card. Nothing is deleted when off - insights are
 * computed from the stats each time they are shown.
 */
function InsightsSwitch({ data }: { data: PlanSettings }) {
  const save = useApiMutation(
    (enabled: boolean) => api('PUT', '/platform/settings/player-insights', { enabled }),
    ['/platform/settings', '/me/sport-insights', '/people/'],
  );
  const on = data.insights_enabled;

  const flip = async (next: boolean) => {
    const ok = await confirmDialog({
      title: next ? 'Turn player insights on?' : 'Turn player insights off?',
      message: next
        ? 'Every player\'s career stats show the insights card again - strengths, things to work on and trends.'
        : 'The insights card disappears from every player\'s career stats. The stat tiles and filters stay exactly as they are.',
      confirmLabel: next ? 'Turn insights on' : 'Turn insights off',
      tone: 'primary',
    });
    if (!ok) return;
    save.mutate(next, {
      onSuccess: () => toast.success(next ? 'Player insights are on' : 'Player insights are off'),
      onError: (e: any) => toast.error('Could not change player insights', e.message),
    });
  };

  return (
    <Card className="mt-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold dark:text-slate-100">
            Player insights
            <Badge tone={on ? 'green' : 'slate'}>{on ? 'On' : 'Off'}</Badge>
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {on
              ? 'Career stats show an insights card - strengths, things to work on and trends - above the stat tiles.'
              : 'Career stats show the stat tiles and filters only. No insights are worked out or shown.'}
          </p>
        </div>
        <Toggle checked={on} onChange={(v) => { if (!save.isPending) void flip(v); }} />
      </div>
      {data.insights_updated_at && (
        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
          Last changed {fmtDateTime(data.insights_updated_at)}{data.insights_updated_by ? ` by ${data.insights_updated_by}` : ''}.
        </p>
      )}
    </Card>
  );
}
