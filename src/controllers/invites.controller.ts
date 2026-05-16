import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created } from '../lib/apiResponse';
import { assertRole } from '../permissions/access';
import { createInviteToken } from '../services/auth.service';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    const body = req.body;
    const expiresInDays = body.expires_in_days ?? 7;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    const token = createInviteToken();
    const invite = await prisma.invite.create({
      data: {
        token,
        email: body.email.toLowerCase(),
        role: body.role,
        companyId: body.company_id,
        expiresAt,
        createdBy: req.user!.id,
      },
    });
    return created(res, {
      id: invite.id,
      token: invite.token,
      email: invite.email,
      role: invite.role,
      company_id: invite.companyId,
      expires_at: invite.expiresAt,
    });
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    const invites = await prisma.invite.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        email: true,
        role: true,
        companyId: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
      },
    });
    return success(res, invites);
  } catch (err) {
    next(err);
  }
}
