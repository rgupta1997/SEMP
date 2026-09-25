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
//
// Layout ids/names come from @semp/shared (CERTIFICATE_LAYOUT / _LABEL) so the web
// layout picker reads the same six names instead of keeping its own copy.

import { CERTIFICATE_LAYOUT_LABEL, DEFAULT_CERTIFICATE_BODY, DEFAULT_CERTIFICATE_HEADING, DEFAULT_SIGNATORY_TITLE, type CertificateLayout } from '@semp/shared';

export type LayoutId = CertificateLayout;

export interface TemplateDesign {
  layout?: LayoutId;
  accent?: string;
  ink?: string;
  /** Winners & medals / Special awards wording - the original heading/body. */
  heading?: string;
  body?: string;
  /** Participation, Organising, Officials, Coaches. Falls back to heading/body
   *  when absent, so an existing template renders exactly as it always has
   *  until someone deliberately sets a generic variant for it. */
  generic_heading?: string;
  generic_body?: string;
  signatory_name?: string;
  signatory_title?: string;
  logo_url?: string;
  signature_image_url?: string;
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
    name: CERTIFICATE_LAYOUT_LABEL.classic,
    category: 'Award',
    blurb: 'Engraved serif with a laurel and wax seal. The safe choice for a prize-giving.',
    design: {
      layout: 'classic', accent: '#8A6D2F', ink: '#1B2430',
      heading: DEFAULT_CERTIFICATE_HEADING,
      body: DEFAULT_CERTIFICATE_BODY,
      signatory_title: 'Director of Sport',
    },
  },
  {
    id: 'minimal',
    name: CERTIFICATE_LAYOUT_LABEL.minimal,
    category: 'Award',
    blurb: 'Quiet sans-serif, a single rule, and a lot of air. Reads well at any size.',
    design: {
      layout: 'minimal', accent: '#0C5A63', ink: '#10151A',
      heading: DEFAULT_CERTIFICATE_HEADING,
      body: 'is recognised for the achievement below, verified against a locked result.',
      signatory_title: DEFAULT_SIGNATORY_TITLE,
    },
  },
  {
    id: 'athletic',
    name: CERTIFICATE_LAYOUT_LABEL.athletic,
    category: 'Championship',
    blurb: 'Diagonal colour field and condensed caps. Built for meets and tournaments.',
    design: {
      layout: 'athletic', accent: '#C2410C', ink: '#0B1220',
      heading: 'Champion',
      body: 'finished the event below at the placing shown, against a result that is locked and verifiable.',
      generic_heading: 'Certificate of Recognition',
      generic_body: 'is recognised for their contribution to the event below, verified against a locked result.',
      signatory_title: 'Meet Referee',
    },
  },
  {
    id: 'ornate',
    name: CERTIFICATE_LAYOUT_LABEL.ornate,
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
    name: CERTIFICATE_LAYOUT_LABEL.institutional,
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
    name: CERTIFICATE_LAYOUT_LABEL.ribbon,
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
