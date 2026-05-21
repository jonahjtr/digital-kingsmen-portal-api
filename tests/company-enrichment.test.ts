import { describe, expect, it } from 'vitest';
import { isBotChallengeHtml } from '../src/services/company-enrichment/botChallenge';
import { parseWebsiteHtml } from '../src/services/company-enrichment/parseWebsite';
import { rawToPreview } from '../src/services/company-enrichment/mergeEnrichment';

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>Acme HVAC | Heating and Cooling</title>
  <meta property="og:site_name" content="Acme HVAC" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "HVACBusiness",
    "name": "Acme HVAC Services",
    "telephone": "+1-555-123-4567",
    "email": "info@acmehvac.example",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "123 Main St",
      "addressLocality": "Dallas",
      "addressRegion": "TX",
      "postalCode": "75201",
      "addressCountry": "US"
    }
  }
  </script>
</head>
<body>
  <a href="mailto:sales@acmehvac.example">Email</a>
</body>
</html>
`;

describe('bot challenge detection', () => {
  it('detects Vercel/Cloudflare checking-your-browser pages', () => {
    const html = `<html><head><title>Checking your browser...</title></head>
      <body>Enable JavaScript and cookies to continue</body></html>`;
    expect(isBotChallengeHtml(html)).toBe(true);
  });

  it('does not flag normal business pages', () => {
    expect(isBotChallengeHtml(SAMPLE_HTML)).toBe(false);
  });
});

describe('company enrichment parser', () => {
  it('extracts business fields from JSON-LD', () => {
    const raw = parseWebsiteHtml(SAMPLE_HTML, 'https://acmehvac.example');
    const preview = rawToPreview(raw, []);
    expect(preview.name).toBe('Acme HVAC Services');
    expect(preview.industry).toBe('HVAC');
    expect(preview.city).toBe('Dallas');
    expect(preview.state).toBe('TX');
    expect(preview.field_confidence.name).toBe('high');
  });

  it('extracts logo from JSON-LD', () => {
    const html = `
      <html><head>
        <script type="application/ld+json">
        {"@type":"Organization","name":"Acme","logo":"https://acmehvac.example/assets/logo.png"}
        </script>
      </head></html>`;
    const preview = rawToPreview(parseWebsiteHtml(html, 'https://acmehvac.example'), []);
    expect(preview.suggested_logo_url).toBe('https://acmehvac.example/assets/logo.png');
    expect(preview.field_confidence.suggested_logo_url).toBe('high');
  });

  it('extracts apple-touch-icon with relative path', () => {
    const html = `<html><head>
      <link rel="apple-touch-icon" href="/icons/touch.png" />
    </head></html>`;
    const preview = rawToPreview(parseWebsiteHtml(html, 'https://acmehvac.example'), []);
    expect(preview.suggested_logo_url).toBe('https://acmehvac.example/icons/touch.png');
  });

  it('extracts Squarespace JSON-LD image on CDN host', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {"@type":"WebSite","name":"Pure Air","image":"//images.squarespace-cdn.com/content/v1/abc/logo.png"}
      </script>
      <img elementtiming="nbf-header-logo-desktop" src="//images.squarespace-cdn.com/content/v1/abc/logo.png?format=1500w" alt="Pure Air" />
    </head></html>`;
    const preview = rawToPreview(parseWebsiteHtml(html, 'https://www.pureheatingandair.com'), []);
    expect(preview.suggested_logo_url).toContain('images.squarespace-cdn.com');
    expect(preview.suggested_logo_url).toContain('logo.png');
  });

  it('prefers JSON-LD logo over og:image', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://acmehvac.example/hero.jpg" />
      <script type="application/ld+json">
      {"@type":"Organization","logo":{"@type":"ImageObject","url":"https://acmehvac.example/logo.webp"}}
      </script>
    </head></html>`;
    const preview = rawToPreview(parseWebsiteHtml(html, 'https://acmehvac.example'), []);
    expect(preview.suggested_logo_url).toBe('https://acmehvac.example/logo.webp');
  });
});
