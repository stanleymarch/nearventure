import { describe, expect, it, vi } from 'vitest';
import { dropPublicTables, quoteIdentifier } from './reset-database';

describe('E2E database reset primitives', () => {
  it('quotes identifiers defensively', () => {
    expect(quoteIdentifier('user')).toBe('"user"');
    expect(quoteIdentifier('bad"name')).toBe('"bad""name"');
  });

  it('discovers public tables then drops each with CASCADE', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ tablename: 'user' }, { tablename: 'itinerary_draft' }])
      .mockResolvedValue(undefined);

    await dropPublicTables({ query });

    expect(query).toHaveBeenNthCalledWith(1, "SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    expect(query).toHaveBeenNthCalledWith(2, 'DROP TABLE IF EXISTS public."user" CASCADE');
    expect(query).toHaveBeenNthCalledWith(3, 'DROP TABLE IF EXISTS public."itinerary_draft" CASCADE');
  });
});
