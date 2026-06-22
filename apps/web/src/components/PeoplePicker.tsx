import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { Avatar, Badge, Button, Checkbox, Modal, SearchInput, Spinner, toast } from './ui';

interface User { id: string; name: string; email: string; phone?: string | null }

const digits = (s: string) => s.replace(/\D/g, '');

// Reusable "add people by mobile or name" picker. Server-side typeahead: the first
// few users load by default, then the DB is searched as you type (debounced) with
// phone numbers masked unless the full number is typed correctly. Multi-selects
// existing users (added in a single bulk call via the caller's onAssignUsers);
// people already assigned (`assignedUserIds`) are shown but flagged and not
// re-selectable. For a typed number with no match, sends an invitation to join
// (auto-applied on sign-up). `invalidateKeys` are the query paths refreshed after
// an add/invite - falls back to a full refetch if none are given.
export function PeoplePicker({ title, subtitle, excludeUserIds, assignedUserIds, assignedLabel = 'Added', invite, roleControl, invalidateKeys, onAssignUsers, onClose }: {
  title: string;
  subtitle?: string;
  excludeUserIds?: Set<string>;
  assignedUserIds?: Set<string>;
  assignedLabel?: string;
  invite: { target_type: 'org_member' | 'championship_organiser' | 'championship_official'; target_id: string; role?: string };
  roleControl?: ReactNode;
  invalidateKeys?: (string | null)[];
  onAssignUsers: (userIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [invited, setInvited] = useState<string[]>([]);

  // Debounce typing so each keystroke doesn't hit the DB.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // No query → first 10 users; otherwise search the DB. `mask=1` keeps phones hidden
  // until the searcher types a full number, which the server reveals on exact match.
  const path = debounced
    ? `/users?q=${encodeURIComponent(debounced)}&limit=25&mask=1`
    : '/users?limit=10&mask=1';
  const { data: users = [], isFetching } = useApi<User[]>(path);

  const q = search.trim().toLowerCase();
  const qDigits = digits(search);
  const exclude = excludeUserIds ?? new Set<string>();
  const assigned = assignedUserIds ?? new Set<string>();

  const matches = useMemo(() => users.filter((u) => !exclude.has(u.id)), [users, exclude]);

  // Offer "invite by number" once the query looks like a full mobile with no match.
  // A real match comes back with its number unmasked, so digit comparison is reliable.
  const phoneMatch = qDigits.length >= 10 && users.some((u) => u.phone && digits(u.phone).slice(-10) === qDigits.slice(-10));
  const canInvite = qDigits.length >= 10 && !phoneMatch;

  // Refresh only the caller's affected lists; fall back to a full refetch if the
  // caller didn't say which keys to invalidate.
  const refresh = () => {
    const keys = (invalidateKeys ?? []).filter(Boolean) as string[];
    if (keys.length) keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    else qc.invalidateQueries();
  };

  const toggle = (id: string) => {
    if (assigned.has(id)) return; // already assigned - not selectable
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const confirm = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await onAssignUsers([...selected]); // one bulk request, not one per person
      refresh();
      toast.success(`${selected.size} added`);
      onClose();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const sendInvite = async () => {
    setBusy(true);
    try {
      await api('POST', '/user-invitations', { mobile: search.trim(), target_type: invite.target_type, target_id: invite.target_id, role: invite.role });
      setInvited((l) => [...l, qDigits.slice(-10)]);
      setSearch('');
      refresh();
      toast.success('Invitation sent', 'They’ll be added when they sign up with that number.');
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={title} onClose={onClose} wide>
      {subtitle && <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      {roleControl}
      <SearchInput value={search} onChange={setSearch} placeholder="Search by name or mobile…" className="w-full" />

      {canInvite && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-brand-50 px-3 py-2 dark:bg-brand-500/10">
          <span className="text-sm text-slate-600 dark:text-slate-300">No user with <b>{search.trim()}</b>. Invite them to join?</span>
          <Button size="sm" disabled={busy} onClick={sendInvite}>Invite to join</Button>
        </div>
      )}
      {invited.length > 0 && (
        <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-300">
          Invited: {invited.join(', ')} - they’ll be added automatically when they sign up with that number.
        </p>
      )}

      <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
        {isFetching && matches.length === 0 ? (
          <div className="grid h-20 place-items-center"><Spinner /></div>
        ) : matches.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">{q ? 'No matching users.' : 'Search to find people by name or mobile.'}</p>
        ) : matches.map((u) => {
          const isAssigned = assigned.has(u.id);
          return (
            <label key={u.id} className={`flex items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-0 dark:border-slate-800 ${isAssigned ? 'cursor-default opacity-70' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
              {isAssigned
                ? <span className="grid h-4 w-4 shrink-0 place-items-center text-emerald-500" aria-hidden>✓</span>
                : <Checkbox checked={selected.has(u.id)} onChange={() => toggle(u.id)} />}
              <Avatar name={u.name} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{u.name}</div>
                <div className="truncate text-xs text-slate-500 dark:text-slate-400">{u.email}{u.phone ? ` · ${u.phone}` : ''}</div>
              </div>
              {isAssigned && <Badge tone="green">{assignedLabel}</Badge>}
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-slate-500 dark:text-slate-400">{selected.size} selected</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Done</Button>
          <Button onClick={confirm} disabled={selected.size === 0 || busy}>{busy ? 'Adding…' : `Add ${selected.size || ''}`}</Button>
        </div>
      </div>
    </Modal>
  );
}
