import { Link } from 'react-router-dom';
import { BRAND } from '../lib/brand';
import { cn } from './ui';

// The app wordmark: the brand logo image followed by the mono product badge.
//
//   variant 'auto'  — follows the theme (swaps blue/white logo via dark: classes).
//   variant 'white' — always-dark surfaces (e.g. the app sidebar).
//   variant 'blue'  — always-light surfaces.
export function BrandMark({
  variant = 'auto', height = 26, to, className = '',
}: { variant?: 'blue' | 'white' | 'auto'; height?: number; to?: string; className?: string }) {
  const badge =
    variant === 'white' ? 'text-[#5CE1E6] border-[#5CE1E6]/40'
    : variant === 'blue' ? 'text-[#159FA6] border-[#BFE7E9]'
    : 'text-[#159FA6] border-[#BFE7E9] dark:text-[#5CE1E6] dark:border-[#5CE1E6]/40';

  const inner = (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      {variant === 'auto' ? (
        <>
          <img src={BRAND.logo.blue} alt={BRAND.name} className="block dark:hidden" style={{ height }} />
          <img src={BRAND.logo.white} alt={BRAND.name} className="hidden dark:block" style={{ height }} />
        </>
      ) : (
        <img src={BRAND.logo[variant]} alt={BRAND.name} style={{ height, display: 'block' }} />
      )}
      <span className={cn('rounded-md border px-1.5 py-[3px] font-mono text-[10px] font-bold leading-none tracking-[0.16em]', badge)}>{BRAND.productBadge}</span>
    </span>
  );

  return to ? <Link to={to} className="inline-flex">{inner}</Link> : inner;
}
