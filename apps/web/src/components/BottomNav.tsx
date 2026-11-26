import { NavLink, useLocation } from 'react-router-dom';
import { LayoutGrid, type LucideIcon, MoreHorizontal } from 'lucide-react';
import { hrefFor, type NavItem, type WorkspaceContext } from '../lib/workspace';
import { NAV_ICONS } from '../lib/nav-icons';
import { cn } from './ui';

/**
 * The mobile primary navigation.
 *
 * There was none. Below `md` the entire nav collapsed into a 240px drawer behind a
 * hamburger, which means every move between two sections of the product cost a tap
 * to open, a read to find, a tap to choose, and a 200ms slide - on a device where
 * the two most common users (an official at the pitch, a student checking a
 * fixture) never see the desktop layout at all.
 *
 * Three destinations, More in the centre, then Account. Four because a fifth cell drops each target below
 * the ~64px that a thumb hits reliably at the bottom corners of a 390px screen, and
 * because the fifth item is almost never the one you want - the drawer still has
 * everything, so More is a complete escape hatch rather than a truncation.
 *
 * WHICH FOUR is not a fixed list: it is the first four items of the SAME
 * `resolveNav()` output the sidebar renders. So the tab bar follows context (org,
 * event, personal, match assignment), follows role, and follows the subscription -
 * a Billing Admin gets Dashboard and Administration, an official inside a match
 * gets the console. One source of truth; the bar cannot offer a page the sidebar
 * would have withheld.
 */

/** Shared with the sidebar - see lib/nav-icons.ts. */
const ICONS: Record<string, LucideIcon> = NAV_ICONS;

interface Group { group: string; items: Array<{ to: string; label: string; icon: React.ReactNode; end?: boolean }> }

export const CELL =
  'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 pt-2 pb-1.5 transition-colors';

/** The active pill sits above the icon so it reads at a glance without colour alone. */
function Cell({ to, label, Icon, end, locked }: { to: string; label: string; Icon: LucideIcon; end?: boolean; locked?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cn(CELL, isActive ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500 dark:text-slate-400')}>
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className={cn(
              'absolute inset-x-3 top-0 h-0.5 rounded-full transition-opacity',
              isActive ? 'bg-brand-600 opacity-100 dark:bg-brand-400' : 'opacity-0',
            )}
          />
          <Icon size={20} strokeWidth={isActive ? 2.4 : 1.9} className={cn(locked && 'opacity-50')} />
          {/* 10px is below the body floor deliberately: a tab label is a caption
              under an icon that already carries the meaning, and a larger one
              truncates to nonsense at 78px of cell width. */}
          <span className={cn('w-full truncate text-center text-[10px] font-semibold leading-none', locked && 'opacity-50')}>
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}

export function BottomNav({
  items, groups, ctx, onMore, trailing,
}: {
  items: Array<NavItem & { locked: boolean }>;
  groups: Group[];
  ctx: WorkspaceContext | null;
  onMore: () => void;
  /** The last cell: the account button. */
  trailing?: React.ReactNode;
}) {
  // Before any early return - a hook after a conditional `return null` changes the
  // hook order between renders and React throws.
  const { pathname } = useLocation();

  // The platform console keeps its flat nav; flatten the groups so a super admin
  // gets a tab bar too rather than a hamburger-only experience.
  const flat = groups.flatMap((g) => g.items);
  const source = ctx && items.length ? items : flat;
  if (!source.length) return null;

  // THE SECTION YOU ARE IN IS ALWAYS IN THE BAR: if it is not among the first
  // three it takes the third slot, so the bar always answers "where am I".
  const matches = (it: NavItem | { to: string }) => {
    const to = ctx && 'key' in it ? hrefFor(ctx, it as NavItem) : (it as { to: string }).to;
    return (it as NavItem).end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  };

  // Three sections with More in the centre and Account last: five cells, so More
  // sits in the exact middle. It is always offered - with no phone top bar it is
  // the only way into the drawer and its workspace switcher.
  const shown = source.slice(0, 3);
  const activeIdx = source.findIndex(matches);
  if (activeIdx >= 3) shown[2] = source[activeIdx];

  const cell = (it: (typeof source)[number]) => {
    const anyIt = it as NavItem & { locked?: boolean; to: string };
    const key = 'key' in it ? (it as NavItem).key : anyIt.to;
    const to = ctx && 'key' in it ? hrefFor(ctx, it as NavItem) : anyIt.to;
    return <Cell key={key} to={to} label={it.label} Icon={ICONS[key] ?? LayoutGrid} end={(it as NavItem).end} locked={anyIt.locked} />;
  };

  const moreButton = (
    <button type="button" onClick={onMore} className={cn(CELL, 'text-slate-500 dark:text-slate-400')} aria-label="More sections">
      <MoreHorizontal size={20} strokeWidth={1.9} />
      <span className="text-[10px] font-semibold leading-none">More</span>
    </button>
  );

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'fixed inset-x-0 bottom-0 z-bottomnav flex items-stretch border-t border-slate-200 bg-white/95 pb-safe backdrop-blur-md md:hidden',
        'dark:border-slate-800 dark:bg-slate-900/95',
      )}
    >
      {shown.slice(0, 2).map(cell)}
      {moreButton}
      {shown.slice(2).map(cell)}
      {trailing}
    </nav>
  );
}
