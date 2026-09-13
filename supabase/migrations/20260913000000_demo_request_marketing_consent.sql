-- ============================================================================
-- A second, unbundled consent: marketing communications.
--
-- The "Book a demo" form's existing checkbox ("I agree to be contacted about
-- this enquiry") is about answering the enquiry itself - it is not, and must
-- not be read as, consent to marketing. Bundling the two into one checkbox
-- would either force a marketing opt-in on everyone who just wants a demo, or
-- leave marketing consent unprovable later. So this is its own column, its own
-- checkbox, unchecked by default, genuinely optional.
-- ============================================================================

alter table demo_requests
  add column if not exists marketing_consent boolean not null default false;

comment on column demo_requests.marketing_consent is
  'Explicit, separate opt-in to marketing communications - distinct from the enquiry-contact consent every submission already implies. Defaults false; only true when the visitor ticked the marketing checkbox themselves.';
