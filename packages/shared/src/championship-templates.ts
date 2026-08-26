// Championship template contracts.
//
// The templates themselves used to live here as a TypeScript const. They are rows in
// `championship_templates` now - the built-ins seeded as `is_system` rows, and everyone
// else's saved from championships they actually ran. A new starting shape is a thing an
// organiser makes, not a thing that needs a deploy.
//
// What stays here is the wire shape, so the wizard and the API agree on what a template
// looks like. Deliberately declarative: NAMES, not ids, resolved against the global
// catalogue at apply time. A template that carried ids would rot the moment the
// catalogue changed.

export interface TemplateDraw {
  /** Sport name as it appears in the global catalogue, e.g. "Badminton". */
  sport: string;
  /** Fixture format by catalogue name, e.g. "Knockout". */
  format: string | null;
  /**
   * Discipline names within that sport, e.g. ["Men's Singles", "Women's Singles"].
   * Empty = one sport-level draw, which is the ordinary case.
   */
  disciplines: string[];
}

export interface TemplateShape {
  type: string | null;
  scheme: string | null;
  draws: TemplateDraw[];
}

/** What the picker shows on a card without having to walk the shape. */
export interface TemplateSummary {
  sports: number;
  draws: number;
  formats: string[];
}

export interface ChampionshipTemplate {
  id: string;
  name: string;
  description: string | null;
  /** A built-in. Visible to everyone, owned by nobody, not deletable. */
  is_system: boolean;
  organization: { id: string; name: string } | null;
  created_by: { id: string; name: string } | null;
  created_at: string;
  shape: TemplateShape;
  summary: TemplateSummary;
}

/** The sports a template will set up, in order - the hover preview's headline. */
export const templateSports = (t: ChampionshipTemplate): string[] =>
  t.shape?.draws?.map((d) => d.sport) ?? [];
