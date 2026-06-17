-- Per-match awards entered by the scorer (official/host). Free-text award name,
-- recipient is a player on one of the two competing teams. Multiple per fixture.
-- These also surface as "achievements" on the recipient's participant dashboard.
create table if not exists fixture_awards (
  id                uuid primary key default gen_random_uuid(),
  fixture_id        uuid not null references fixtures(id) on delete cascade,
  recipient_user_id uuid not null references users(id)    on delete cascade,
  award_name        varchar(120) not null,
  created_at        timestamptz  not null default now()
);

create index if not exists idx_fixture_awards_fixture   on fixture_awards(fixture_id);
create index if not exists idx_fixture_awards_recipient on fixture_awards(recipient_user_id);
