import crypto from 'crypto';
import { User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { hashPassword, comparePassword } from '../lib/password';
import { signToken, getExpiresInSeconds } from '../lib/jwt';
import { sanitizeUser } from '../lib/sanitize';
import { AppError, ErrorCodes } from '../lib/errors';

export async function register(data: {
  email: string;
  password: string;
  full_name: string;
  invite_token: string;
}) {
  const invite = await prisma.invite.findUnique({
    where: { token: data.invite_token },
  });

  if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
    throw new AppError(ErrorCodes.INVALID_INVITE, 'Invalid or expired invite token', 400);
  }

  if (invite.email.toLowerCase() !== data.email.toLowerCase()) {
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

  await prisma.invite.update({
    where: { id: invite.id },
    data: { usedAt: new Date() },
  });

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
  return crypto.randomBytes(32).toString('hex');
}
