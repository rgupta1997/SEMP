-- Claiming an achievement earned elsewhere (J4-E5).
--
-- Most of what a player has done never touched this platform: a state selection, a
-- district medal, a national camp. Leaving those out makes the "lifetime record" a
-- record of one platform's fixtures rather than of a person.
--
-- But letting people type achievements straight onto their own record would destroy the
-- thing that makes the record worth having. So a claim is a REQUEST, not an entry: it
-- is invisible until somebody at the institution vouches for it, and what it becomes
-- when approved is permanently marked as validated-by-a-human rather than
-- derived-from-a-locked-result. Those two are not the same kind of fact and the record
-- must never pretend otherwise.

create table if not exists achievement_claims (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  -- Which institution is being asked to vouch. A claim is always against somebody
  -- specific: "verified" with no verifier behind it means nothing.
  organization_id uuid not null references organizations(id) on delete cascade,
  kind            varchar(24) not null default 'achievement',
  title           varchar(200) not null,
  detail          text,
  sport_id        uuid references sports(id),
  occurred_on     date not null,
  -- Where a reviewer can go to check. Optional, because insisting on a URL would
  -- exclude the certificate that only exists on paper.
  evidence_url    text,
  status          varchar(16) not null default 'pending',
  decided_by      uuid references users(id),
  decided_at      timestamptz,
  -- Required on rejection, and shown to the claimant. A refusal nobody can learn from
  -- just gets resubmitted unchanged.
  decision_note   text,
  -- The achievement this became, if approved. Kept so the claim and its record stay
  -- linked - "where did this line come from?" is answerable forever.
  achievement_id  uuid references achievements(id),
  created_at      timestamptz not null default now()
);

create index if not exists idx_achievement_claims_org on achievement_claims(organization_id, status, created_at desc);
create index if not exists idx_achievement_claims_user on achievement_claims(user_id, created_at desc);

-- One live claim for the same thing. Somebody submitting the same medal three times
-- because nobody has looked at it yet is a queue problem, not three achievements.
create unique index if not exists uq_achievement_claims_pending
  on achievement_claims(user_id, organization_id, lower(title), occurred_on)
  where status = 'pending';

-- `source` on achievements already distinguishes where a row came from; this is the
-- value a validated claim carries, so a reader can always tell a human judgement from
-- a locked result.
comment on column achievements.source is
  'locked_result = derived from a verified scorecard; validated_claim = a human vouched for something that happened elsewhere (J4-E5).';
