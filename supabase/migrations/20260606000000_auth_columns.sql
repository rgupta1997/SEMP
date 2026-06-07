-- ============================================================================
-- Auth support columns on users
--   * password_hash : custom JWT auth (bcrypt). Nullable — invite-created users
--                     may set it on first login.
--   * is_super_admin: platform admin (Phase 1). Global / event-independent, so
--                     these users need no user_event_roles row.
-- ============================================================================

alter table users
  add column if not exists password_hash  text,
  add column if not exists is_super_admin  boolean not null default false;
