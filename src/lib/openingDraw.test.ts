import {describe, expect, it} from 'vitest';
import {randomPair} from './openingDraw';

describe('randomPair', () => {
  it('returns the only team twice when fewer than two teams exist', () => {
    expect(randomPair(0)).toEqual([0, 0]);
    expect(randomPair(1)).toEqual([0, 0]);
  });

  it('always returns two different valid teams', () => {
    for (let teamCount = 2; teamCount <= 8; teamCount += 1) {
      for (let attempt = 0; attempt < 250; attempt += 1) {
        const [first, second] = randomPair(teamCount);
        expect(first).toBeGreaterThanOrEqual(0);
        expect(second).toBeGreaterThanOrEqual(0);
        expect(first).toBeLessThan(teamCount);
        expect(second).toBeLessThan(teamCount);
        expect(first).not.toBe(second);
      }
    }
  });
});
