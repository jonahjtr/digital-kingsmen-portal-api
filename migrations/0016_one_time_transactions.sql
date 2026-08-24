-- One-time client transactions and expenses
CREATE TABLE "company_one_time_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT,
    "salesman_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "recognized_at" DATETIME NOT NULL,
    "payment_status" TEXT NOT NULL DEFAULT 'unpaid',
    "salesman_payout_cents" INTEGER,
    "salesman_payout_override" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "company_one_time_transactions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "company_one_time_transactions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "company_one_time_transactions_salesman_id_fkey" FOREIGN KEY ("salesman_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "company_one_time_transactions_company_id_idx" ON "company_one_time_transactions"("company_id");
CREATE INDEX "company_one_time_transactions_project_id_idx" ON "company_one_time_transactions"("project_id");
CREATE INDEX "company_one_time_transactions_salesman_id_idx" ON "company_one_time_transactions"("salesman_id");
CREATE INDEX "company_one_time_transactions_recognized_at_idx" ON "company_one_time_transactions"("recognized_at");
CREATE INDEX "company_one_time_transactions_category_idx" ON "company_one_time_transactions"("category");

CREATE TABLE "company_one_time_transaction_expenses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transaction_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "expense_type" TEXT NOT NULL DEFAULT 'contractor',
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "spent_at" DATETIME,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "company_one_time_transaction_expenses_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "company_one_time_transactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "company_one_time_transaction_expenses_transaction_id_idx" ON "company_one_time_transaction_expenses"("transaction_id");

CREATE TABLE "business_recurring_expenses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "expense_type" TEXT NOT NULL DEFAULT 'other',
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "is_active" INTEGER NOT NULL DEFAULT 1,
    "service_category" TEXT,
    "started_at" DATETIME,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

CREATE INDEX "business_recurring_expenses_is_active_idx" ON "business_recurring_expenses"("is_active");
