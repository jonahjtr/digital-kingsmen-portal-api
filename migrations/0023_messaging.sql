-- Messaging: edit/delete, attachments, reactions
ALTER TABLE "messages" ADD COLUMN "edited_at" DATETIME;
ALTER TABLE "messages" ADD COLUMN "deleted_at" DATETIME;
ALTER TABLE "messages" ADD COLUMN "attachment_file_id" TEXT REFERENCES "files" ("id") ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS "message_reactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "message_reactions_message_id_user_id_emoji_key" ON "message_reactions"("message_id", "user_id", "emoji");
CREATE INDEX IF NOT EXISTS "message_reactions_message_id_idx" ON "message_reactions"("message_id");
