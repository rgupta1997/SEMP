import { describe, expect, it } from 'vitest';
import { DEFAULT_HIDDEN_PRESETS, isPresetShown, readFormatVisibility } from './platform.js';
import { presetsFor } from './racquet-presets.js';

describe('built-in format visibility', () => {
  const tennis = presetsFor('tennis').map((p) => p.presetKey!);

  it('tennis offers ITF Standard, League standard, Grand Slam and the Inter-IIM sets by default', () => {
    expect(tennis.filter((k) => isPresetShown(k, {}))).toEqual([
      'itf_standard_bo3', 'grand_slam_bo5', 'no_ad_match_tb_bo3',
      'iim_men_set6_tb10', 'iim_men_set6_tb10_bo3', 'iim_women_set5_tb7', 'iim_women_set5_tb7_bo3',
    ]);
  });

  it('squash offers WSF/PSA, Club/league, Inter-IIM, Doubles and English 9 best of 5 by default', () => {
    expect(presetsFor('squash').map((p) => p.presetKey!).filter((k) => isPresetShown(k, {})))
      .toEqual(['wsf_pars11_bo5', 'pars11_bo3', 'iim_pars11_bo3_cap21', 'english9_bo5', 'doubles_pars11_bo3']);
  });

  it('table tennis offers ITTF best of 5 and 7, Classic 21 and the corporate game to 21 by default', () => {
    expect(presetsFor('table tennis').map((p) => p.presetKey!).filter((k) => isPresetShown(k, {})))
      .toEqual(['ittf_bo5_11', 'ittf_bo7_11', 'legacy_21_bo3', 'corp_single_21_capped']);
  });

  it('pickleball offers USA Pickleball Standard, side-out games to 15 and 21 and Corporate rally by default', () => {
    expect(presetsFor('pickleball').map((p) => p.presetKey!).filter((k) => isPresetShown(k, {})))
      .toEqual(['usap_tournament_bo3_11', 'usap_single_game_15', 'usap_single_game_21', 'corp_rally_15_cap_17']);
  });

  it('badminton offers BWF Official, Corporate single game to 21 and College fest by default', () => {
    expect(presetsFor('badminton').map((p) => p.presetKey!).filter((k) => isPresetShown(k, {})))
      .toEqual(['bwf_official_3x21', 'corporate_single_21', 'college_bo3_to_11']);
  });

  it('a super admin choice beats the default either way', () => {
    expect(isPresetShown('fast4_bo3', { fast4_bo3: true })).toBe(true);
    expect(isPresetShown('grand_slam_bo5', { grand_slam_bo5: false })).toBe(false);
  });

  it('every hidden-by-default key is a real preset, and no sport default is hidden', () => {
    const sports = ['tennis', 'badminton', 'table tennis', 'squash', 'pickleball'];
    const all = sports.flatMap((s) => presetsFor(s).map((p) => p.presetKey!));
    expect(DEFAULT_HIDDEN_PRESETS.filter((k) => !all.includes(k))).toEqual([]);
    for (const sport of sports) {
      expect(isPresetShown(presetsFor(sport)[0].presetKey!, {})).toBe(true);
    }
  });

  it('reads a missing or malformed setting as no choices', () => {
    expect(readFormatVisibility(null)).toEqual({});
    expect(readFormatVisibility(['x'])).toEqual({});
    expect(readFormatVisibility({ a: true, b: 'yes' })).toEqual({ a: true });
  });
});
