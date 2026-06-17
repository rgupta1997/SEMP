import { Link } from 'react-router-dom';
import { cn } from './ui';

// The Sportagon EOS wordmark: the brand logo image followed by the mono "EOS"
// product badge — the same lockup used on the marketing landing page, reused at
// login and in the app shell.
//
//   variant 'auto'  — light surfaces that follow the theme (swaps blue/white logo
//                     and badge colours via dark: classes). Use on themed pages.
//   variant 'white' — always-dark surfaces (e.g. the app sidebar, which stays dark
//                     regardless of theme). Bright teal badge on the white logo.
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
          <img src="/assets/sportagon-logo-blue.png" alt="Sportagon" className="block dark:hidden" style={{ height }} />
          <img src="/assets/sportagon-logo-white.png" alt="Sportagon" className="hidden dark:block" style={{ height }} />
        </>
      ) : (
        <img src={`/assets/sportagon-logo-${variant}.png`} alt="Sportagon" style={{ height, display: 'block' }} />
      )}
      <span className={cn('rounded-md border px-1.5 py-[3px] font-mono text-[10px] font-bold leading-none tracking-[0.16em]', badge)}>EOS</span>
    </span>
  );

  return to ? <Link to={to} className="inline-flex">{inner}</Link> : inner;
}
