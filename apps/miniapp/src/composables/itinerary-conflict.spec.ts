import { describe, expect, it } from 'vitest';
import { conflictSnapshot } from '@shared/api/itineraries';

const draft = (version: number) => ({ id: 'draft', version } as any);

describe('miniapp itinerary conflict wire shape', () => {
  it('reads the filtered details.snapshot and legacy response envelopes', () => {
    expect(conflictSnapshot({ status: 409, details: { snapshot: draft(2) } })?.version).toBe(2);
    expect(conflictSnapshot({ response: { status: 409, data: { error: { details: { snapshot: draft(3) } } } } })?.version).toBe(3);
    expect(conflictSnapshot({ response: { status: 409, data: { details: { snapshot: draft(4) } } } })?.version).toBe(4);
    expect(conflictSnapshot({ response: { status: 409, data: { snapshot: draft(5) } } })?.version).toBe(5);
  });
});
