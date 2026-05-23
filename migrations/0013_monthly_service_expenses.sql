-- Monthly service expenses (contractors, tools, ad spend passthrough, etc.)
CREATE TABLE "company_monthly_service_expenses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monthly_service_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "expense_type" TEXT NOT NULL DEFAULT 'contractor',
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "is_recurring" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "company_monthly_service_expenses_monthly_service_id_fkey" FOREIGN KEY ("monthly_service_id") REFERENCES "company_monthly_services" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "company_monthly_service_expenses_monthly_service_id_idx" ON "company_monthly_service_expenses"("monthly_service_id");
