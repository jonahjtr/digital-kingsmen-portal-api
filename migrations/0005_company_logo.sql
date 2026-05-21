-- Company logo (R2 storage key + mime type)
ALTER TABLE "companies" ADD COLUMN "logo_url" TEXT;
ALTER TABLE "companies" ADD COLUMN "logo_mime_type" TEXT;
