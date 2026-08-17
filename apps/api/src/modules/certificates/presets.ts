// A starter library of certificate designs, so the Template Gallery has real work in
// it on day one instead of an empty state and a "create your first template" button.
//
// Six layouts drawn from the conventions certificates actually follow - the engraved
// award, the modern minimal, the athletic banner, the ornate frame, the institutional
// letterhead, the participation ribbon. Each is pure CSS plus inline SVG: no webfont,
// no image host, nothing fetched at print time. A certificate that needs the network
// to look right is not a document somebody can keep.
//
// An institution copies one into its own templates and edits wording, colour and
// signatory from there; the preset is the starting point, not a cage.

export type LayoutId = 'classic' | 'minimal' | 'athletic' | 'ornate' | 'institutional' | 'ribbon';

export interface TemplateDesign {
  layout?: LayoutId;
  accent?: string;
  ink?: string;
  heading?: string;
  body?: string;
  signatory_name?: string;
  signatory_title?: string;
  logo_url?: string;
}

export interface Preset {
  id: LayoutId;
  name: string;
  category: string;
  /** What this design is for, in the gallery card. */
  blurb: string;
  design: TemplateDesign;
}

export const CERTIFICATE_PRESETS: Preset[] = [
  {
    id: 'classic',
    name: 'Classic Laurel',
    category: 'Award',
    blurb: 'Engraved serif with a laurel and wax seal. The safe choice for a prize-giving.',
    design: {
      layout: 'classic', accent: '#8A6D2F', ink: '#1B2430',
      heading: 'Certificate of Achievement',
      body: 'is hereby recognised for the achievement recorded below, verified against an official locked result.',
      signatory_title: 'Director of Sport',
    },
  },
  {
    id: 'minimal',
    name: 'Modern Minimal',
    category: 'Award',
    blurb: 'Quiet sans-serif, a single rule, and a lot of air. Reads well at any size.',
    design: {
      layout: 'minimal', accent: '#0C5A63', ink: '#10151A',
      heading: 'Certificate of Achievement',
      body: 'is recognised for the achievement below, verified against a locked result.',
      signatory_title: 'Issuing authority',
    },
  },
  {
    id: 'athletic',
    name: 'Athletic Banner',
    category: 'Championship',
    blurb: 'Diagonal colour field and condensed caps. Built for meets and tournaments.',
    design: {
      layout: 'athletic', accent: '#C2410C', ink: '#0B1220',
      heading: 'Champion',
      body: 'finished the event below at the placing shown, against a result that is locked and verifiable.',
      signatory_title: 'Meet Referee',
    },
  },
  {
    id: 'ornate',
    name: 'Ornate Frame',
    category: 'Honour',
    blurb: 'Double-ruled border with corner filigree on cream. For honours and life awards.',
    design: {
      layout: 'ornate', accent: '#7A2E3B', ink: '#241C1A',
      heading: 'Certificate of Honour',
      body: 'is presented this certificate in recognition of the distinction recorded below.',
      signatory_title: 'Chair, Awards Committee',
    },
  },
  {
    id: 'institutional',
    name: 'Institutional Letterhead',
    category: 'Official',
    blurb: 'Header band, logo lockup and a formal two-column footer. Looks like a record.',
    design: {
      layout: 'institutional', accent: '#1E3A8A', ink: '#111827',
      heading: 'Certificate of Merit',
      body: 'has satisfied the requirements set out below. This certificate is issued from the institution’s official record and may be verified at any time.',
      signatory_title: 'Registrar',
    },
  },
  {
    id: 'ribbon',
    name: 'Participation Ribbon',
    category: 'Participation',
    blurb: 'Warm, badge-led and unfussy. For turning up, which is worth its own design.',
    design: {
      layout: 'ribbon', accent: '#0F766E', ink: '#14211F',
      heading: 'Certificate of Participation',
      body: 'took part in the event below and is thanked for their contribution to it.',
      signatory_title: 'Event Organiser',
    },
  },
];

export const presetById = (id: string): Preset | undefined =>
  CERTIFICATE_PRESETS.find((p) => p.id === id);

/** The layout a saved template asks for, falling back to the quiet one. */
export const layoutOf = (design: TemplateDesign | null | undefined): LayoutId => {
  const l = design?.layout;
  return CERTIFICATE_PRESETS.some((p) => p.id === l) ? (l as LayoutId) : 'minimal';
};
