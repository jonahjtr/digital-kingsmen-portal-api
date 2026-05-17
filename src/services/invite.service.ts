import type { Invite, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, ErrorCodes } from '../lib/errors';

export function isInviteValid(invite: Invite | null): invite is Invite {
  if (!invite) return false;
  if (invite.expiresAt < new Date()) return false;
  if (!invite.reusable && invite.usedAt) return false;
  return true;
}

export function inviteEmailMatches(invite: Invite, email: string): boolean {
  if (invite.reusable) return true;
  return invite.email.toLowerCase() === email.toLowerCase();
}

export async function consumeInvite(invite: Invite): Promise<void> {
  if (invite.reusable) return;
  await prisma.invite.update({
    where: { id: invite.id },
    data: { usedAt: new Date() },
  });
}

/** Long-lived tokens for onboarding — any email can register with the matching role. */
export const REGISTRATION_TOKEN_SPECS: Array<{
  token: string;
  role: UserRole;
  label: string;
}> = [
  { token: 'dk-register-client', role: 'client', label: 'Client' },
  { token: 'dk-register-employee', role: 'employee', label: 'Team member' },
  { token: 'dk-register-salesman', role: 'salesman', label: 'Sales' },
  { token: 'dk-register-admin', role: 'admin', label: 'Admin' },
];

export async function ensureRegistrationTokens(createdByUserId: string): Promise<void> {
  const expiresAt = new Date('2099-12-31T23:59:59.000Z');

  for (const spec of REGISTRATION_TOKEN_SPECS) {
    await prisma.invite.upsert({
      where: { token: spec.token },
      create: {
        token: spec.token,
        email: '*',
        role: spec.role,
        reusable: true,
        expiresAt,
        createdBy: createdByUserId,
      },
      update: {
        role: spec.role,
        reusable: true,
        expiresAt,
        usedAt: null,
      },
    });
  }
}

export async function listRegistrationTokens() {
  return prisma.invite.findMany({
    where: { reusable: true },
    orderBy: { role: 'asc' },
    select: {
      id: true,
      token: true,
      role: true,
      expiresAt: true,
      createdAt: true,
    },
  });
}

export async function getInviteByToken(token: string): Promise<Invite | null> {
  return prisma.invite.findUnique({ where: { token } });
}

export async function requireValidInvite(token: string): Promise<Invite> {
  const invite = await getInviteByToken(token);
  if (!isInviteValid(invite)) {
    throw new AppError(ErrorCodes.INVALID_INVITE, 'Invalid or expired invite token', 400);
  }
  return invite!;
}
