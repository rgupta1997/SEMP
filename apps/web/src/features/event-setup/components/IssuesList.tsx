import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CircleAlert, Download, Info, TriangleAlert } from 'lucide-react';
import type { SetupIssue, SetupIssueSeverity } from '@semp/shared';
import { Button, Card, cn, FilterChips } from '../../../components/ui';
import { downloadCsv, slug } from '../csv';
import {
  countIssues, filterIssues, groupBySeverity, issueLocator, issueSheets, issuesCsvRows,
  plural, sortIssues, type IssueFilter,
} from '../issues';
import { FOCUS_RING } from './pills';

/** Rows rendered before "Show more": a bad workbook can carry thousands of issues. */
export const ISSUE_PAGE = 500;

const SEV_STYLE: Record<SetupIssueSeverity, { icon: ReactNode; text: string; heading: string }> = {
  error: {
    icon: <CircleAlert size={15} className="text-rose-600 dark:text-rose-400" />,
    text: 'text-rose-700 dark:text-rose-300',
    heading: 'Errors',
  },
  warning: {
    icon: <TriangleAlert size={15} className="text-amber-500 dark:text-amber-400" />,
    text: 'text-amber-700 dark:text-amber-300',
    heading: 'Warnings',
  },
  info: {
    icon: <Info size={15} className="text-sky-500 dark:text-sky-400" />,
    text: 'text-sky-700 dark:text-sky-300',
    heading: 'Notes',
  },
};

/** Download the issues as CSV, for sending back to the client. */
export function downloadIssuesCsv(issues: SetupIssue[], label: string) {
  downloadCsv(`event-setup-issues-${slug(label)}.csv`, issuesCsvRows(issues));
}

export function IssuesList({ issues, label }: { issues: SetupIssue[]; label: string }) {
  const [filter, setFilter] = useState<IssueFilter>({ severity: 'all', sheet: 'all' });
  const [shown, setShown] = useState(ISSUE_PAGE);

  const sorted = useMemo(() => sortIssues(issues), [issues]);
  const counts = useMemo(() => countIssues(issues), [issues]);
  const sheets = useMemo(() => issueSheets(issues), [issues]);
  const filtered = useMemo(() => filterIssues(sorted, filter), [sorted, filter]);
  const filteredCounts = useMemo(() => countIssues(filtered), [filtered]);
  const groups = useMemo(() => groupBySeverity(filtered.slice(0, shown)), [filtered, shown]);

  // A new validation is a new list: a sheet or severity filtered on before may not
  // exist in it, and would show "no issues match" over a list full of them.
  useEffect(() => {
    setFilter({ severity: 'all', sheet: 'all' });
    setShown(ISSUE_PAGE);
  }, [issues]);

  const setF = (patch: Partial<IssueFilter>) => { setFilter((f) => ({ ...f, ...patch })); setShown(ISSUE_PAGE); };

  if (!issues.length) {
    return <p className="t-meta">No issues: every sheet, row and column read cleanly.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="t-meta">
          {[counts.error && plural(counts.error, 'error'), counts.warning && plural(counts.warning, 'warning'), counts.info && plural(counts.info, 'info')]
            .filter(Boolean).join(' · ')}
        </p>
        <Button variant="outline" size="sm" className={FOCUS_RING} onClick={() => downloadIssuesCsv(issues, label)}>
          <Download size={13} aria-hidden /> Download issues (.csv)
        </Button>
      </div>

      <FilterChips
        label="Severity"
        value={filter.severity}
        onChange={(v) => setF({ severity: v })}
        options={[
          { key: 'all', label: 'All', count: issues.length },
          ...(counts.error ? [{ key: 'error' as const, label: 'Errors', count: counts.error }] : []),
          ...(counts.warning ? [{ key: 'warning' as const, label: 'Warnings', count: counts.warning }] : []),
          ...(counts.info ? [{ key: 'info' as const, label: 'Notes', count: counts.info }] : []),
        ]}
      />
      {sheets.length > 1 && (
        <FilterChips
          label="Sheet"
          value={filter.sheet}
          onChange={(v) => setF({ sheet: v })}
          options={[{ key: 'all', label: 'All sheets', count: issues.length }, ...sheets]}
        />
      )}

      {filtered.length === 0 ? (
        <p className="t-meta py-4">No issues match these filters.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <Card key={g.severity} className="overflow-hidden">
              <h3 className={cn('flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-sm font-bold dark:border-slate-800', SEV_STYLE[g.severity].text)}>
                {SEV_STYLE[g.severity].icon}
                {SEV_STYLE[g.severity].heading}
                <span className="t-num font-mono text-xs font-semibold opacity-70">
                  {g.issues.length < filteredCounts[g.severity]
                    ? `${g.issues.length.toLocaleString()} of ${filteredCounts[g.severity].toLocaleString()}`
                    : g.issues.length.toLocaleString()}
                </span>
              </h3>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {g.issues.map((issue, i) => {
                  const where = issueLocator(issue);
                  return (
                    <li key={`${issue.code}-${issue.sheet}-${issue.row}-${issue.column}-${i}`} className="flex gap-3 px-4 py-2.5">
                      <span className="mt-0.5 shrink-0" aria-label={issue.severity}>{SEV_STYLE[issue.severity].icon}</span>
                      <div className="min-w-0 flex-1">
                        {where && (
                          <div className="font-mono text-[11.5px] font-semibold text-slate-500 dark:text-slate-400">{where}</div>
                        )}
                        <div className="text-[13.5px] leading-snug text-slate-800 dark:text-slate-200">{issue.message}</div>
                      </div>
                      <span className="hidden shrink-0 self-start rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-400 sm:inline dark:bg-slate-800 dark:text-slate-500">
                        {issue.code}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {filtered.length > shown && (
        <Button variant="ghost" className={cn('mt-2 self-center', FOCUS_RING)} onClick={() => setShown((n) => n + ISSUE_PAGE)}>
          Show more ({(filtered.length - shown).toLocaleString()} left)
        </Button>
      )}
    </div>
  );
}
