import {
  ENTRY_TYPE, CHAMPIONSHIP_STATUS, FIXTURE_STATUS, GROUND_TYPE, SPONSOR_TIER,
  TOURNAMENT_DISCIPLINE_STATUS, TOURNAMENT_STATUS,
} from '@semp/shared';

export type FieldType = 'text' | 'number' | 'checkbox' | 'textarea' | 'json' | 'date' | 'select' | 'relation';

export interface FieldDef {
  name: string;
  label: string;
  type?: FieldType; // default 'text'
  options?: readonly string[]; // for 'select'
  relation?: { path: string; labelKey: string; nullable?: boolean }; // for 'relation'
  default?: unknown;
  createOnly?: boolean; // e.g. password
}

export interface ResourceConfig {
  key: string;
  title: string;
  path: string; // api path, e.g. '/sports'
  columns: { key: string; label: string }[];
  fields: FieldDef[];
  noEdit?: boolean;
  noDelete?: boolean;
  statusEndpoint?: boolean; // championships: PATCH /:id/status with CHAMPIONSHIP_STATUS
}

const sel = (options: readonly string[]) => ({ type: 'select' as const, options });
const rel = (path: string, labelKey = 'name', nullable = false) =>
  ({ type: 'relation' as const, relation: { path, labelKey, nullable } });

export const RESOURCES: Record<string, ResourceConfig> = {
  permissions: {
    key: 'permissions', title: 'Permissions', path: '/permissions',
    columns: [{ key: 'code', label: 'Code' }, { key: 'label', label: 'Label' }],
    fields: [
      { name: 'code', label: 'Code' },
      { name: 'label', label: 'Label' },
      { name: 'rules', label: 'Rules (JSON array)', type: 'json', default: [] },
    ],
  },
  roles: {
    key: 'roles', title: 'Roles', path: '/roles',
    columns: [{ key: 'name', label: 'Name' }, { key: 'description', label: 'Description' }],
    fields: [
      { name: 'name', label: 'Name' },
      { name: 'description', label: 'Description' },
      { name: 'permission_ids', label: 'Permission IDs (JSON array)', type: 'json', default: [] },
    ],
  },
  sports: {
    key: 'sports', title: 'Sports', path: '/sports',
    columns: [{ key: 'name', label: 'Name' }, { key: 'icon', label: 'Icon' }],
    fields: [{ name: 'name', label: 'Name' }, { name: 'icon', label: 'Icon (emoji)' }],
  },
  disciplines: {
    key: 'disciplines', title: 'Disciplines', path: '/disciplines',
    columns: [{ key: 'name', label: 'Name' }, { key: 'entry_type', label: 'Entry' }, { key: 'squad_min', label: 'Min' }, { key: 'squad_max', label: 'Max' }],
    fields: [
      { name: 'sport_id', label: 'Sport', ...rel('/sports') },
      { name: 'name', label: 'Name' },
      { name: 'description', label: 'Description' },
      { name: 'entry_type', label: 'Entry type', ...sel(ENTRY_TYPE), default: 'team' },
      { name: 'squad_min', label: 'Squad min', type: 'number', default: 1 },
      { name: 'squad_max', label: 'Squad max', type: 'number', default: 15 },
      { name: 'display_order', label: 'Display order', type: 'number', default: 0 },
    ],
  },
  'tournament-formats': {
    key: 'tournament-formats', title: 'Tournament Formats', path: '/tournament-formats',
    columns: [{ key: 'name', label: 'Name' }, { key: 'description', label: 'Description' }],
    fields: [
      { name: 'name', label: 'Name' },
      { name: 'description', label: 'Description' },
      { name: 'config', label: 'Config template (JSON)', type: 'json', default: {} },
    ],
  },
  organizations: {
    key: 'organizations', title: 'Organizations', path: '/organizations',
    columns: [{ key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'city', label: 'City' }],
    fields: [
      { name: 'name', label: 'Name' },
      { name: 'short_name', label: 'Short name' },
      { name: 'code', label: 'Code' },
      { name: 'city', label: 'City' },
      { name: 'country', label: 'Country', default: 'India' },
      { name: 'logo_url', label: 'Logo URL' },
      { name: 'status', label: 'Active', type: 'checkbox' },
    ],
  },
  championships: {
    key: 'championships', title: 'Championships', path: '/championships', statusEndpoint: true,
    columns: [{ key: 'name', label: 'Name' }, { key: 'slug', label: 'Slug' }, { key: 'status', label: 'Status' }, { key: 'start_date', label: 'Start' }],
    fields: [
      { name: 'name', label: 'Name' },
      { name: 'slug', label: 'Slug' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'venue', label: 'Venue (text)' },
      { name: 'start_date', label: 'Start date', type: 'date' },
      { name: 'end_date', label: 'End date', type: 'date' },
    ],
  },
  venues: {
    key: 'venues', title: 'Venues', path: '/venues',
    columns: [{ key: 'name', label: 'Name' }, { key: 'city', label: 'City' }],
    fields: [
      { name: 'championship_id', label: 'Championship', ...rel('/championships') },
      { name: 'name', label: 'Name' },
      { name: 'address', label: 'Address' },
      { name: 'city', label: 'City' },
      { name: 'country', label: 'Country', default: 'India' },
      { name: 'latitude', label: 'Latitude', type: 'number' },
      { name: 'longitude', label: 'Longitude', type: 'number' },
    ],
  },
  'venue-grounds': {
    key: 'venue-grounds', title: 'Venue Grounds', path: '/venue-grounds',
    columns: [{ key: 'name', label: 'Name' }, { key: 'ground_type', label: 'Type' }, { key: 'capacity', label: 'Capacity' }],
    fields: [
      { name: 'venue_id', label: 'Venue', ...rel('/venues') },
      { name: 'name', label: 'Name' },
      { name: 'ground_type', label: 'Ground type', ...sel(GROUND_TYPE) },
      { name: 'capacity', label: 'Capacity', type: 'number' },
      { name: 'display_order', label: 'Display order', type: 'number', default: 0 },
      { name: 'is_active', label: 'Active', type: 'checkbox', default: true },
    ],
  },
  sponsors: {
    key: 'sponsors', title: 'Sponsors', path: '/sponsors',
    columns: [{ key: 'name', label: 'Name' }, { key: 'tier', label: 'Tier' }],
    fields: [
      { name: 'championship_id', label: 'Championship', ...rel('/championships') },
      { name: 'name', label: 'Name' },
      { name: 'tier', label: 'Tier', ...sel(SPONSOR_TIER), default: 'community' },
      { name: 'website_url', label: 'Website URL' },
      { name: 'logo_url', label: 'Logo URL' },
      { name: 'display_order', label: 'Display order', type: 'number', default: 0 },
    ],
  },
  tournaments: {
    key: 'tournaments', title: 'Tournaments', path: '/tournaments',
    columns: [{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }],
    fields: [
      { name: 'championship_id', label: 'Championship', ...rel('/championships') },
      { name: 'name', label: 'Name' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'status', label: 'Status', ...sel(TOURNAMENT_STATUS), default: 'draft' },
    ],
  },
  'tournament-sports': {
    key: 'tournament-sports', title: 'Tournament Sports', path: '/tournament-sports',
    columns: [{ key: 'tournament_id', label: 'Tournament' }, { key: 'sport_id', label: 'Sport' }, { key: 'display_order', label: 'Order' }],
    fields: [
      { name: 'tournament_id', label: 'Tournament', ...rel('/tournaments') },
      { name: 'sport_id', label: 'Sport', ...rel('/sports') },
      { name: 'format_id', label: 'Format', ...rel('/tournament-formats') },
      { name: 'format_config', label: 'Format config (JSON)', type: 'json', default: {} },
      { name: 'display_order', label: 'Display order', type: 'number', default: 0 },
    ],
  },
  'tournament-disciplines': {
    key: 'tournament-disciplines', title: 'Tournament Disciplines', path: '/tournament-disciplines',
    columns: [{ key: 'status', label: 'Status' }, { key: 'display_order', label: 'Order' }],
    fields: [
      { name: 'tournament_sport_id', label: 'Tournament sport (id)', type: 'text' },
      { name: 'discipline_id', label: 'Discipline', ...rel('/disciplines', 'name', true) },
      { name: 'format_id', label: 'Format override', ...rel('/tournament-formats', 'name', true) },
      { name: 'venue_id', label: 'Venue', ...rel('/venues', 'name', true) },
      { name: 'rulebook_url', label: 'Rulebook URL' },
      { name: 'entry_type', label: 'Entry type override', ...sel(ENTRY_TYPE) },
      { name: 'squad_min', label: 'Squad min override', type: 'number' },
      { name: 'squad_max', label: 'Squad max override', type: 'number' },
      { name: 'status', label: 'Status', ...sel(TOURNAMENT_DISCIPLINE_STATUS), default: 'upcoming' },
      { name: 'display_order', label: 'Display order', type: 'number', default: 0 },
    ],
  },
  users: {
    key: 'users', title: 'Users', path: '/users', noEdit: true, noDelete: true,
    columns: [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'account_type', label: 'Account' }, { key: 'is_super_admin', label: 'Admin' }],
    fields: [
      { name: 'name', label: 'Name' },
      { name: 'email', label: 'Email' },
      { name: 'password', label: 'Password', createOnly: true },
      { name: 'phone', label: 'Phone' },
    ],
  },
};

export const FIXTURE_STATUS_OPTIONS = FIXTURE_STATUS;
export const CHAMPIONSHIP_STATUS_OPTIONS = CHAMPIONSHIP_STATUS;
