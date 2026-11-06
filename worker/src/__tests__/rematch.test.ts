import { describe, it, expect } from 'vitest';
import { classifyPriorOffers } from '../matching/candidates';

const at = (iso: string) => new Date(iso).getTime();
const offer = (technician_id: string, offer_status: string, offered_at: string) => ({ technician_id, offer_status, offered_at });

describe('classifyPriorOffers (re-match after a technician drops a job)', () => {
  const offers = [
    offer('lost', 'LOST_TO_ANOTHER_TECHNICIAN', '2026-11-06T10:00:00Z'),
    offer('expired', 'EXPIRED', '2026-11-06T10:00:00Z'),
    offer('declined', 'DECLINED', '2026-11-06T10:00:00Z'),
    offer('winner', 'CANCELLED', '2026-11-06T10:00:00Z'), // the accepted offer, voided on drop
  ];

  it('in a normal search, everyone already offered is excluded so batches reach new technicians', () => {
    const { excluded, previouslyInterested } = classifyPriorOffers(offers, 0);
    expect([...excluded].sort()).toEqual(['declined', 'expired', 'lost', 'winner']);
    expect(previouslyInterested.size).toBe(0);
  });

  it('after a drop, lost/expired get another chance (lost first); declined and the dropper stay out', () => {
    const { excluded, previouslyInterested } = classifyPriorOffers(offers, at('2026-11-06T11:00:00Z'));
    expect([...excluded].sort()).toEqual(['declined', 'winner']);
    expect([...previouslyInterested]).toEqual(['lost']);
  });

  it('offers made after the drop are normal offers again: no endless re-offering', () => {
    const later = [offer('expired', 'EXPIRED', '2026-11-06T11:05:00Z')];
    expect(classifyPriorOffers(later, at('2026-11-06T11:00:00Z')).excluded.has('expired')).toBe(true);
  });
});
