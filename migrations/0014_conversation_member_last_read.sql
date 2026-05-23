-- Per-user read position for conversation inbox unread counts
ALTER TABLE "conversation_members" ADD COLUMN "last_read_at" DATETIME;

-- Treat existing threads as already read (avoid flooding badges on deploy)
UPDATE "conversation_members"
SET "last_read_at" = COALESCE(
  (
    SELECT MAX("created_at")
    FROM "messages"
    WHERE "messages"."conversation_id" = "conversation_members"."conversation_id"
  ),
  "conversation_members"."created_at"
);
