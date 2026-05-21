-- Staff role tags (salesman, specialists) and per-client assignments

CREATE TABLE "staff_tags" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "singular" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "staff_tags_slug_key" ON "staff_tags"("slug");

CREATE TABLE "company_staff_assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "staff_tag_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "company_staff_assignments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "company_staff_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "company_staff_assignments_staff_tag_id_fkey" FOREIGN KEY ("staff_tag_id") REFERENCES "staff_tags" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "company_staff_assignments_company_id_user_id_staff_tag_id_key" ON "company_staff_assignments"("company_id", "user_id", "staff_tag_id");
CREATE INDEX "company_staff_assignments_company_id_idx" ON "company_staff_assignments"("company_id");
CREATE INDEX "company_staff_assignments_user_id_idx" ON "company_staff_assignments"("user_id");
CREATE INDEX "company_staff_assignments_staff_tag_id_idx" ON "company_staff_assignments"("staff_tag_id");

-- Default staff tags
INSERT INTO "staff_tags" ("id", "slug", "label", "description", "sort_order", "singular") VALUES
  ('tag-salesman', 'salesman', 'Salesman', 'Primary sales owner for this client', 10, 1),
  ('tag-project-manager', 'project_manager', 'Project manager', 'Overall delivery lead', 20, 1),
  ('tag-web-dev', 'web_dev', 'Web development', 'Website builds and updates', 30, 0),
  ('tag-software-dev', 'software_dev', 'Software development', 'Custom software and integrations', 40, 0),
  ('tag-seo', 'seo', 'SEO', 'Search optimization', 50, 0),
  ('tag-ads', 'ads', 'Paid ads', 'Google, Meta, and other ad platforms', 60, 0),
  ('tag-design', 'design', 'Design', 'Brand and creative', 70, 0),
  ('tag-content', 'content', 'Content', 'Copy and content production', 80, 0),
  ('tag-automation', 'automation', 'Automation', 'Workflows and technical automation', 90, 0);

-- Backfill from legacy company columns
INSERT INTO "company_staff_assignments" ("id", "company_id", "user_id", "staff_tag_id", "created_at", "updated_at")
SELECT
  "id" || '-staff-salesman',
  "id",
  "assigned_salesman_id",
  'tag-salesman',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "companies"
WHERE "assigned_salesman_id" IS NOT NULL;

INSERT INTO "company_staff_assignments" ("id", "company_id", "user_id", "staff_tag_id", "created_at", "updated_at")
SELECT
  "id" || '-staff-pm',
  "id",
  "assigned_project_manager_id",
  'tag-project-manager',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "companies"
WHERE "assigned_project_manager_id" IS NOT NULL;
