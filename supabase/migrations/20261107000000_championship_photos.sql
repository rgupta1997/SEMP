-- Event photo carousel on the public Overview page. Super admins add the photos; the
-- files live in storage (Supabase Storage on beta, S3 on prod), this table only says
-- which event each belongs to, its public link, caption and order.
--
-- STATUS: NOT APPLIED. Written 2026-11-07. RDS twin: infra/rds-migrations/032_championship_photos.sql
-- (prod uses S3, so the bucket insert at the bottom has no RDS twin).
--
-- Idempotent.

create table if not exists championship_photos (
  id               uuid primary key default gen_random_uuid(),
  championship_id  uuid not null references championships(id) on delete cascade,
  -- Where the file sits in the bucket, so it can be deleted with the row.
  storage_key      text not null,
  -- The public link the carousel shows ("anyone with the link").
  url              text not null,
  caption          text,
  sort_order       integer not null default 0,
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint championship_photos_caption_check check (caption is null or char_length(caption) <= 140)
);

create index if not exists idx_championship_photos_championship on championship_photos (championship_id, sort_order);

-- RLS on with no policy: only the API (table owner) reads and writes it.
alter table championship_photos enable row level security;

-- The public bucket the files go in (STORAGE_BUCKET=event-photos). Public-read so the
-- carousel links work signed out; only the API's service role key can write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-photos', 'event-photos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true;
