-- Personal MCP tokens for DK staff + audit log of every MCP tool call
CREATE TABLE IF NOT EXISTS "mcp_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'read',
    "expires_at" DATETIME,
    "last_used_at" DATETIME,
    "revoked_at" DATETIME,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_tokens_token_hash_key" ON "mcp_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "mcp_tokens_user_id_idx" ON "mcp_tokens"("user_id");

CREATE TABLE IF NOT EXISTS "mcp_audit_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" TEXT,
    "ok" INTEGER NOT NULL,
    "error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "mcp_audit_log_token_id_created_at_idx" ON "mcp_audit_log"("token_id", "created_at");
