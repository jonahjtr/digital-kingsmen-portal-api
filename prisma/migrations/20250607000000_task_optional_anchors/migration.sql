-- Rebuild tasks table: optional project_id, add company_id
PRAGMA foreign_keys=OFF;

CREATE TABLE "tasks_new" (
    "id" TEXT NOT NULL,
    "company_id" TEXT,
    "project_id" TEXT,
    "project_service_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigned_to" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'backlog',
    "priority" "Priority" NOT NULL DEFAULT 'normal',
    "due_date" TIMESTAMP(3),
    "client_visible" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tasks_new_pkey" PRIMARY KEY ("id")
);

INSERT INTO "tasks_new" (
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

DROP TABLE "tasks";
ALTER TABLE "tasks_new" RENAME TO "tasks";

CREATE INDEX "tasks_company_id_status_idx" ON "tasks"("company_id", "status");
CREATE INDEX "tasks_project_id_status_idx" ON "tasks"("project_id", "status");
CREATE INDEX "tasks_assigned_to_idx" ON "tasks"("assigned_to");

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_service_id_fkey" FOREIGN KEY ("project_service_id") REFERENCES "project_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

PRAGMA foreign_keys=ON;
