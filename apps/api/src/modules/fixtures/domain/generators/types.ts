export interface TeamRef {
  teamId: string;
}

// A generated fixture mapped 1:1 onto the columns the algorithm can know up front.
export interface GeneratedFixture {
  round: string;
  poolNumber: number | null;
  bracketPosition: number | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  status: 'scheduled' | 'bye';
  feedsInto?: number; // bracketPosition of the match the winner advances to
}
