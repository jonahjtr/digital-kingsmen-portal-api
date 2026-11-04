import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

/**
 * Security tests for the DK team MCP server (/mcp) and token admin (/api/mcp-tokens).
 * Needs a seeded DB (npm run db:seed). Every test is a "fails if security breaks" check.
 */
const app = createApp();
const ADMIN = { email: 'admin@digitalkingsmen.com', password: 'Demo123!' };
const EMPLOYEE = { email: 'employee@digitalkingsmen.com', password: 'Demo123!' };
const CLIENT = { email: 'client-pure@example.com', password: 'Demo123!' };

async function login(u: { email: string; password: string }) {
  const r = await request(app).post('/api/auth/login').send(u);
  return r.body?.data?.accessToken as string;
}
const call = (token: string | null, body: unknown) => {
  const r = request(app).post('/mcp').set('Content-Type', 'application/json');
  if (token) r.set('Authorization', `Bearer ${token}`);
  return r.send(JSON.stringify(body));
};
const tool = (token: string, name: string, args: unknown = {}) =>
  call(token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

describe('DK team MCP', () => {
  let adminJwt: string, employeeJwt: string;
  let adminUserId: string, employeeUserId: string, clientUserId: string;
  let adminRead: string, adminWrite: string, employeeRead: string;

  async function mint(jwt: string, user_id: string, scopes: string[], extra: object = {}) {
    const r = await request(app)
      .post('/api/mcp-tokens')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ user_id, name: 'test', scopes, ...extra });
    return r;
  }

  beforeAll(async () => {
    adminJwt = await login(ADMIN);
    employeeJwt = await login(EMPLOYEE);
    adminUserId = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } })).id;
    employeeUserId = (await prisma.user.findUniqueOrThrow({ where: { email: EMPLOYEE.email } })).id;
    clientUserId = (await prisma.user.findUniqueOrThrow({ where: { email: CLIENT.email } })).id;
    adminRead = (await mint(adminJwt, adminUserId, ['read'])).body.data.token;
    adminWrite = (await mint(adminJwt, adminUserId, ['read', 'write'])).body.data.token;
    employeeRead = (await mint(adminJwt, employeeUserId, ['read'])).body.data.token;
  });

  it('issues dkm_ tokens and stores only the hash', async () => {
    expect(adminRead).toMatch(/^dkm_[A-Za-z0-9_-]{43}$/);
    const rows = await prisma.mcpToken.findMany();
    for (const r of rows) {
      expect(r.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.tokenHash).not.toContain('dkm_');
    }
  });

  it('only admins (via JWT) can mint tokens', async () => {
    expect((await mint(employeeJwt, employeeUserId, ['read'])).status).toBe(403);
    // An MCP token is not a portal JWT, so it cannot mint more tokens.
    const r = await request(app).post('/api/mcp-tokens').set('Authorization', `Bearer ${adminWrite}`).send({ user_id: adminUserId, name: 'x' });
    expect(r.status).toBe(401);
    const list = await request(app).get('/api/mcp-tokens').set('Authorization', `Bearer ${adminJwt}`);
    expect(JSON.stringify(list.body)).not.toMatch(/dkm_[A-Za-z0-9_-]{20,}/); // raw tokens never listed
    expect(JSON.stringify(list.body)).not.toContain('tokenHash');
  });

  it('refuses to issue tokens to client users', async () => {
    expect((await mint(adminJwt, clientUserId, ['read'])).status).toBe(400);
  });

  it('rejects missing, malformed, unknown, and JWT bearer tokens with 401', async () => {
    const init = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    expect((await call(null, init)).status).toBe(401);
    expect((await call('nope', init)).status).toBe(401);
    expect((await call('dkm_' + 'A'.repeat(43), init)).status).toBe(401);
    expect((await call(adminJwt, init)).status).toBe(401);
  });

  it('initialize + tools/list work for a valid token', async () => {
    const r = await call(adminRead, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    expect(r.status).toBe(200);
    expect(r.body.result.serverInfo.name).toBe('dk-team');
    const l = await call(adminRead, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = l.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('get_revenue');
    expect(names).not.toContain('create_task'); // read-only token
  });

  it('hides admin-only money tools from non-admins and blocks direct calls', async () => {
    const l = await call(employeeRead, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const names = l.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).not.toContain('get_revenue');
    const r = await tool(employeeRead, 'get_revenue');
    expect(r.body.error?.message).toBe('Unknown tool');
  });

  it('read-only tokens cannot call write tools', async () => {
    const r = await tool(adminRead, 'create_task', { title: 'x' });
    expect(r.body.error?.message).toBe('Unknown tool');
  });

  it('write token can create an internal task, never client-visible', async () => {
    const r = await tool(adminWrite, 'create_task', { title: 'MCP test task' });
    const t = JSON.parse(r.body.result.content[0].text);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.clientVisible).toBe(false);
    await prisma.task.delete({ where: { id: t.id } });
  });

  it('rejects unknown/extra arguments (strict schemas)', async () => {
    const r = await tool(adminRead, 'list_clients', { search: 'a', evil: 1 });
    expect(r.body.result.isError).toBe(true);
  });

  it('employee cannot read a company outside their scope (same message as missing)', async () => {
    const all = await prisma.company.findMany({ select: { id: true } });
    const visible = JSON.parse((await tool(employeeRead, 'list_clients')).body.result.content[0].text).map((c: { id: string }) => c.id);
    const hidden = all.find((c) => !visible.includes(c.id));
    if (!hidden) return; // seed gave employee access to everything
    const r = await tool(employeeRead, 'get_client', { company_id: hidden.id });
    expect(r.body.result.isError).toBe(true);
    expect(r.body.result.content[0].text).toBe('Company not found');
  });

  it('never leaks secrets or storage keys in any read tool output', async () => {
    const c = await prisma.company.findFirstOrThrow();
    for (const [name, args] of [
      ['whoami', {}],
      ['list_clients', {}],
      ['get_client', { company_id: c.id }],
      ['list_team', {}],
      ['list_tasks', {}],
    ] as const) {
      const text = (await tool(adminRead, name, args)).body.result.content[0].text as string;
      expect(text).not.toMatch(/passwordHash|password_hash|tokenHash|logoUrl|\$2[aby]\$/);
    }
  });

  it('revoked and expired tokens stop working immediately', async () => {
    const minted = (await mint(adminJwt, adminUserId, ['read'])).body.data;
    expect((await tool(minted.token, 'whoami')).status).toBe(200);
    await request(app).delete(`/api/mcp-tokens/${minted.id}`).set('Authorization', `Bearer ${adminJwt}`);
    expect((await tool(minted.token, 'whoami')).status).toBe(401);

    const exp = (await mint(adminJwt, adminUserId, ['read'])).body.data;
    await prisma.mcpToken.update({ where: { id: exp.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await tool(exp.token, 'whoami')).status).toBe(401);
  });

  it('deactivated staff lose access even with a live token', async () => {
    await prisma.user.update({ where: { id: employeeUserId }, data: { isActive: false } });
    try {
      expect((await tool(employeeRead, 'whoami')).status).toBe(401);
    } finally {
      await prisma.user.update({ where: { id: employeeUserId }, data: { isActive: true } });
    }
  });

  it('audits every call', async () => {
    const before = await prisma.mcpAuditLog.count();
    await tool(adminRead, 'whoami');
    await tool(adminRead, 'get_revenue');
    expect(await prisma.mcpAuditLog.count()).toBe(before + 2);
  });
});
