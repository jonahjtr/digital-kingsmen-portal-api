/** Applies additive schema patches on D1 when migrations have not been run yet. */
export async function applyD1SchemaPatches(db: D1Database): Promise<void> {
  const patches = [
    'ALTER TABLE "tasks" ADD COLUMN "archived_at" DATETIME',
    'ALTER TABLE "invites" ADD COLUMN "reusable" INTEGER NOT NULL DEFAULT 0',
  ];

  for (const sql of patches) {
    try {
      await db.prepare(sql).run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/duplicate column|already exists/i.test(msg)) {
        console.warn(`D1 schema patch skipped (${sql}):`, msg);
      }
    }
  }
}
