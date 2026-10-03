import {describe, expect, it} from 'vitest';
import {compareRatingRank} from './ratingRank';

describe('rating leaderboard order', () => {
  it('uses average rating before rating count and keeps equal scores stable by id', () => {
    const players = [
      {id: 'd', avg_rating: 4.2, rating_count: 1},
      {id: 'c', avg_rating: 3.9, rating_count: 20},
      {id: 'b', avg_rating: 4.2, rating_count: 5},
      {id: 'a', avg_rating: 4.2, rating_count: 5},
    ];

    expect(players.sort(compareRatingRank).map(player => player.id)).toEqual(['a', 'b', 'd', 'c']);
  });
});
