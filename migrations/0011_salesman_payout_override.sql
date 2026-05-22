-- Track whether salesman payout is a custom override vs default 30% split

ALTER TABLE "company_monthly_services" ADD COLUMN "salesman_payout_override" INTEGER NOT NULL DEFAULT 0;

-- Existing manual payouts: treat as custom override
UPDATE "company_monthly_services"
SET "salesman_payout_override" = 1
WHERE "salesman_payout_cents" IS NOT NULL;

-- Rows without payout: apply default 30% (override stays 0)
UPDATE "company_monthly_services"
SET "salesman_payout_cents" = CAST(ROUND("monthly_amount_cents" * 0.3) AS INTEGER)
WHERE "salesman_payout_cents" IS NULL;
