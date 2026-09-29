import { ORG_ARCHIVED_READ_ONLY_MESSAGE } from '@semp/shared';
import { useAuth } from './auth';

/**
 * Whether an organisation is archived, for disabling its write controls. The server
 * refuses the same writes; `title` is the tooltip explaining why a button is dead.
 */
export function useOrgArchived(orgId: string | null | undefined) {
  const { ctx } = useAuth();
  const archived = !!orgId && !!(ctx?.organizations ?? []).find((m) => m.organization_id === orgId)?.organization?.archived_at;
  return { archived, title: archived ? ORG_ARCHIVED_READ_ONLY_MESSAGE : undefined };
}
