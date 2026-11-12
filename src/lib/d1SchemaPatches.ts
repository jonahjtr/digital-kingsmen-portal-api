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
  // Tickets (0024)
  await runPatch(db, `CREATE TABLE IF NOT EXISTS "tickets" ( "id" TEXT NOT NULL PRIMARY KEY, "number" INTEGER NOT NULL, "company_id" TEXT NOT NULL, "project_id" TEXT, "requester_id" TEXT NOT NULL, "assignee_id" TEXT, "category" TEXT NOT NULL, "priority" TEXT NOT NULL, "status" TEXT NOT NULL, "title" TEXT NOT NULL, "source" TEXT NOT NULL DEFAULT 'portal', "custom_fields" TEXT NOT NULL DEFAULT '{}', "first_response_due_at" DATETIME, "resolution_due_at" DATETIME, "first_response_at" DATETIME, "resolved_at" DATETIME, "last_activity_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" DATETIME NOT NULL, CONSTRAINT "tickets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "tickets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE, CONSTRAINT "tickets_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE, CONSTRAINT "tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE )`);
  await runPatch(db, `CREATE UNIQUE INDEX IF NOT EXISTS "tickets_number_key" ON "tickets"("number")`);
  await runPatch(db, `CREATE INDEX IF NOT EXISTS "tickets_company_id_status_idx" ON "tickets"("company_id", "status")`);
  await runPatch(db, `CREATE INDEX IF NOT EXISTS "tickets_assignee_id_status_idx" ON "tickets"("assignee_id", "status")`);
  await runPatch(db, `CREATE INDEX IF NOT EXISTS "tickets_status_last_activity_at_idx" ON "tickets"("status", "last_activity_at")`);
  await runPatch(db, `CREATE TABLE IF NOT EXISTS "ticket_events" ( "id" TEXT NOT NULL PRIMARY KEY, "ticket_id" TEXT NOT NULL, "actor_id" TEXT, "kind" TEXT NOT NULL, "body" TEXT NOT NULL DEFAULT '', "data" TEXT NOT NULL DEFAULT '{}', "internal" BOOLEAN NOT NULL DEFAULT false, "attachment_file_id" TEXT, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets" ("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "ticket_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE, CONSTRAINT "ticket_events_attachment_file_id_fkey" FOREIGN KEY ("attachment_file_id") REFERENCES "files" ("id") ON DELETE SET NULL ON UPDATE CASCADE )`);
  await runPatch(db, `CREATE INDEX IF NOT EXISTS "ticket_events_ticket_id_created_at_idx" ON "ticket_events"("ticket_id", "created_at")`);

  // Ticket assignees (0025)
  await runPatch(db, `CREATE TABLE IF NOT EXISTS "ticket_assignees" ( "ticket_id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("ticket_id", "user_id"), CONSTRAINT "ticket_assignees_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets" ("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "ticket_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE );`);
  await runPatch(db, `CREATE INDEX IF NOT EXISTS "ticket_assignees_user_id_idx" ON "ticket_assignees"("user_id");`);
  await runPatch(db, `INSERT OR IGNORE INTO "ticket_assignees" ("ticket_id", "user_id") SELECT "id", "assignee_id" FROM "tickets" WHERE "assignee_id" IS NOT NULL;`);

  // Messaging: edit/delete, attachments, reactions (0023)
  await runPatch(db, `ALTER TABLE "messages" ADD COLUMN "edited_at" DATETIME`);
  await runPatch(db, `ALTER TABLE "messages" ADD COLUMN "deleted_at" DATETIME`);
  await runPatch(db, `ALTER TABLE "messages" ADD COLUMN "attachment_file_id" TEXT REFERENCES "files" ("id") ON DELETE SET NULL`);
  await runPatch(db, `CREATE TABLE IF NOT EXISTS "message_reactions" ( "id" TEXT NOT NULL PRIMARY KEY, "message_id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "emoji" TEXT NOT NULL, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE )`);
  await runPatch(db, `CREATE UNIQUE INDEX IF NOT EXISTS "message_reactions_message_id_user_id_emoji_key" ON "message_reactions"("message_id", "user_id", "emoji")`);
  await runPatch(db, `CREATE INDEX IF NOT EXISTS "message_reactions_message_id_idx" ON "message_reactions"("message_id")`);

  // MCP tokens + audit log (0022)
  await runPatch(db, `CREATE TABLE IF NOT EXISTS "mcp_tokens" ( "id" TEXT NOT NULL PRIMARY KEY, "user_id" TEXT NOT NULL, "name" TEXT NOT NULL, "token_hash" TEXT NOT NULL, "prefix" TEXT NOT NULL, "scopes" TEXT NOT NULL DEFAULT 'read', "expires_at" DATETIME, "last_used_at" DATETIME, "revoked_at" DATETIME, "created_by" TEXT NOT NULL, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "mcp_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE )`);
  await runPatch(db, `CREATE UNIQUE INDEX IF NOT EXISTS "mcp_tokens_token_hash_key" ON "mcp_tokens"("token_hash")`);
  await runPatch(db, `CREATE INDEX IF NOT EXISTS "mcp_tokens_user_id_idx" ON "mcp_tokens"("user_id")`);
  await runPatch(db, `CREATE TABLE IF NOT EXISTS "mcp_audit_log" ( "id" TEXT NOT NULL PRIMARY KEY, "token_id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "tool" TEXT NOT NULL, "args" TEXT, "ok" INTEGER NOT NULL, "error" TEXT, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP )`);
  await runPatch(db, `CREATE INDEX IF NOT EXISTS "mcp_audit_log_token_id_created_at_idx" ON "mcp_audit_log"("token_id", "created_at")`);

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
