import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, FileText, Image as ImageIcon, Inbox, X } from 'lucide-react';
import { useApi, useApiMutation } from '../../lib/hooks';
import { api } from '../../lib/api';
import { Button, Card, EmptyState, Segmented, Skeleton, Textarea, cn, toast } from '../../components/ui';
import { openDoc } from './certificates/shared';

// Reviewing claimed achievements (J4-E5-S2).
//
// This is a human judgement, so the screen's job is to put the evidence in front of the
// person making it. A queue that shows a title and two buttons invites rubber-stamping;
// the evidence is therefore on the row, not behind a click.

interface Evidence { id: string; filename: string; mime: string; size_bytes: number }
interface Claim {
  id: string; title: string; detail: string | null; occurred_on: string; status: string;
  evidence_url: string | null; decision_note: string | null; created_at: string;
  users_achievement_claims_user_idTousers: { id: string; name: string; email: string } | null;
  sports: { name: string } | null;
  claim_evidence: Evidence[];
}

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);

export function EvidenceChip({ e }: { e: Evidence }) {
  const Icon = e.mime === 'application/pdf' ? FileText : ImageIcon;
  return (
    <button
      type="button"
      onClick={() => openDoc(`/claim-evidence/${e.id}`)}
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:border-brand-400 hover:text-brand-600 dark:border-slate-700 dark:text-slate-300"
    >
      <Icon size={12} aria-hidden className="shrink-0" />
      <span className="truncate">{e.filename}</span>
      <span className="shrink-0 text-slate-400">{kb(e.size_bytes)}</span>
    </button>
  );
}

function ClaimRow({ claim, onDecide, busy }: {
  claim: Claim; busy: boolean;
  onDecide: (decision: 'approved' | 'rejected', note: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const person = claim.users_achievement_claims_user_idTousers;
  const pending = claim.status === 'pending';

  return (
    <li className="grid gap-3 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{claim.title}</h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {person ? (
              <Link to={`/people/${person.id}/record`} className="font-medium text-brand-600 hover:underline dark:text-brand-400">{person.name}</Link>
            ) : 'Unknown'}
            {' · '}{new Date(claim.occurred_on).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
            {claim.sports?.name ? ` · ${claim.sports.name}` : ''}
          </p>
        </div>
        {!pending && (
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold',
            claim.status === 'approved'
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
              : 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300')}>
            {claim.status === 'approved' ? 'Validated' : 'Declined'}
          </span>
        )}
      </div>

      {claim.detail && <p className="text-sm text-slate-600 dark:text-slate-400">{claim.detail}</p>}

      {(claim.claim_evidence.length > 0 || claim.evidence_url) && (
        <div className="flex flex-wrap items-center gap-2">
          {claim.claim_evidence.map((e) => <EvidenceChip key={e.id} e={e} />)}
          {claim.evidence_url && (
            <a href={claim.evidence_url} target="_blank" rel="noreferrer noopener"
              className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">
              Linked evidence ↗
            </a>
          )}
        </div>
      )}
      {pending && claim.claim_evidence.length === 0 && !claim.evidence_url && (
        // Said plainly, because approving on no evidence is a choice the validator
        // should make knowingly rather than by not noticing.
        <p className="text-xs text-amber-700 dark:text-amber-400">No evidence was attached to this claim.</p>
      )}

      {claim.decision_note && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
          {claim.decision_note}
        </p>
      )}

      {pending && (rejecting ? (
        <div className="grid gap-2">
          <Textarea
            rows={2} value={note} onChange={(e) => setNote(e.target.value)} autoFocus
            placeholder="Why is this not accepted? The claimant sees this."
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => { setRejecting(false); setNote(''); }}>Cancel</Button>
            <Button
              variant="danger" disabled={note.trim().length < 5 || busy}
              onClick={() => onDecide('rejected', note.trim())}
            >Decline the claim</Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => setRejecting(true)} disabled={busy}>
            <X size={15} aria-hidden />Decline
          </Button>
          <Button onClick={() => onDecide('approved', '')} disabled={busy}>
            <Check size={15} aria-hidden />Validate
          </Button>
        </div>
      ))}
    </li>
  );
}

export function ClaimsReviewPage() {
  const { orgId } = useParams();
  const [status, setStatus] = useState<'pending' | 'all'>('pending');

  const path = orgId ? `/organizations/${orgId}/claims?status=${status}` : null;
  const { data, isLoading } = useApi<{ rows: Claim[]; pending: number }>(path);

  const decide = useApiMutation(
    (b: { id: string; decision: string; note: string }) =>
      api('POST', `/claims/${b.id}/decision`, { decision: b.decision, note: b.note || null }),
    // The timeline changes the moment a claim is validated, so it has to be refetched
    // too - otherwise the approval appears to have done nothing.
    [path, orgId ? `/organizations/${orgId}/achievements/timeline` : null],
  );

  const onDecide = async (claim: Claim, decision: 'approved' | 'rejected', note: string) => {
    try {
      await decide.mutateAsync({ id: claim.id, decision, note });
      toast.success(decision === 'approved'
        ? `Validated — "${claim.title}" is now on the timeline`
        : 'Claim declined');
    } catch (e: any) { toast.error('Could not record that decision', e?.message); }
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Achievement claims</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Things people earned elsewhere and are asking this institution to vouch for.
          </p>
        </div>
        <Segmented
          value={status}
          onChange={(v) => setStatus(v as 'pending' | 'all')}
          options={[
            { value: 'pending', label: data?.pending ? `Waiting (${data.pending})` : 'Waiting' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>

      <Card className="p-0">
        {isLoading ? <Skeleton className="h-48" /> : (data?.rows.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Inbox size={28} />}
            title={status === 'pending' ? 'Nothing waiting' : 'No claims yet'}
            description="A validated claim goes onto the record marked as a claim, never as a locked result — a reader can always tell the two apart."
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data!.rows.map((c) => (
              <ClaimRow key={c.id} claim={c} busy={decide.isPending} onDecide={(d, n) => onDecide(c, d, n)} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
