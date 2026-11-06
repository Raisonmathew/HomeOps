import { describe, it, expect } from 'vitest';
import { timeWindowOptions, formatWindow, parseEstimate, escapeMd, formatDateTime, onlineUntilOptions } from '../telegram/format';

describe('formatDateTime / onlineUntilOptions (IST)', () => {
  it('formats in IST', () => {
    expect(formatDateTime('2026-11-06T09:35:00Z')).toBe('6 Nov, 3:05 PM');
  });
  it('offers "Until 9 PM" only when it is at least an hour away', () => {
    const noonIst = new Date('2026-11-06T06:30:00Z');
    expect(onlineUntilOptions(noonIst).find((o) => o.key === 'eod')?.hours).toBe(9);
    expect(onlineUntilOptions(new Date('2026-11-06T15:00:00Z')).some((o) => o.key === 'eod')).toBe(false); // 8:30 PM IST
  });
});

describe('timeWindowOptions (IST)', () => {
  it('offers today-evening before 5 PM IST and maps it to 11:30-14:30 UTC', () => {
    const now = new Date('2026-11-06T06:00:00Z'); // 11:30 IST
    const opts = timeWindowOptions(now);
    const eve = opts.find((o) => o.key === 'today_eve')!;
    expect(eve.start.toISOString()).toBe('2026-11-06T11:30:00.000Z');
    expect(eve.end.toISOString()).toBe('2026-11-06T14:30:00.000Z');
    expect(opts.find((o) => o.key === 'tom_morn')!.start.toISOString()).toBe('2026-11-07T03:30:00.000Z');
  });

  it('hides today-evening after 5 PM IST and rolls "tomorrow" over the IST date, not the UTC date', () => {
    const now = new Date('2026-11-06T19:00:00Z'); // 00:30 IST on the 7th
    const opts = timeWindowOptions(now);
    expect(opts.find((o) => o.key === 'today_eve')!.start.toISOString()).toBe('2026-11-07T11:30:00.000Z');
    expect(opts.find((o) => o.key === 'tom_morn')!.start.toISOString()).toBe('2026-11-08T03:30:00.000Z');

    const late = new Date('2026-11-06T12:00:00Z'); // 17:30 IST
    expect(timeWindowOptions(late).some((o) => o.key === 'today_eve')).toBe(false);
  });
});

describe('formatWindow', () => {
  it('renders day and 12-hour IST times', () => {
    const now = new Date('2026-11-06T06:00:00Z');
    expect(formatWindow('2026-11-06T11:30:00Z', '2026-11-06T14:30:00Z', now)).toBe('Today, 5 PM-8 PM');
    expect(formatWindow('2026-11-07T03:30:00Z', '2026-11-07T06:30:00Z', now)).toBe('Tomorrow, 9 AM-12 PM');
  });
});

describe('parseEstimate', () => {
  it('reads up to three amounts, defaulting missing ones to 0', () => {
    expect(parseEstimate('200, 800, 150')).toEqual({ visitCharge: 200, labourAmount: 800, partsAmount: 150 });
    expect(parseEstimate('₹300')).toEqual({ visitCharge: 300, labourAmount: 0, partsAmount: 0 });
    expect(parseEstimate('visit 1,200 labour 2500')).toEqual({ visitCharge: 1200, labourAmount: 2500, partsAmount: 0 });
  });

  it('rejects empty, too many, or absurd amounts', () => {
    expect(parseEstimate('no idea')).toBeNull();
    expect(parseEstimate('1 2 3 4')).toBeNull();
    expect(parseEstimate('99999999')).toBeNull();
  });
});

describe('escapeMd', () => {
  it('escapes Telegram Markdown control characters', () => {
    expect(escapeMd('flat_2 *B* [x]')).toBe('flat\\_2 \\*B\\* \\[x]');
  });
});
