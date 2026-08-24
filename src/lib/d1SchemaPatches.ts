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

async function tasksTableHasColumn(db: D1Database, column: string): Promise<boolean> {
  const result = await db.prepare('PRAGMA table_info("tasks")').all<{ name: string }>();
  return (result.results ?? []).some((col: { name: string }) => col.name === column);
}

/** Rebuilds tasks table so project_id is optional and company_id is present. */
async function patchTaskOptionalAnchors(db: D1Database): Promise<void> {
  if (await tasksTableHasColumn(db, 'company_id')) return;

  await runPatch(db, 'PRAGMA foreign_keys=OFF');

  await runPatch(
    db,
    `CREATE TABLE IF NOT EXISTS "tasks_new" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "company_id" TEXT,
      "project_id" TEXT,
      "project_service_id" TEXT,
      "title" TEXT NOT NULL,
      "description" TEXT,
      "assigned_to" TEXT,
      "status" TEXT NOT NULL DEFAULT 'backlog',
      "priority" TEXT NOT NULL DEFAULT 'normal',
      "due_date" DATETIME,
      "client_visible" INTEGER NOT NULL DEFAULT 0,
      "archived_at" DATETIME,
      "created_by" TEXT NOT NULL,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL,
      CONSTRAINT "tasks_new_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "tasks_new_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "tasks_new_project_service_id_fkey" FOREIGN KEY ("project_service_id") REFERENCES "project_services" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "tasks_new_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "tasks_new_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )`,
  );

  await runPatch(
    db,
    `INSERT INTO "tasks_new" (
      "id", "company_id", "project_id", "project_service_id", "title", "description",
      "assigned_to", "status", "priority", "due_date", "client_visible", "archived_at",
      "created_by", "created_at", "updated_at"
    )
    SELECT
      t."id",
      p."company_id",
      t."project_id",
      t."project_service_id",
      t."title",
      t."description",
      t."assigned_to",
      t."status",
      t."priority",
      t."due_date",
      t."client_visible",
      t."archived_at",
      t."created_by",
      t."created_at",
      t."updated_at"
    FROM "tasks" t
    LEFT JOIN "projects" p ON p."id" = t."project_id"`,
  );

  await runPatch(db, 'DROP TABLE "tasks"');
  await runPatch(db, 'ALTER TABLE "tasks_new" RENAME TO "tasks"');
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "tasks_company_id_status_idx" ON "tasks"("company_id", "status")',
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "tasks_project_id_status_idx" ON "tasks"("project_id", "status")',
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "tasks_assigned_to_idx" ON "tasks"("assigned_to")',
  );

  await runPatch(db, 'PRAGMA foreign_keys=ON');
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
    `CREATE TABLE IF NOT EXISTS "company_one_time_transactions" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "company_id" TEXT NOT NULL,
      "project_id" TEXT,
      "salesman_id" TEXT,
      "title" TEXT NOT NULL,
      "description" TEXT,
      "category" TEXT NOT NULL DEFAULT 'other',
      "amount_cents" INTEGER NOT NULL,
      "currency" TEXT NOT NULL DEFAULT 'USD',
      "recognized_at" DATETIME NOT NULL,
      "payment_status" TEXT NOT NULL DEFAULT 'unpaid',
      "salesman_payout_cents" INTEGER,
      "salesman_payout_override" INTEGER NOT NULL DEFAULT 0,
      "notes" TEXT,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL,
      CONSTRAINT "company_one_time_transactions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "company_one_time_transactions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "company_one_time_transactions_salesman_id_fkey" FOREIGN KEY ("salesman_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )`,
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "company_one_time_transactions_company_id_idx" ON "company_one_time_transactions"("company_id")',
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "company_one_time_transactions_project_id_idx" ON "company_one_time_transactions"("project_id")',
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "company_one_time_transactions_salesman_id_idx" ON "company_one_time_transactions"("salesman_id")',
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "company_one_time_transactions_recognized_at_idx" ON "company_one_time_transactions"("recognized_at")',
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "company_one_time_transactions_category_idx" ON "company_one_time_transactions"("category")',
  );

  await runPatch(
    db,
    `CREATE TABLE IF NOT EXISTS "company_one_time_transaction_expenses" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "transaction_id" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "vendor" TEXT,
      "expense_type" TEXT NOT NULL DEFAULT 'contractor',
      "amount_cents" INTEGER NOT NULL,
      "currency" TEXT NOT NULL DEFAULT 'USD',
      "spent_at" DATETIME,
      "notes" TEXT,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL,
      CONSTRAINT "company_one_time_transaction_expenses_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "company_one_time_transactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`,
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "company_one_time_transaction_expenses_transaction_id_idx" ON "company_one_time_transaction_expenses"("transaction_id")',
  );

  await runPatch(
    db,
    `CREATE TABLE IF NOT EXISTS "business_recurring_expenses" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "vendor" TEXT,
      "expense_type" TEXT NOT NULL DEFAULT 'other',
      "amount_cents" INTEGER NOT NULL,
      "currency" TEXT NOT NULL DEFAULT 'USD',
      "is_active" INTEGER NOT NULL DEFAULT 1,
      "service_category" TEXT,
      "started_at" DATETIME,
      "notes" TEXT,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL
    )`,
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "business_recurring_expenses_is_active_idx" ON "business_recurring_expenses"("is_active")',
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

  await runPatch(
    db,
    `CREATE TABLE IF NOT EXISTS "gbp_locations" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "company_id" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "google_business_url" TEXT,
      "formatted_address" TEXT,
      "is_primary" INTEGER NOT NULL DEFAULT 0,
      "sort_order" INTEGER NOT NULL DEFAULT 0,
      "external_location_id" TEXT,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL,
      CONSTRAINT "gbp_locations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`,
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "gbp_locations_company_id_idx" ON "gbp_locations"("company_id")',
  );

  await runPatch(
    db,
    `CREATE TABLE IF NOT EXISTS "gbp_posts" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "company_id" TEXT NOT NULL,
      "post_code" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'draft',
      "post_type" TEXT NOT NULL DEFAULT 'update',
      "topic" TEXT,
      "description" TEXT NOT NULL,
      "cta_type" TEXT,
      "cta_url" TEXT,
      "image_url" TEXT,
      "image_guidance" TEXT,
      "linked_content_url" TEXT,
      "notes" TEXT,
      "posted_at" DATETIME,
      "created_by_id" TEXT,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL,
      CONSTRAINT "gbp_posts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "gbp_posts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )`,
  );
  await runPatch(
    db,
    'CREATE UNIQUE INDEX IF NOT EXISTS "gbp_posts_company_id_post_code_key" ON "gbp_posts"("company_id", "post_code")',
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "gbp_posts_company_id_idx" ON "gbp_posts"("company_id")',
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "gbp_posts_status_idx" ON "gbp_posts"("status")',
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "gbp_posts_created_by_id_idx" ON "gbp_posts"("created_by_id")',
  );

  await runPatch(
    db,
    `CREATE TABLE IF NOT EXISTS "gbp_post_locations" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "post_id" TEXT NOT NULL,
      "location_id" TEXT NOT NULL,
      CONSTRAINT "gbp_post_locations_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "gbp_posts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "gbp_post_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "gbp_locations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`,
  );
  await runPatch(
    db,
    'CREATE UNIQUE INDEX IF NOT EXISTS "gbp_post_locations_post_id_location_id_key" ON "gbp_post_locations"("post_id", "location_id")',
  );
  await runPatch(
    db,
    'CREATE INDEX IF NOT EXISTS "gbp_post_locations_location_id_idx" ON "gbp_post_locations"("location_id")',
  );

  await patchTaskOptionalAnchors(db);
}
