import {
  Award, BarChart3, Building2, CalendarDays, Compass, FileBadge, LayoutGrid, Layers,
  ListChecks, type LucideIcon, Settings, Shield, Trophy, Users, Zap,
} from 'lucide-react';

/**
 * Icons by nav key.
 *
 * Lived in BottomNav, where the comment read "the sidebar is text-only; a tab bar
 * without icons is unusable". The sidebar is no longer text-only - it carries the
 * same icons and collapses to an icon-only rail - so the map is shared rather than
 * duplicated. One nav key, one glyph, wherever the nav is drawn.
 *
 * A key with no entry falls back to LayoutGrid. That is deliberate: a new nav item
 * should appear with a generic glyph rather than crash or render a hole, and the
 * missing entry is obvious enough on screen to get fixed.
 */
export const NAV_ICONS: Record<string, LucideIcon> = {
  home: Zap,
  dashboard: LayoutGrid,
  players: Users,
  structure: Building2,
  teams: Shield,
  events: Trophy,
  discover: Compass,
  achievements: Award,
  certificates: FileBadge,
  reports: BarChart3,
  admin: Settings,
  profile: Users,
  orgs: Building2,
  officiating: ListChecks,
  help: Compass,
  // event context
  overview: LayoutGrid,
  setup: Settings,
  organisers: Users,
  participants: Users,
  schedule: CalendarDays,
  results: ListChecks,
  standings: BarChart3,
  communications: Layers,
  settings: Settings,
  matchops: ListChecks,
};

export const NAV_ICON_FALLBACK = LayoutGrid;

export function navIcon(key: string): LucideIcon {
  return NAV_ICONS[key] ?? NAV_ICON_FALLBACK;
}
