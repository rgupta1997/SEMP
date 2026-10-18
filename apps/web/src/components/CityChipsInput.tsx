import { useState } from 'react';
import { X } from 'lucide-react';
import { HOST_CITIES_MAX, normaliseCities } from '@semp/shared';

/**
 * Host cities as chips. Enter or a comma adds what is typed; × or Backspace on an
 * empty box removes. Text still in the box is added on blur, so a city typed and
 * then followed straight by "Save" is not lost.
 */
export function CityChipsInput({ value, onChange, placeholder = 'Mumbai' }: {
  value: string[];
  onChange: (cities: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const full = value.length >= HOST_CITIES_MAX;

  const commit = () => {
    if (!draft.trim()) return;
    onChange(normaliseCities([...value, ...draft.split(',')]).slice(0, HOST_CITIES_MAX));
    setDraft('');
  };

  return (
    <div className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1.5 shadow-sm focus-within:border-brand-500 focus-within:ring-[3px] focus-within:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800">
      {value.map((city) => (
        <span key={city} className="flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-1 text-sm font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          {city}
          {/* A span, not a <button>: inside a <label> (Field) a click anywhere on the label
              activates its first button - which would silently remove the first city. */}
          <span role="button" tabIndex={0} aria-label={`Remove ${city}`}
            onClick={(e) => { e.preventDefault(); onChange(value.filter((c) => c !== city)); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(value.filter((c) => c !== city)); }
            }}
            className="grid h-5 w-5 cursor-pointer place-items-center rounded-full hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dark:hover:bg-brand-500/25">
            <X size={12} />
          </span>
        </span>
      ))}
      {!full && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
            else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={commit}
          placeholder={value.length ? 'Add another city' : placeholder}
          aria-label="Add a host city"
          className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
      )}
    </div>
  );
}
