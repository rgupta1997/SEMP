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
  scheduled_at: string | null;
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
  sport: string | null;
  opponent_team_name: string | null;
}

export interface DashboardData {
  stats: CareerStatsData;
  championships: EventCardData[];
  recent_matches: MatchSummary[];
  achievements: Achievement[];
}
