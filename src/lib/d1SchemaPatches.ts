async function runPatch(db: D1Database, sql: string): Promise<void> {
  try {
    await db.prepare(sql).run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/duplicate column|already exists/i.test(msg)) {
      console.warn(`D1 schema patch skipped (${sql.slice(0, 80)}…):`, msg);
    }
  }
}

/** Applies additive schema patches on D1 when migrations have not been run yet. */
export async function applyD1SchemaPatches(db: D1Database): Promise<void> {
  await runPatch(
    db,
    `CREATE TABLE IF NOT EXISTS "company_monthly_services" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "company_id" TEXT NOT NULL,
      "service_category" TEXT NOT NULL,
      "label" TEXT,
      "monthly_amount_cents" INTEGER NOT NULL,
      "currency" TEXT NOT NULL DEFAULT 'USD',
      "status" TEXT NOT NULL DEFAULT 'active',
      "description" TEXT,
      "started_at" DATETIME,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL,
      "salesman_payout_cents" INTEGER,
      "salesman_payout_override" INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT "company_monthly_services_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`,
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "company_monthly_services_company_id_idx" ON "company_monthly_services"("company_id")',
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "company_monthly_services_service_category_idx" ON "company_monthly_services"("service_category")',
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "company_monthly_services_status_idx" ON "company_monthly_services"("status")',
  );

  const patches = [
    'ALTER TABLE "tasks" ADD COLUMN "archived_at" DATETIME',
    'ALTER TABLE "invites" ADD COLUMN "reusable" INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE "company_monthly_services" ADD COLUMN "salesman_payout_cents" INTEGER',
    'ALTER TABLE "company_monthly_services" ADD COLUMN "salesman_payout_override" INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE "conversation_members" ADD COLUMN "last_read_at" DATETIME',
  ];

  for (const sql of patches) {
    await runPatch(db, sql);
  }

  await runPatch(
    db,
    `CREATE TABLE IF NOT EXISTS "company_monthly_service_expenses" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "monthly_service_id" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "vendor" TEXT,
      "expense_type" TEXT NOT NULL DEFAULT 'contractor',
      "amount_cents" INTEGER NOT NULL,
      "currency" TEXT NOT NULL DEFAULT 'USD',
      "is_recurring" INTEGER NOT NULL DEFAULT 1,
      "notes" TEXT,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL,
      CONSTRAINT "company_monthly_service_expenses_monthly_service_id_fkey" FOREIGN KEY ("monthly_service_id") REFERENCES "company_monthly_services" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`,
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "company_monthly_service_expenses_monthly_service_id_idx" ON "company_monthly_service_expenses"("monthly_service_id")',
  );

  await runPatch(
    db,
    `CREATE TABLE IF NOT EXISTS "message_mentions" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "message_id" TEXT NOT NULL,
      "user_id" TEXT NOT NULL,
      CONSTRAINT "message_mentions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "message_mentions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`,
  );
  await runPatch(
    db,
    'CREATE UNIQUE INDEX IF NOT EXISTS "message_mentions_message_id_user_id_key" ON "message_mentions"("message_id", "user_id")',
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "message_mentions_user_id_idx" ON "message_mentions"("user_id")',
  );
}
