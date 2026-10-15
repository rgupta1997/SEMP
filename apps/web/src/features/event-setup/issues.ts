import { SETUP_SHEET_NAMES, type SetupIssue, type SetupIssueSeverity } from '@semp/shared';
import type { IssueCounts } from './types';

// The issues list is the heart of the validation screen: what the client got wrong,
// in the order someone fixes it. Pure functions, so the ordering and the filters can
// be tested without a browser.

export const SEVERITIES: SetupIssueSeverity[] = ['error', 'warning', 'info'];

export const SEVERITY_LABEL: Record<SetupIssueSeverity, { one: string; many: string }> = {
  error: { one: 'error', many: 'errors' },
  warning: { one: 'warning', many: 'warnings' },
  info: { one: 'note', many: 'notes' },
};

export const plural = (n: number, sev: SetupIssueSeverity) =>
  `${n.toLocaleString()} ${n === 1 ? SEVERITY_LABEL[sev].one : SEVERITY_LABEL[sev].many}`;

/** Filter key for issues not tied to a sheet (a platform lookup, a missing sheet). */
export const NO_SHEET = '-';

const sheetRank = (s: string | undefined) => {
  if (!s) return SETUP_SHEET_NAMES.length + 1;
  const i = (SETUP_SHEET_NAMES as readonly string[]).indexOf(s);
  return i < 0 ? SETUP_SHEET_NAMES.length : i;
};

/** Errors first, then by sheet in workbook order, then by row, then column. */
export function sortIssues(issues: SetupIssue[]): SetupIssue[] {
  return issues
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) =>
      SEVERITIES.indexOf(a.issue.severity) - SEVERITIES.indexOf(b.issue.severity)
      || sheetRank(a.issue.sheet) - sheetRank(b.issue.sheet)
      || (a.issue.row ?? 0) - (b.issue.row ?? 0)
      || (a.issue.column ?? '').localeCompare(b.issue.column ?? '')
      || a.i - b.i)
    .map((x) => x.issue);
}

export function countIssues(issues: SetupIssue[]): IssueCounts {
  const c: IssueCounts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) if (i.severity in c) c[i.severity] += 1;
  return c;
}

/** The sheets issues were raised on, in workbook order, with a count each. */
export function issueSheets(issues: SetupIssue[]): Array<{ key: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const i of issues) {
    const key = i.sheet ?? NO_SHEET;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => sheetRank(a[0] === NO_SHEET ? undefined : a[0]) - sheetRank(b[0] === NO_SHEET ? undefined : b[0]))
    .map(([key, count]) => ({ key, label: key === NO_SHEET ? 'General' : key, count }));
}

export interface IssueFilter {
  severity: 'all' | SetupIssueSeverity;
  /** A sheet name, NO_SHEET, or 'all'. */
  sheet: string;
}

export function filterIssues(issues: SetupIssue[], f: IssueFilter): SetupIssue[] {
  return issues.filter((i) =>
    (f.severity === 'all' || i.severity === f.severity)
    && (f.sheet === 'all' || (i.sheet ?? NO_SHEET) === f.sheet));
}

/** Non-empty groups, errors first. Expects (but does not need) sorted input. */
export function groupBySeverity(issues: SetupIssue[]): Array<{ severity: SetupIssueSeverity; issues: SetupIssue[] }> {
  return SEVERITIES
    .map((severity) => ({ severity, issues: issues.filter((i) => i.severity === severity) }))
    .filter((g) => g.issues.length > 0);
}

/** "Squads · row 12 · Captain mobile" - the compact address of an issue. */
export function issueLocator(i: SetupIssue): string {
  return [i.sheet, i.row != null ? `row ${i.row}` : null, i.column].filter(Boolean).join(' · ');
}

/** The file that goes back to the client: one row per issue, errors first. */
export function issuesCsvRows(issues: SetupIssue[]): string[][] {
  return [
    ['Severity', 'Sheet', 'Row', 'Column', 'Code', 'Message'],
    ...sortIssues(issues).map((i) => [
      i.severity, i.sheet ?? '', i.row != null ? String(i.row) : '', i.column ?? '', i.code, i.message,
    ]),
  ];
}

export type VerdictTone = 'ready' | 'review' | 'blocked';

export function verdict(issues: SetupIssue[], ok: boolean): { tone: VerdictTone; title: string; detail: string } {
  const c = countIssues(issues);
  if (c.error > 0) {
    return {
      tone: 'blocked',
      title: `${plural(c.error, 'error')} to fix`,
      detail: 'Nothing can be applied until these are fixed. Send the issues file back to the client, or fix the workbook and upload it again.',
    };
  }
  if (!ok) {
    return {
      tone: 'blocked',
      title: 'Not ready to apply',
      detail: 'The workbook could not be turned into an event. Check that it is the standard template for this event type.',
    };
  }
  if (c.warning > 0) {
    return {
      tone: 'review',
      title: `Ready to apply · ${plural(c.warning, 'warning')} to review`,
      detail: 'Nothing blocks the run, but read the warnings first: each one is something the run will decide for the client.',
    };
  }
  return { tone: 'ready', title: 'Ready to apply', detail: 'The workbook is complete and consistent.' };
}
