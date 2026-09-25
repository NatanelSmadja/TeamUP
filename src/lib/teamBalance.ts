type TeamPlayer = {
  balance_rating_snapshot?: number | string | null;
  is_goalkeeper?: boolean;
};
type Team = {team_players: TeamPlayer[]};

// Historical rows without a snapshot must not use today's mutable profile rating.
export function playerBalanceRating(player: TeamPlayer): number | null {
  const value = player.balance_rating_snapshot;
  if (value == null) return null;
  const rating = Number(value);
  return Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : null;
}

export function teamAverage(team: Team): number | null {
  const ratings = team.team_players.map(playerBalanceRating);
  if (!ratings.length || ratings.some(rating => rating === null)) return null;
  return (ratings as number[]).reduce((sum, rating) => sum + rating, 0) / ratings.length;
}

export function formatBalanceRating(rating: number | null): string {
  return rating === null ? '—' : rating.toFixed(2);
}

// This is rating similarity only, not a promise of equal squad sizes or positions.
export function calcBalance(teams: Team[]): number {
  const averages = teams.map(teamAverage);
  if (averages.length < 2 || averages.some(value => value === null)) return 0;
  return Math.max(0, Math.round(100 - (Math.max(...averages as number[]) - Math.min(...averages as number[])) * 20));
}
