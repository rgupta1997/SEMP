// Shapes returned by the /me/* participant dashboard endpoints.

export interface CareerStatsData {
  total_events: number;
  total_matches: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface EventCardData {
  id: string;
  name: string;
  slug: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  venue: string | null;
  team_count: number;
  match_count: number;
  win_count: number;
  sports: string[];
}

export type MatchResult = 'won' | 'lost' | 'draw' | 'pending';

export interface MatchSummary {
  id: string;
  round: string | null;
  status: string;
  // 'locked' = the result is official. Anything else is provisional.
  scorecard_status?: 'draft' | 'submitted' | 'locked';
  /** Set only when the result was corrected after being made official (J6-E4-S4). */
  amended_at?: string | null;
  scheduled_at: string | null;
  venue?: string | null;
  sport: string | null;
  discipline: string | null;
  championship: { id: string; name: string; slug: string } | null;
  my_team: { id: string; name: string } | null;
  opponent: { id: string; name: string; organization: string | null } | null;
  my_score: number | null;
  opp_score: number | null;
  result: MatchResult;
}

export interface Achievement {
  id: string;
  award_name: string;
  date: string | null;
  championship: { id: string; name: string } | null;
  tournament: { id: string; name: string } | null;
  sport: string | null;
  discipline: string | null;
  opponent_team_name: string | null;
  my_team_name: string | null;
  round: string | null;
  result: MatchResult;
  fixture_id: string | null;
}

// One occurrence inside a grouped award (shown in the dashboard hover + details page).
export interface AchievementInstance {
  id: string;
  championship: string | null;
  tournament: string | null;
  sport: string | null;
  discipline: string | null;
  opponent_team_name: string | null;
  date: string | null;
  fixture_id: string | null;
}

// Achievements collapsed by award name for the dashboard, so e.g. seven "Player of
// the Match" awards read as a single "7 · Player of the Match" entry, with each
// occurrence's championship / tournament / match revealed on hover.
export interface AchievementGroup {
  award_name: string;
  count: number;
  latest_date: string | null;
  instances: AchievementInstance[];
}

export interface DashboardData {
  stats: CareerStatsData;
  championships: EventCardData[];
  recent_matches: MatchSummary[];
  achievements: Achievement[];
}
