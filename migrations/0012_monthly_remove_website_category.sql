-- Website builds are projects, not monthly retainers

UPDATE "company_monthly_services"
SET "service_category" = 'website_maintenance'
WHERE "service_category" = 'website';
