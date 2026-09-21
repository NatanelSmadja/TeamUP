import {describe, expect, it} from 'vitest';
import {footLabel, fullName, pollDayDate, positionLabel, roleLabel, statusLabel} from './utils';

describe('display labels', () => {
  it('formats player names and safe fallbacks', () => {
    expect(fullName({first_name: 'נועה', last_name: 'כהן'} as never)).toBe('נועה כהן');
    expect(fullName(null)).toBe('שחקן');
  });

  it('keeps database values mapped to the Hebrew UI', () => {
    expect(positionLabel('goalkeeper')).toBe('שוער');
    expect(footLabel('both')).toBe('שתי רגליים');
    expect(statusLabel('teams_published')).toBe('הקבוצות פורסמו');
  });

  it('maps permission levels consistently', () => {
    expect(roleLabel('admin')).toBe('מנהל קבוצה');
    expect(roleLabel('member', ['manage_matches'])).toBe('מנהל מוגבל');
    expect(roleLabel('member')).toBe('שחקן');
  });
});

describe('pollDayDate', () => {
  it('moves across month and year boundaries in UTC', () => {
    expect(pollDayDate('2026-12-28', 4)).toBe('2027-01-01');
  });
});
