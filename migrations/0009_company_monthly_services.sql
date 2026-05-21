-- Recurring monthly services per client (billing separate from setup projects)

CREATE TABLE "company_monthly_services" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "company_id" TEXT NOT NULL,
    "service_category" TEXT NOT NULL,
    "label" TEXT,
    "monthly_amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'active',
    "description" TEXT,
    "started_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "company_monthly_services_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "company_monthly_services_company_id_idx" ON "company_monthly_services"("company_id");
CREATE INDEX "company_monthly_services_service_category_idx" ON "company_monthly_services"("service_category");
CREATE INDEX "company_monthly_services_status_idx" ON "company_monthly_services"("status");
