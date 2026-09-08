-- ============================================================================
-- The five things the marketing site asks for that had nowhere to go
--
-- landing-page-v2's "Book a demo" form collects ten fields. Four of them map
-- straight onto demo_requests (name, email, phone, organization) and one onto
-- `role` (the organisation TYPE - school / college / corporate / organizer -
-- which is what actually qualifies the lead, not the sender's job title). The
-- remaining five had no column at all, and because createDemoRequestSchema is a
-- plain z.object(), Zod would have STRIPPED them silently: the form would appear
-- to submit and the answers would never reach the table. Hence real columns.
--
-- event_date is TEXT, not date. The form field is free text with a
-- "DD / MM / YYYY" placeholder, and institutions type things like "mid-January"
-- or "first week of Feb, TBC". Parsing that into a date column either rejects an
-- otherwise good lead or silently records the wrong day; the sales team reads
-- this field, nothing computes on it.
--
-- The two counts ARE integers - they are the event-size signal worth sorting and
-- filtering leads by, which is the whole reason for capturing them.
-- ============================================================================

alter table demo_requests
  add column if not exists city              varchar,
  add column if not exists event_date        text,
  add column if not exists sport_count       integer,
  add column if not exists participant_count integer,
  add column if not exists source            varchar;

comment on column demo_requests.city is 'Free text, as typed on the marketing form.';
comment on column demo_requests.event_date is
  'Expected event date AS TYPED - deliberately text, the form accepts "mid-January" as readily as a date.';
comment on column demo_requests.sport_count is 'Approx. number of sports the enquirer expects to run.';
comment on column demo_requests.participant_count is 'Approx. number of participants the enquirer expects.';
comment on column demo_requests.source is 'How they heard about EOS - attribution, free text.';

-- Sort/filter leads by event size. Partial: only rows that actually answered the
-- question, which is the only slice the admin ever orders by.
create index if not exists idx_demo_requests_participants
  on demo_requests (participant_count desc)
  where participant_count is not null;
