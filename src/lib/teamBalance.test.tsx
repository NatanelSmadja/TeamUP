import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {PlayerBalanceRating, TeamRatingSummary} from '../components/TeamRatingSummary';
import {calcBalance, playerBalanceRating, teamAverage} from './teamBalance';

describe('snapshot rating display', () => {
  const team = {team_players: [{balance_rating_snapshot: '4.50', is_goalkeeper: true}, {balance_rating_snapshot: 3}]};
  it('uses the stored snapshot and averages the currently assigned players', () => {
    expect(teamAverage(team)).toBe(3.75);
    expect(teamAverage({team_players: []})).toBeNull();
    expect(playerBalanceRating({balance_rating_snapshot: null})).toBeNull();
    expect(playerBalanceRating({balance_rating_snapshot: 'bad'})).toBeNull();
    expect(teamAverage({team_players: [...team.team_players, {}]})).toBeNull();
    expect(calcBalance([team, {team_players: [{balance_rating_snapshot: 3.75}]}])).toBe(100);
  });
  it('renders manager ratings but omits them entirely for ordinary viewers', () => {
    const manager = renderToStaticMarkup(<><TeamRatingSummary team={team} teamSize={5} showRatings/><PlayerBalanceRating player={team.team_players[0]} visible/></>);
    expect(manager).toContain('3.75'); expect(manager).toContain('4.50');
    const member = renderToStaticMarkup(<><TeamRatingSummary team={team} teamSize={5} showRatings={false}/><PlayerBalanceRating player={team.team_players[0]} visible={false}/></>);
    expect(member).not.toContain('3.75'); expect(member).not.toContain('4.50');
    expect(member).not.toContain('ממוצע'); expect(member).toContain('קבוצה חלקית');
  });
});
