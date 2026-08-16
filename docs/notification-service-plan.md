# Notification Service — Module Plan (Supabase Realtime transport)

Status: proposal; Supabase Realtime transport (§5) currently under POC.
Scope: `packages/notifications` (new shared package) + schema additions + migration of existing call sites.
Transport: Supabase Realtime (already in our stack — no new infra), or AWS AppSync. Either can back this plan without touching the rule engine below.

> **Deployment note (updated).** The API now runs on **AWS Lambda** behind an API Gateway HTTP API (`apps/api/src/lambda.ts` via `serverless-http`, proven on staging). **Render is retired.** This changes one premise of the original draft: AppSync was written up as "a separate, later track tied to the Lambda migration" — **that migration has happened**, so the AppSync-vs-Realtime choice is live now rather than deferred, and the POC in §5 is picking between two available options rather than validating the only one.
>
> Two Lambda consequences that bear on §5 specifically:
> - **No long-lived process.** Anything that would have been an in-process subscriber, fan-out loop or interval job needs SQS/EventBridge instead. The plan's read-time visibility model (no fan-out rows) is a good fit for this and gets *more* attractive under Lambda, not less.
> - **Per-container DB connection budget of 1** (reserved concurrency 10 × `connection_limit=1`). Any per-recipient fan-out design — see §7's first open question — has to respect that ceiling.
>
> See `DEPLOYMENT.md` and `docs/eos/00-index.md` §2.3.

## 1. Problem with the current system

Today notifications work through one write helper (`createNotification` in `apps/api/src/modules/notifications/audience.ts`) and one centralized visibility check (`getUserEventScopes` / `canSeeNotification`). That part is fine. Three things are rigid:

- **Audience is a fixed 3-value enum** (`all`, `organizations_captains`, `org_admins`) plus a bolted-on `target_user_id` bypass for direct notifications. A new targeting need (e.g. "all officials", "team members only", "captains of team X") means editing `audience.ts`, the DB `CHECK` constraint, and every call site that needs it.
- **`type` is also a fixed enum**, enforced by a DB `CHECK` constraint (6 values today). A new business event that should notify someone requires a migration, not just a code change.
- **No "last seen" watermark.** Unread state is entirely derived from the `notification_reads` join table (one row per notification per user). It works, but there's no single "when did this user last check notifications" value — the bell badge is powered by polling `GET /notifications/unread-count` every 30 seconds (`NotificationBell.tsx`), doing an anti-join that grows with total notification volume.

8 call sites currently build notifications directly: `notifications.routes.ts`, `championships.routes.ts`, `organizations.routes.ts` (×3), `fixtures.routes.ts`, `invitations.routes.ts`, `enrollment.routes.ts`.

## 2. Goals

1. Adding a new notification **type** = one registry entry, no migration.
2. Adding a new **audience rule** ("who should see this") = compose existing primitives, no migration, no CHECK-constraint edit.
3. A per-user **last-seen watermark**, updated on bell click, driving badge count via a cheap indexed range query instead of an anti-join.
4. **Live badge/feed updates** via Supabase Realtime instead of 30s polling.
5. Ship independent of the transport decision — the rule engine, registry and watermark (§3–§4) run unchanged on the current Lambda-deployed API regardless of whether §5 lands on Supabase Realtime, AppSync, or stays on polling.

## 3. Package layout: `packages/notifications`

```
packages/notifications/
  core/     — pure TS, no I/O: type registry, audience rule definitions, templating
  server/   — Prisma-backed: notify(), getFeed(), getUnreadCount(), markSeen(), markRead(), react()
  client/   — fetch client + React hooks (useUnreadCount, useNotificationFeed, useNotificationBell)
```

`apps/api` mounts `server` as a router; `apps/web` consumes `client`'s hooks. This also makes the module reusable outside `apps/api` if we ever need it elsewhere in the monorepo.

### `core`: type registry (replaces the fixed `type` enum)

```ts
// packages/notifications/core/registry.ts
export interface NotificationTypeDef {
  key: string;                       // e.g. 'match_reminder'
  defaultAudience: (ctx: RuleContext) => AudienceRule;
  titleTemplate: (data: Record<string, unknown>) => string;
  bodyTemplate?: (data: Record<string, unknown>) => string | null;
}

export const NOTIFICATION_TYPES: Record<string, NotificationTypeDef> = {
  event_lifecycle: { ... },
  org_join_request: { ... },
  enrollment_approved: { ... },
  // new types added here, no migration
};
```

The DB `type` column becomes a plain `varchar`, validated against `NOTIFICATION_TYPES` at the application layer instead of a `CHECK` constraint.

### `core`: audience rule engine (replaces the fixed `audience` enum)

```ts
// packages/notifications/core/rules.ts
export type AudienceRule =
  | { kind: 'role'; role: 'organiser' | 'official' | 'captain' | 'poc'; championshipId: string }
  | { kind: 'org_admins'; organizationId: string }
  | { kind: 'team_members'; teamId: string }
  | { kind: 'direct_user'; userId: string }
  | { kind: 'everyone'; championshipId: string }
  | { kind: 'compose'; rules: AudienceRule[] };

export const Rules = {
  role: (role, championshipId) => ({ kind: 'role', role, championshipId }),
  orgAdmins: (organizationId) => ({ kind: 'org_admins', organizationId }),
  teamMembers: (teamId) => ({ kind: 'team_members', teamId }),
  directUser: (userId) => ({ kind: 'direct_user', userId }),
  everyone: (championshipId) => ({ kind: 'everyone', championshipId }),
  compose: (rules) => ({ kind: 'compose', rules }),
};
```

Each rule has a matching resolver in `server`:
- `matches(scopes, rule): boolean` — read-time visibility check (reuses the existing `EventScopes` computation from today's `audience.ts`, just generalized to more rule kinds).
- `resolveUserIds(prisma, rule): Promise<Set<string>>` — only needed for delivery fan-out (Realtime broadcast, future push/email), not for the feed query itself.

The rule serializes to JSON and is stored in the `audience` column (now `jsonb`, not a constrained `varchar`), so new rule kinds don't require a schema change — only a new `case` in the resolver.

### `server`: single send entry point (replaces the 8 hand-rolled call sites)

```ts
notify({
  type: 'event_lifecycle',
  championshipId,
  audience: Rules.role('captain', championshipId),
  data: { championshipName, newStatus },   // structured, not just free-text body — templating fills title/body
  senderId,
});
```

Example migration of one existing call site, `apps/api/src/modules/championships/championships.routes.ts:274`:

```ts
// before
await createNotification(prisma, {
  championship_id: id, sender_id: user.id,
  type: 'event_lifecycle', audience: 'organizations_captains',
  title: `${championship.name} status changed to ${status}`,
});

// after
await notify({
  type: 'event_lifecycle',
  championshipId: id,
  audience: Rules.role('captain', id),
  data: { championshipName: championship.name, newStatus: status },
  senderId: user.id,
});
```

## 4. Schema changes

```sql
-- supabase/migrations/20260811000000_notification_service_v2.sql

-- 1. Loosen fixed enums to app-validated free-form columns
alter table notifications alter column audience type jsonb using
  case audience
    when 'all' then jsonb_build_object('kind','everyone','championship_id',championship_id)
    when 'organizations_captains' then jsonb_build_object('kind','role','role','captain','championship_id',championship_id)
    when 'org_admins' then jsonb_build_object('kind','org_admins','organization_id',organization_id)
  end;
alter table notifications drop constraint notifications_audience_check;
alter table notifications drop constraint notifications_type_check;  -- type validated in app layer via registry now

-- 2. Last-seen watermark (the "last click" ask)
create table notification_cursors (
  user_id       uuid primary key references users(id) on delete cascade,
  last_seen_at  timestamptz not null default now(),
  last_clicked_notification_id uuid references notifications(id) on delete set null,
  updated_at    timestamptz not null default now()
);
```

`notification_reads` (per-notification read receipts, used for the item-level unread state and reaction gating) is untouched — the watermark is additive, not a replacement.

Badge count becomes:
```sql
select count(*) from notifications n
where n.created_at > (select last_seen_at from notification_cursors where user_id = $1)
  and <visibility predicate for $1>;
```
An index-range scan instead of an anti-join against `notification_reads` — cheaper as notification volume grows.

`markSeen(userId)` upserts `notification_cursors` and is called when the bell opens (replacing today's `read-all` bulk write as the primary badge-clearing action; `read-all` can stay for per-item list state).

## 5. Real-time delivery via Supabase Realtime

Goal: replace `NotificationBell`'s `refetchInterval: 30_000` poll with live push, using infrastructure we already pay for.

Two things to decide with the team before building this part (flagging honestly — this is the one piece with a real integration wrinkle):

- SEMP auth is a **custom JWT** (`jsonwebtoken` + `env.JWT_SECRET`), not Supabase Auth. Supabase Realtime's row-level-security enforcement for `postgres_changes`/broadcast channels is normally keyed off a Supabase-signed JWT (`auth.uid()` in RLS policies). To get RLS-scoped Realtime working with our own auth, the API needs to mint a short-lived **Supabase-compatible JWT** (signed with the Supabase project's JWT secret, `sub: user.id`) via a small `POST /notifications/realtime-token` endpoint, which the frontend then hands to `supabase-js` for the Realtime connection. This is a standard pattern but should be spiked against current Supabase docs before committing, since Realtime Authorization APIs have moved around over time.
- Keep the broadcast payload thin — `{ type: 'notification_created', unread_count }` — and have the client re-fetch the feed/count on receipt rather than streaming full notification rows through Realtime. Simpler, and avoids re-deriving the visibility rule inside a Realtime channel filter.

Flow:
1. `notify()` writes the notification row (Postgres stays the single source of truth).
2. A lightweight Postgres trigger (or the same `notify()` call, application-side) sends a Realtime broadcast on a per-user channel, e.g. `user:<userId>:notifications`.
3. `NotificationBell` subscribes to its own channel using the short-lived Supabase JWT from step above; on message, it invalidates the `unread-count`/feed TanStack Query keys instead of waiting for the 30s interval.
4. If the Realtime connection drops, fall back to the existing poll (kept as a safety net, not removed).

This is intentionally decoupled from the rule engine in §3 — if AppSync replaces this transport, only this section changes; `notify()`, the type registry, and the audience rules stay identical. Now that the API is on Lambda, that swap is a live option rather than a future one: weigh Realtime (no new infra, but needs the externally-signed-JWT spike above) against AppSync (native to the AWS stack we're now on, but new infra and IAM). The POC should produce a recommendation on that, not just a yes/no on Realtime.

## 6. Migration plan (phased, non-breaking)

1. **Schema**: add `notification_cursors`, loosen `audience`/`type` constraints (§4). Purely additive/widening — nothing breaks.
2. **Module scaffold**: build `packages/notifications` core + server, with built-in rules mapping 1:1 onto today's 3 audience values + `target_user_id`, so behavior doesn't change yet.
3. **Call-site migration**: move the 8 call sites to `notify()` one at a time, verify parity, then delete the old `createNotification`.
4. **Bell/badge cutover**: switch `NotificationBell` to the watermark-based unread-count endpoint and `markSeen()` on open.
5. **Realtime**: add the `realtime-token` endpoint, wire the per-user broadcast channel, subscribe from `NotificationBell`, keep polling as fallback.
6. **Prove extensibility**: add one genuinely new notification type (e.g. a match/payment reminder) through the registry only, no migration — the acceptance test that the rigidity is actually gone.

## 7. Open questions for the team

- Do we want per-recipient fan-out rows for very large audiences (e.g. "everyone in a 500-team championship"), or is the current read-time visibility filter (no fan-out, computed per query) still fine at our scale? Today's design assumes the latter.
- Should `markRead` (per-item) also update `last_seen_at`, or should the watermark move only on bell-open/explicit "seen" actions? Affects whether opening an item from a deep link (e.g. push notification, future) also clears the badge.
- Realtime auth: confirm current Supabase Realtime Authorization support for externally-signed JWTs before building §5 — spike this first, it's the one part of this plan not already proven out in our codebase.
