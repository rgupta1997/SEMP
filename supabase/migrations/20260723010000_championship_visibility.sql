-- Championship visibility: 'public' championships appear in Discover/Browse for
-- everyone; 'private' ones are visible only to people already involved (organiser,
-- official, enrolled or invited org members) and are joinable by invitation only.

alter table championships
  add column if not exists visibility varchar not null default 'public';

alter table championships
  drop constraint if exists championships_visibility_check;
alter table championships
  add constraint championships_visibility_check check (visibility in ('public', 'private'));
