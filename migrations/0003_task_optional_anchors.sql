-- Rebuild tasks: optional project_id, add company_id (D1 / SQLite)
PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS "tasks_new" (
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
);

INSERT OR IGNORE INTO "tasks_new" (
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
LEFT JOIN "projects" p ON p."id" = t."project_id";

DROP TABLE IF EXISTS "tasks";
ALTER TABLE "tasks_new" RENAME TO "tasks";

CREATE INDEX IF NOT EXISTS "tasks_company_id_status_idx" ON "tasks"("company_id", "status");
CREATE INDEX IF NOT EXISTS "tasks_project_id_status_idx" ON "tasks"("project_id", "status");
CREATE INDEX IF NOT EXISTS "tasks_assigned_to_idx" ON "tasks"("assigned_to");

PRAGMA foreign_keys=ON;
