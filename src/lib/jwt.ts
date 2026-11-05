import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  /** Set when an admin is viewing the portal as this user ("view as"). Admin's user id. */
  imp?: string;
}

export const SESSION_JWT_EXPIRES_IN = '24h';

export function signToken(payload: JwtPayload, expiresIn = env.JWT_EXPIRES_IN): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

export function getExpiresInSeconds(expiresIn = env.JWT_EXPIRES_IN): number {
  const match = expiresIn.match(/^(\d+)([dhms])$/);
  if (!match) return 7 * 24 * 60 * 60;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (multipliers[unit] ?? 86400);
}
