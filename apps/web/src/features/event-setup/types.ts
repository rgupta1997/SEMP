import type {
  SetupEventType, SetupIssue, SetupPlatformStep, SetupStepMode, SetupSteps,
  SetupValidationResult, SetupValidationSummary,
} from '@semp/shared';

// The wire shapes of /api/event-setups, exactly as the contract states them. The
// dashboard reads nothing the contract does not promise: where a field is optional
// in practice (a fresh draft has no summary) it is typed nullable here and every
// reader copes with it.

export const EVENT_SETUP_STATUSES = [
  'draft', 'invalid', 'validated', 'applying', 'applied', 'failed', 'undone',
] as const;
export type EventSetupStatus = (typeof EVENT_SETUP_STATUSES)[number];

export interface IssueCounts { error: number; warning: number; info: number }

export interface EventSetupListItem {
  id: string;
  label: string;
  event_type: SetupEventType;
  status: EventSetupStatus;
  file_name: string | null;
  organization_id: string | null;
  org_name: string | null;
  championship_id: string | null;
  championship_name: string | null;
  summary: SetupValidationSummary | null;
  issue_counts: IssueCounts | null;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
  created_by_name: string | null;
}

export interface ApplyReportRow {
  step: string;
  mode: SetupStepMode;
  found: number;
  created: number;
  notes: string[];
}

export interface VerifyReport {
  checked: number;
  failures: string[];
  at: string;
}

/** Registration-day progress on the placeholder contacts the run minted. */
export interface ContactStats {
  total: number;
  placeholder: number;
  replaced: number;
}

export interface EventSetupDetail extends EventSetupListItem {
  steps: SetupSteps;
  validation: SetupValidationResult | null;
  platform: { steps: SetupPlatformStep[]; issues: SetupIssue[] } | null;
  apply_report: ApplyReportRow[] | null;
  verify_report: VerifyReport | null;
  error: string | null;
  contacts: ContactStats | null;
  credentials_count: number;
}

export interface CredentialRow {
  name: string;
  role: string;
  contact: string;
  phone: string;
  email: string;
  password: string | null;
}

/** A workbook as the browser read it, ready to POST to /validate. */
export interface ReadWorkbook {
  fileName: string;
  sheets: Record<string, string[][]>;
}
