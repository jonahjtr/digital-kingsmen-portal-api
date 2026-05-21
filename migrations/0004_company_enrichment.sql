-- Company address, Google Business URL, and enrichment metadata
ALTER TABLE "companies" ADD COLUMN "google_business_url" TEXT;
ALTER TABLE "companies" ADD COLUMN "address_line1" TEXT;
ALTER TABLE "companies" ADD COLUMN "address_line2" TEXT;
ALTER TABLE "companies" ADD COLUMN "city" TEXT;
ALTER TABLE "companies" ADD COLUMN "state" TEXT;
ALTER TABLE "companies" ADD COLUMN "postal_code" TEXT;
ALTER TABLE "companies" ADD COLUMN "country" TEXT;
ALTER TABLE "companies" ADD COLUMN "formatted_address" TEXT;
ALTER TABLE "companies" ADD COLUMN "enrichment_source" TEXT;
ALTER TABLE "companies" ADD COLUMN "enriched_at" DATETIME;
