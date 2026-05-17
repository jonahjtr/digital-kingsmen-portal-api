import { User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { hashPassword, comparePassword } from '../lib/password';
import { signToken, getExpiresInSeconds } from '../lib/jwt';
import { sanitizeUser } from '../lib/sanitize';
import { AppError, ErrorCodes } from '../lib/errors';
import {
  consumeInvite,
  inviteEmailMatches,
  requireValidInvite,
} from './invite.service';

export async function register(data: {
  email: string;
  password: string;
  full_name: string;
  invite_token: string;
}) {
  const invite = await requireValidInvite(data.invite_token.trim());

  if (!inviteEmailMatches(invite, data.email)) {
    throw new AppError(ErrorCodes.INVALID_INVITE, 'Email does not match invite', 400);
  }

  const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (existing) {
    throw new AppError(ErrorCodes.CONFLICT, 'User already exists', 409);
  }

  const passwordHash = await hashPassword(data.password);
  const user = await prisma.user.create({
    data: {
      email: data.email.toLowerCase(),
      passwordHash,
      fullName: data.full_name,
      role: invite.role,
    },
  });

  if (invite.companyId && invite.role === 'client') {
    await prisma.companyUser.create({
      data: {
        companyId: invite.companyId,
        userId: user.id,
        relationshipType: 'primary_contact',
      },
    });
  }

  await consumeInvite(invite);

  const token = signToken({ sub: user.id, email: user.email, role: user.role });
  return {
    accessToken: token,
    expiresIn: getExpiresInSeconds(),
    user: sanitizeUser(user),
  };
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user || !user.isActive) {
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 'Invalid email or password', 401);
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 'Invalid email or password', 401);
  }

  const token = signToken({ sub: user.id, email: user.email, role: user.role });
  return {
    accessToken: token,
    expiresIn: getExpiresInSeconds(),
    user: sanitizeUser(user),
  };
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      companyUsers: {
        include: { company: { select: { id: true, name: true } } },
      },
    },
  });
  if (!user) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);
  }
  const { passwordHash: _, ...safe } = user;
  return safe;
}

export function createInviteToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
