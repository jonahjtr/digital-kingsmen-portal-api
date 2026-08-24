-- GBP locations and posts for SEO clients (copy-paste workflow + Hermes MCP)

CREATE TABLE IF NOT EXISTS "gbp_locations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "google_business_url" TEXT,
    "formatted_address" TEXT,
    "is_primary" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "external_location_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "gbp_locations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "gbp_locations_company_id_idx" ON "gbp_locations"("company_id");

CREATE TABLE IF NOT EXISTS "gbp_posts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "company_id" TEXT NOT NULL,
    "post_code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "post_type" TEXT NOT NULL DEFAULT 'update',
    "topic" TEXT,
    "description" TEXT NOT NULL,
    "cta_type" TEXT,
    "cta_url" TEXT,
    "image_url" TEXT,
    "image_guidance" TEXT,
    "linked_content_url" TEXT,
    "notes" TEXT,
    "posted_at" DATETIME,
    "created_by_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "gbp_posts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "gbp_posts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "gbp_posts_company_id_post_code_key" ON "gbp_posts"("company_id", "post_code");
CREATE INDEX IF NOT EXISTS "gbp_posts_company_id_idx" ON "gbp_posts"("company_id");
CREATE INDEX IF NOT EXISTS "gbp_posts_status_idx" ON "gbp_posts"("status");
CREATE INDEX IF NOT EXISTS "gbp_posts_created_by_id_idx" ON "gbp_posts"("created_by_id");

CREATE TABLE IF NOT EXISTS "gbp_post_locations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "post_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    CONSTRAINT "gbp_post_locations_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "gbp_posts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "gbp_post_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "gbp_locations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "gbp_post_locations_post_id_location_id_key" ON "gbp_post_locations"("post_id", "location_id");
CREATE INDEX IF NOT EXISTS "gbp_post_locations_location_id_idx" ON "gbp_post_locations"("location_id");
