-- Client support tickets (config-driven strings; see src/tickets/config.ts)
CREATE TABLE IF NOT EXISTS "tickets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" INTEGER NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT,
    "requester_id" TEXT NOT NULL,
    "assignee_id" TEXT,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'portal',
    "custom_fields" TEXT NOT NULL DEFAULT '{}',
    "first_response_due_at" DATETIME,
    "resolution_due_at" DATETIME,
    "first_response_at" DATETIME,
    "resolved_at" DATETIME,
    "last_activity_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "tickets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tickets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tickets_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "tickets_number_key" ON "tickets"("number");
CREATE INDEX IF NOT EXISTS "tickets_company_id_status_idx" ON "tickets"("company_id", "status");
CREATE INDEX IF NOT EXISTS "tickets_assignee_id_status_idx" ON "tickets"("assignee_id", "status");
CREATE INDEX IF NOT EXISTS "tickets_status_last_activity_at_idx" ON "tickets"("status", "last_activity_at");
CREATE TABLE IF NOT EXISTS "ticket_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticket_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "data" TEXT NOT NULL DEFAULT '{}',
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "attachment_file_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ticket_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ticket_events_attachment_file_id_fkey" FOREIGN KEY ("attachment_file_id") REFERENCES "files" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ticket_events_ticket_id_created_at_idx" ON "ticket_events"("ticket_id", "created_at");
