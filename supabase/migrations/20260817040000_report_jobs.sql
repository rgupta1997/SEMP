-- Background report jobs (J5-E5, and the seam J4-E7 will move onto).
--
-- Lambda gives a synchronous request 15 seconds. An annual impact report reads a whole
-- season across participation, performance and inclusion, and a certificate batch
-- renders hundreds of documents - neither fits, and neither should make somebody watch
-- a spinner that is going to time out anyway. So the work becomes a job: the request
-- returns immediately with an id, and the client polls.
--
-- A table rather than SQS for now, deliberately. The queue is one worker away and this
-- row is what the worker would claim; introducing SQS before there is a worker to
-- consume it would be infrastructure with nothing on the other end. The shape here is
-- the shape the queue needs, so moving is a swap of the runner, not a rewrite.

create table if not exists report_jobs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind            varchar(32) not null,
  season          smallint,
  status          varchar(16) not null default 'queued',
  -- 0-100. Honest progress, not a fake animation: a bar that moves on a timer while
  -- nothing happens is worse than no bar.
  progress        smallint not null default 0,
  -- The finished report. Held as JSON so it can be rendered to HTML, PDF or CSV later
  -- without re-deriving anything - and so the figures in an export and the figures on
  -- screen are literally the same numbers.
  result          jsonb,
  error           text,
  requested_by    uuid references users(id),
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);

create index if not exists idx_report_jobs_org on report_jobs(organization_id, created_at desc);
create index if not exists idx_report_jobs_claimable on report_jobs(status, created_at) where status = 'queued';
