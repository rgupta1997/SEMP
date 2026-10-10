/** The product's name, for text the API writes as well as the app shows. */
export const PLATFORM_NAME = 'Sportagon';

/**
 * Platform switch (`platform_settings` key): the player insights card on career stats.
 * On unless a super admin turns it off - a missing row reads as on.
 */
export const INSIGHTS_ENABLED_SETTING = 'player_insights_enabled';

/**
 * Platform switch: which built-in formats the pickers offer. Stored as the super admin's
 * choices only ({ presetKey: shown }), so a default added here later still applies.
 */
export const FORMAT_VISIBILITY_SETTING = 'match_format_visibility';
export type FormatVisibility = Record<string, boolean>;

/** Rare built-in formats, hidden until a super admin shows them. */
export const DEFAULT_HIDDEN_PRESETS: readonly string[] = [
  // Tennis: ITF/AITA Standard, League standard and Grand Slam stay on.
  'fast4_bo3', 'itf_short_sets_bo3', 'pro_set_8', 'single_set_6_noad',
  'match_tb_10_shootout', 'flat_single_game_21', 'flat_bo3_to_11', 'timed_rubber_20',
  // Squash: WSF/PSA, Club/league, Doubles and English 9 best of 5 stay on.
  'english9_bo3', 'single_game_15_pars', 'single_game_21_pars', 'timecap_10min_game_sq',
  'flash_bo3_to_7', 'handicap_pars11',
  // Table tennis: ITTF best of 5 and 7, Classic 21 and Corporate single game to 21 stay on.
  'corp_single_15_suddendeath', 'corp_bo3_11_timecap', 'sprint_9_serve3', 'blitz_7',
  // Pickleball: USA Pickleball Standard, side-out games to 15 and 21, Corporate rally stay on.
  'mlp_rally_21', 'pool_11_straight', 'timecap_10min_game', 'college_bo3_rally_11_cap15',
  // Badminton: BWF Official, College fest and Corporate single game to 21 stay on.
  'bwf_bo5_11', 'classic_15_sideout', 'corporate_single_15_timecapped', 'corporate_single_21_doubles', 'box_sprint_11',
];

export const isPresetShown = (presetKey: string, choices: FormatVisibility): boolean =>
  choices[presetKey] ?? !DEFAULT_HIDDEN_PRESETS.includes(presetKey);

/** The stored choices, tolerating a missing or malformed row. */
export const readFormatVisibility = (value: unknown): FormatVisibility =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => typeof v === 'boolean')) as FormatVisibility
    : {};
