-- Previous versions of edited messages ("see original").
CREATE TABLE IF NOT EXISTS "message_edits" ( "id" TEXT NOT NULL PRIMARY KEY, "message_id" TEXT NOT NULL, "previous_message" TEXT NOT NULL, "edited_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "message_edits_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE );
CREATE INDEX IF NOT EXISTS "message_edits_message_id_idx" ON "message_edits"("message_id");
