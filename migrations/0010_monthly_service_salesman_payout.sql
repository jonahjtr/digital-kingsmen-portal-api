-- Fixed monthly payout to the client's assigned salesman per recurring line

ALTER TABLE "company_monthly_services" ADD COLUMN "salesman_payout_cents" INTEGER;
