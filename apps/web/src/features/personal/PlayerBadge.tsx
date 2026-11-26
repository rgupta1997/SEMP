import { cn } from '../../components/ui';
import { HEX_CLIP } from './styles';

const SIZES = {
  md: { box: 'h-[64px] w-[56px]', text: 'text-lg', chip: 'text-[10px] px-1 py-px' },
  lg: { box: 'h-[96px] w-[84px]', text: 'text-3xl', chip: 'text-xs px-1.5 py-0.5' },
  xl: { box: 'h-[132px] w-[116px]', text: 'text-4xl', chip: 'text-sm px-2 py-0.5' },
};

/** The player in the Sportagon hexagon: photo or initials, teal edge, profile shirt number on the rim. */
export function PlayerBadge({ name, photo, number, size = 'md', className }: {
  name: string; photo?: string | null; number?: number | null; size?: keyof typeof SIZES; className?: string;
}) {
  const s = SIZES[size];
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return (
    <span aria-hidden className={cn('relative shrink-0 drop-shadow-[0_8px_14px_rgba(0,0,0,.45)]', className)}>
      <span className={cn('block bg-gradient-to-b from-[var(--accent)] to-[var(--accent-deep)] p-[2.5px]', s.box)} style={{ clipPath: HEX_CLIP }}>
        <span className={cn('grid h-full w-full place-items-center overflow-hidden bg-gradient-to-br from-[#2453b8] to-[#1a3d8f] font-black tracking-tight text-white', s.text)} style={{ clipPath: HEX_CLIP }}>
          {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : initials}
        </span>
      </span>
      {number != null && (
        <span className={cn('absolute -bottom-1 -right-1.5 rounded-full bg-white font-black tabular-nums text-[#0a1630] shadow ring-2 ring-[#0a1630]', s.chip)}>#{number}</span>
      )}
    </span>
  );
}
