import crypto from 'crypto';
import type { User } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const TOKEN_PREFIX = 'dkm_';

export type McpScope = 'read' | 'write';

export interface McpPrincipal {
  user: User;
  tokenId: string;
  scopes: Set<McpScope>;
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** 32 random bytes → `dkm_<43 base64url chars>`. Only the hash is stored. */
export function generateToken(): { raw: string; hash: string; prefix: string } {
  const raw = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw), prefix: raw.slice(0, 10) };
}

/**
 * Resolve a bearer token to an active internal staff user.
 * Rejects: malformed, unknown, revoked, expired, inactive user, client-role user.
 * Returns null on any failure (callers send one generic 401 — no oracle).
 */
export async function resolveMcpToken(authHeader: string | undefined): Promise<McpPrincipal | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const raw = authHeader.slice(7).trim();
  if (!raw.startsWith(TOKEN_PREFIX) || raw.length < 40 || raw.length > 100) return null;

  const token = await prisma.mcpToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: true },
  });
  if (!token || token.revokedAt) return null;
  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) return null;
  if (!token.user.isActive || token.user.role === 'client') return null;

  // Best-effort; never block the call on this write.
  prisma.mcpToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  const scopes = new Set(
    token.scopes
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is McpScope => s === 'read' || s === 'write'),
  );
  return { user: token.user, tokenId: token.id, scopes };
}

/** Per-token rate limit backed by the audit log (works across Worker isolates). */
export async function isRateLimited(tokenId: string, perMinute = 60): Promise<boolean> {
  const since = new Date(Date.now() - 60_000);
  const n = await prisma.mcpAuditLog.count({ where: { tokenId, createdAt: { gte: since } } });
  return n >= perMinute;
}

/** Audit every tool call. Args are truncated and long free-text values are elided. */
export async function audit(
  p: McpPrincipal,
  tool: string,
  args: unknown,
  ok: boolean,
  err?: string,
): Promise<void> {
  let argStr: string | null = null;
  try {
    argStr = JSON.stringify(args ?? {}, (_k, v) =>
      typeof v === 'string' && v.length > 120 ? `${v.slice(0, 120)}…(${v.length})` : v,
    ).slice(0, 1000);
  } catch {
    argStr = null;
  }
  await prisma.mcpAuditLog
    .create({
      data: {
        tokenId: p.tokenId,
        userId: p.user.id,
        tool,
        args: argStr,
        ok,
        error: err ? err.slice(0, 300) : null,
      },
    })
    .catch(() => undefined);
}
