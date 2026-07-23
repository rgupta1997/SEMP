// Naming templates for demo sandboxes. Data, not logic — they live here so the
// create-form (web) can live-preview the exact defaults the seeder (API) will use.

import type { DemoChampKind } from './enums.js';

// Team names are "<Client> <Suffix>" — Tata Strikers, Tata Hunters, …
export const DEMO_TEAM_SUFFIXES = [
  'Strikers', 'Hunters', 'Titans', 'Warriors', 'Falcons', 'Panthers',
  'Riders', 'Blasters', 'Chargers', 'Kings', 'Gladiators', 'Spartans',
] as const;

// Participating-organization name templates per championship kind; {c} is replaced
// with the client name. 8 slots each = the 8 bracket seeds of every draw.
export const DEMO_ORG_TEMPLATES: Record<DemoChampKind, readonly string[]> = {
  college: [
    '{c} Institute of Technology', '{c} Business School', '{c} Engineering College',
    '{c} Arts & Science College', '{c} Medical College', '{c} Law School',
    '{c} Polytechnic', '{c} Design Institute',
  ],
  school: [
    '{c} Public School', '{c} International School', '{c} High School',
    '{c} Vidya Mandir', '{c} Model School', '{c} Central School',
    '{c} Academy', '{c} Convent School',
  ],
  corporate: [
    '{c} Motors', '{c} Steel', '{c} Consultancy Services', '{c} Power',
    '{c} Chemicals', '{c} Digital', '{c} Capital', '{c} Communications',
  ],
  public: [
    '{c} City Sports Club', '{c} District Athletic Club', '{c} Gymkhana',
    '{c} Recreation Club', '{c} Sports Foundation', '{c} United Club',
    '{c} Community Club', '{c} Youth Club',
  ],
};

// Fill the 8 org slots for a championship kind: admin-supplied names first,
// then templates derived from the client name.
export function demoOrgNamesFor(kind: DemoChampKind, clientName: string, overrides?: string[]): string[] {
  const out = (overrides ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 8);
  for (const tpl of DEMO_ORG_TEMPLATES[kind]) {
    if (out.length >= 8) break;
    const name = tpl.replace('{c}', clientName);
    if (!out.includes(name)) out.push(name);
  }
  return out;
}
