-- Multiple assignees per ticket. tickets.assignee_id stays as the lead (first assignee).
CREATE TABLE IF NOT EXISTS "ticket_assignees" ( "ticket_id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("ticket_id", "user_id"), CONSTRAINT "ticket_assignees_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets" ("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "ticket_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE );
CREATE INDEX IF NOT EXISTS "ticket_assignees_user_id_idx" ON "ticket_assignees"("user_id");
INSERT OR IGNORE INTO "ticket_assignees" ("ticket_id", "user_id") SELECT "id", "assignee_id" FROM "tickets" WHERE "assignee_id" IS NOT NULL;
