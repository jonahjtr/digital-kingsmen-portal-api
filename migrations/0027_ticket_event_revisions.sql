-- Editable ticket messages with revision history.
ALTER TABLE "ticket_events" ADD COLUMN "edited_at" DATETIME;
CREATE TABLE IF NOT EXISTS "ticket_event_revisions" ( "id" TEXT NOT NULL PRIMARY KEY, "event_id" TEXT NOT NULL, "body" TEXT NOT NULL, "editor_id" TEXT, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ticket_event_revisions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "ticket_events" ("id") ON DELETE CASCADE ON UPDATE CASCADE );
CREATE INDEX IF NOT EXISTS "ticket_event_revisions_event_id_created_at_idx" ON "ticket_event_revisions"("event_id", "created_at");
