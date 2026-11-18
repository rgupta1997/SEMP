-- Event photo carousel - the RDS twin of
-- supabase/migrations/20261107000000_championship_photos.sql.
--
-- STATUS: NOT APPLIED. Written 2026-11-07.
--
-- One row per photo on an event's public Overview carousel: the event, where the file
-- sits in the S3 bucket, its public link, caption and order. The files themselves are
-- in S3 (STORAGE_TRANSPORT=s3), never in the database. Idempotent.

create table if not exists championship_photos (
  id               uuid primary key default gen_random_uuid(),
  championship_id  uuid not null references championships(id) on delete cascade,
  storage_key      text not null,
  url              text not null,
  caption          text,
  sort_order       integer not null default 0,
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint championship_photos_caption_check check (caption is null or char_length(caption) <= 140)
);

create index if not exists idx_championship_photos_championship on championship_photos (championship_id, sort_order);
