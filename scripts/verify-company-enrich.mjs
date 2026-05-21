/**
 * Verifies POST /companies/enrich-preview on deployed API.
 */
const API_BASE =
  process.argv[2]?.replace(/\/$/, '') ??
  'https://digital-kingsmen-portal-api.auto-cca.workers.dev';

const TEST_SITES = [
  'https://www.cloudflare.com',
  'https://schema.org/docs/gs.html',
];

async function login() {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@digitalkingsmen.com',
      password: 'Demo123!',
    }),
  });
  const json = await res.json();
  if (!json.success) throw new Error('Login failed');
  return json.data.accessToken;
}

async function enrich(token, website) {
  const res = await fetch(`${API_BASE}/api/companies/enrich-preview`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ website }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function main() {
  const token = await login();
  console.log('login ok\n');
  for (const site of TEST_SITES) {
    const { status, json } = await enrich(token, site);
    console.log('---', site, 'HTTP', status);
    if (!json.success) {
      console.log('FAIL', json);
      continue;
    }
    const d = json.data;
    const fields = Object.keys(d.field_confidence ?? {});
    console.log('fields:', fields.join(', ') || '(none)');
    if (d.name) console.log('  name:', d.name);
    if (d.warnings?.length) console.log('  warnings:', d.warnings.join('; '));
  }
  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
