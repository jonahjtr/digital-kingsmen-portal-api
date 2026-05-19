/**
 * Verifies internal_only messages are not broadcast to client-tagged WS connections.
 */
const API_BASE =
  process.argv[2]?.replace(/\/$/, '') ??
  'https://digital-kingsmen-portal-api.auto-cca.workers.dev';
const WS_BASE = API_BASE.replace(/^http/, 'ws');

async function login(email, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(`Login failed for ${email}: ${JSON.stringify(json)}`);
  return { token: json.data.accessToken, user: json.data.user };
}

async function findClientProjectConv(token) {
  const res = await fetch(`${API_BASE}/api/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  const conv = json.data?.find((c) => c.type === 'client_project');
  if (!conv) throw new Error('No client_project conversation found');
  return conv.id;
}

function openWs(url) {
  const ws = new WebSocket(url);
  return new Promise((resolve, reject) => {
    const messages = [];
    ws.addEventListener('message', (e) => messages.push(String(e.data)));
    ws.addEventListener('open', () => resolve({ ws, messages }), { once: true });
    ws.addEventListener('error', reject, { once: true });
    setTimeout(() => reject(new Error('WS open timeout')), 5000);
  });
}

async function main() {
  const staff = await login('pm@digitalkingsmen.com', 'Demo123!');
  const client = await login('client-pure@example.com', 'Demo123!');
  const convId = await findClientProjectConv(client.token);
  console.log('client_project conversation:', convId);

  const staffSock = await openWs(
    `${WS_BASE}/parties/conversation-server/${convId}?token=${encodeURIComponent(staff.token)}`,
  );
  const clientSock = await openWs(
    `${WS_BASE}/parties/conversation-server/${convId}?token=${encodeURIComponent(client.token)}`,
  );
  console.log('both websockets connected');

  const text = `internal-verify-${Date.now()}`;
  const res = await fetch(`${API_BASE}/api/conversations/${convId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${staff.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: text, internal_only: true }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(`POST failed: ${JSON.stringify(json)}`);

  await new Promise((r) => setTimeout(r, 1500));

  const staffGot = staffSock.messages.some((m) => {
    try {
      const e = JSON.parse(m);
      return e.type === 'message.created' && e.payload?.message === text;
    } catch {
      return false;
    }
  });
  const clientGot = clientSock.messages.some((m) => {
    try {
      const e = JSON.parse(m);
      return e.type === 'message.created' && e.payload?.message === text;
    } catch {
      return false;
    }
  });

  staffSock.ws.close();
  clientSock.ws.close();

  if (!staffGot) throw new Error('Staff did not receive internal message.created');
  if (clientGot) throw new Error('Client incorrectly received internal message.created');

  console.log('staff received internal broadcast: yes');
  console.log('client received internal broadcast: no (correct)');
  console.log('\nInternal broadcast check passed.');
}

main().catch((e) => {
  console.error('\nFAILED:', e.message || e);
  process.exit(1);
});
