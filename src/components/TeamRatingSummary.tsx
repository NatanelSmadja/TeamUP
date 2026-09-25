import {formatBalanceRating, playerBalanceRating, teamAverage} from '../lib/teamBalance';

export function PlayerBalanceRating({player, visible}: {player: Parameters<typeof playerBalanceRating>[0]; visible: boolean}) {
  if (!visible) return null;
  return <em className="player-balance-rating" title="הדירוג ששימש בחלוקה" aria-label={`דירוג בחלוקה ${formatBalanceRating(playerBalanceRating(player))}`}>{formatBalanceRating(playerBalanceRating(player))}</em>;
}

export function TeamRatingSummary({team, teamSize, showRatings}: {team: Parameters<typeof teamAverage>[0]; teamSize: number; showRatings: boolean}) {
  const keepers = team.team_players.filter(player => player.is_goalkeeper).length;
  return <div className="team-rating-summary">
    {showRatings && <span className="team-average-rating">ממוצע בחלוקה: <b>{formatBalanceRating(teamAverage(team))}</b></span>}
    <span>{keepers === 1 ? 'שוער אחד' : keepers ? `${keepers} שוערים` : 'ללא שוער'}</span>
    {team.team_players.length < teamSize && <span>קבוצה חלקית · {team.team_players.length}/{teamSize}</span>}
  </div>;
}
