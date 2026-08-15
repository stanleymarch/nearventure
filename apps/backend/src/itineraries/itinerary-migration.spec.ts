import { describe, expect, it, vi } from 'vitest';
import { CreateItineraryDraft1744650000000 } from '../database/migrations/1744650000000-CreateItineraryDraft';

describe('itinerary migration', () => {
  it('creates draft/receipt schema and compatible route snapshot columns', async () => {
    const runner = { query: vi.fn().mockResolvedValue(undefined), hasTable: vi.fn().mockResolvedValue(true) } as any;
    await new CreateItineraryDraft1744650000000().up(runner);
    const sql = runner.query.mock.calls.map(([value]: [string]) => value).join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS itinerary_draft');
    expect(sql).toContain('PRIMARY KEY (draft_id, command_id)');
    expect(sql).toContain('source_draft_id uuid');
    expect(sql).toContain('itinerary_snapshot jsonb');
  });

  it('does not fail route-column setup when a fresh schema has no routes table', async () => {
    const runner = { query: vi.fn().mockResolvedValue(undefined), hasTable: vi.fn().mockResolvedValue(false) } as any;
    await new CreateItineraryDraft1744650000000().up(runner);
    expect(runner.query.mock.calls.flat().join('\n')).not.toContain('ALTER TABLE routes');
  });
});
