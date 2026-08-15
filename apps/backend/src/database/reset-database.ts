/** Small database-reset primitives kept separate from the executable script so
 * E2E cleanup behavior can be tested without connecting to a real database. */
export interface ResetQueryRunner {
  query<T = unknown>(sql: string): Promise<T>;
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Drop every application table while keeping the schema and installed
 * extensions (PostGIS/pgvector) intact. PostgreSQL resolves FK dependencies
 * through CASCADE, so no one table is dropped before its dependents. */
export async function dropPublicTables(queryRunner: ResetQueryRunner): Promise<void> {
  const tables = await queryRunner.query<{ tablename: string }[]>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );

  for (const { tablename } of tables) {
    await queryRunner.query(`DROP TABLE IF EXISTS public.${quoteIdentifier(tablename)} CASCADE`);
  }
}
