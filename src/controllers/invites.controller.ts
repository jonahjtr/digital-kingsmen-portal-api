import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { success, created } from '../lib/apiResponse';
import { assertRole } from '../permissions/access';
import { createInviteToken } from '../services/auth.service';
import { appBaseUrl, buildRegisterUrl, isEmailConfigured, sendInviteEmail } from '../services/email.service';
import { listRegistrationTokens } from '../services/invite.service';

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
        reusable: false,
        companyId: body.company_id ?? null,
        expiresAt,
        createdBy: req.user!.id,
      },
    });

    const sendEmail = body.send_email === true;
    let emailSent = false;
    let emailReason: string | undefined;

    if (sendEmail) {
      try {
        const result = await sendInviteEmail({
          to: invite.email,
          token: invite.token,
          role: invite.role,
          expiresAt: invite.expiresAt,
        });
        emailSent = result.sent;
        emailReason = result.reason;
      } catch (emailErr) {
        console.error('Invite email failed:', emailErr);
        emailReason = 'send_failed';
      }
    }

    const registerUrl = buildRegisterUrl(invite.token);

    return created(res, {
      id: invite.id,
      token: invite.token,
      email: invite.email,
      role: invite.role,
      company_id: invite.companyId,
      expires_at: invite.expiresAt,
      register_url: registerUrl,
      email_sent: emailSent,
      email_configured: isEmailConfigured(),
      email_reason: emailReason,
    });
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    const invites = await prisma.invite.findMany({
      where: { reusable: false },
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

export async function registrationTokens(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    const tokens = await listRegistrationTokens();
    return success(res, {
      email_configured: isEmailConfigured(),
      tokens: tokens.map((t) => ({
        ...t,
        register_url: buildRegisterUrl(t.token),
        label:
          t.role === 'client'
            ? 'Client'
            : t.role === 'employee'
              ? 'Team member'
              : t.role === 'salesman'
                ? 'Sales'
                : 'Admin',
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function emailStatus(req: Request, res: Response, next: NextFunction) {
  try {
    assertRole(req.user!, 'admin');
    return success(res, {
      configured: isEmailConfigured(),
      app_url: appBaseUrl(),
    });
  } catch (err) {
    next(err);
  }
}
