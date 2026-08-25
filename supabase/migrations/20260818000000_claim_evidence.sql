-- Evidence for an external achievement claim (J4-E5).
--
-- A claim is a request to be believed, and "trust me" is not a claim an institution can
-- act on. The evidence is the difference between a validator making a decision and a
-- validator making a guess, so it lives with the claim rather than in a link somebody
-- pasted that may be dead by the time anyone looks.
--
-- WHY THE BYTES ARE IN POSTGRES.
-- There is no object storage configured for this deployment - no bucket, no credentials,
-- no signing key - and inventing one is a deployment decision, not a code decision. The
-- volume here is genuinely small (a claim is a rare event, and each carries a page or a
-- photo), so a bytea column is the honest answer: it works today, it is backed up with
-- everything else, and it cannot leave an orphaned file behind when a claim is deleted.
--
-- Moving to a bucket later touches exactly one thing: where `bytes` is read from. The
-- table keeps the metadata either way, which is what the review screen actually renders.
create table if not exists claim_evidence (
  id           uuid primary key default gen_random_uuid(),
  claim_id     uuid not null references achievement_claims(id) on delete cascade,
  -- Kept as uploaded. A validator comparing "scan_003.jpg" against what the claimant
  -- described needs the claimant's own filename, not one we generated.
  filename     varchar(255) not null,
  mime         varchar(100) not null,
  size_bytes   integer not null,
  bytes        bytea not null,
  uploaded_by  uuid not null references users(id) on delete cascade,
  uploaded_at  timestamptz not null default now()
);

create index if not exists idx_claim_evidence_claim on claim_evidence(claim_id, uploaded_at);

-- Belt and braces against a client that ignores the API's own cap. A 3MB ceiling keeps
-- a base64 upload inside the 6MB Lambda request payload with room to spare.
alter table claim_evidence drop constraint if exists claim_evidence_size_sane;
alter table claim_evidence add constraint claim_evidence_size_sane
  check (size_bytes > 0 and size_bytes <= 3145728);

-- Only what a browser can actually display back to a validator. An executable dressed
-- up as evidence is not evidence, and a format nobody can open helps nobody.
alter table claim_evidence drop constraint if exists claim_evidence_mime_allowed;
alter table claim_evidence add constraint claim_evidence_mime_allowed
  check (mime in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'));
