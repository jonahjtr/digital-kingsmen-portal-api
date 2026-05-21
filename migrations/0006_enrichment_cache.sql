-- Enrichment cache + logo source tracking
ALTER TABLE companies ADD COLUMN last_enrichment_website TEXT;
ALTER TABLE companies ADD COLUMN enrichment_snapshot TEXT;
ALTER TABLE companies ADD COLUMN logo_source_url TEXT;
