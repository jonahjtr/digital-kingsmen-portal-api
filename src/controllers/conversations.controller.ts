import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertCanAccessProject } from '../permissions/access';
import { messageInternalFilter } from '../permissions/filters';
import { mapMessageItem } from '../services/conversations.mapper';
import { broadcastConversation } from '../party/broadcast';
import { createNotification } from '../services/notification.service';
import {
  mapConversationWithUnread,
  markConversationRead as markConversationReadService,
} from '../services/conversation-read.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const user = req.user!;
    const conversations = await prisma.conversation.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: { where: { userId }, take: 1 },
        messages: { take: 1, orderBy: { createdAt: 'desc' } },
        project: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const filtered =
      user.role === 'client'
        ? conversations.filter((c) => c.type === 'client_project')
        : conversations;

    const mapped = await Promise.all(
      filtered.map((c) => {
        const member = c.members[0];
        return mapConversationWithUnread(
          {
            id: c.id,
            type: c.type,
            updatedAt: c.updatedAt,
            project: c.project,
            company: c.company,
            messages: c.messages,
          },
          user,
          member?.lastReadAt ?? null,
        );
      }),
    );

    return success(res, mapped);
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: getParam(req, 'id'),
        members: { some: { userId: req.user!.id } },
      },
      include: {
        members: { include: { user: { select: { id: true, fullName: true, email: true } } } },
        project: { select: { id: true, name: true } },
      },
    });
    if (!conversation) throw new AppError(ErrorCodes.NOT_FOUND, 'Conversation not found', 404);
    if (req.user!.role === 'client' && conversation.type !== 'client_project') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    return success(res, conversation);
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body;
    if (body.project_id) await assertCanAccessProject(req.user!, body.project_id);
    if (req.user!.role === 'client' && body.type !== 'client_project') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Clients can only create client project conversations', 403);
    }
    const memberIds = body.member_ids ?? [req.user!.id];
    if (!memberIds.includes(req.user!.id)) memberIds.push(req.user!.id);
    const conversation = await prisma.conversation.create({
      data: {
        projectId: body.project_id,
        companyId: body.company_id,
        type: body.type,
        members: {
          create: memberIds.map((userId: string) => ({ userId })),
        },
      },
      include: { members: true },
    });
    return created(res, conversation);
  } catch (err) {
    next(err);
  }
}

export async function listMessages(req: Request, res: Response, next: NextFunction) {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: getParam(req, 'id'), members: { some: { userId: req.user!.id } } },
    });
    if (!conversation) throw new AppError(ErrorCodes.NOT_FOUND, 'Conversation not found', 404);
    if (req.user!.role === 'client' && conversation.type !== 'client_project') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    const { page, limit, skip } = parsePagination(req.query, { maxLimit: 200 });
    const conversationId = getParam(req, 'id');
    const where = { conversationId, ...messageInternalFilter(req.user!) };
    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
        include: { sender: { select: { id: true, fullName: true, avatarUrl: true } } },
      }),
      prisma.message.count({ where }),
    ]);
    await prisma.message.updateMany({
      where: {
        conversationId,
        readAt: null,
        senderId: { not: req.user!.id },
        ...messageInternalFilter(req.user!),
      },
      data: { readAt: new Date() },
    });
    return success(res, messages.map(mapMessageItem), 200, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function sendMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: getParam(req, 'id'), members: { some: { userId: req.user!.id } } },
    });
    if (!conversation) throw new AppError(ErrorCodes.NOT_FOUND, 'Conversation not found', 404);
    if (req.user!.role === 'client' && conversation.type !== 'client_project') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    const body = req.body;
    let internalOnly = body.internal_only ?? false;
    if (req.user!.role === 'client') internalOnly = false;
    const conversationId = getParam(req, 'id');
    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId: req.user!.id,
        message: body.message,
        internalOnly,
      },
      include: { sender: { select: { id: true, fullName: true, avatarUrl: true } } },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
    await broadcastConversation(conversationId, {
      type: 'message.created',
      payload: message,
      tags: internalOnly ? ['staff'] : undefined,
    });

    const members = await prisma.conversationMember.findMany({
      where: { conversationId },
      include: { user: { select: { id: true, role: true } } },
    });
    const preview = body.message.slice(0, 120);
    const title = 'New message';
    await Promise.all(
      members
        .filter((m) => m.userId !== req.user!.id)
        .filter((m) => !(internalOnly && m.user.role === 'client'))
        .map((m) =>
          createNotification(m.userId, title, preview, 'message').catch(() => undefined),
        ),
    );

    return created(res, mapMessageItem(message));
  } catch (err) {
    next(err);
  }
}

export async function markConversationRead(req: Request, res: Response, next: NextFunction) {
  try {
    const conversationId = getParam(req, 'id');
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, members: { some: { userId: req.user!.id } } },
    });
    if (!conversation) throw new AppError(ErrorCodes.NOT_FOUND, 'Conversation not found', 404);
    if (req.user!.role === 'client' && conversation.type !== 'client_project') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }

    const messageId = req.body?.message_id as string | undefined;
    const lastReadAt = await markConversationReadService(conversationId, req.user!, messageId);

    return success(res, { conversationId, lastReadAt });
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_MEMBER') {
      next(new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403));
      return;
    }
    next(err);
  }
}

/** @deprecated Prefer PATCH /conversations/:id/read — global per-message read */
export async function markMessageRead(req: Request, res: Response, next: NextFunction) {
  try {
    const message = await prisma.message.findUnique({
      where: { id: getParam(req, 'id') },
      include: { conversation: { include: { members: true } } },
    });
    if (!message) throw new AppError(ErrorCodes.NOT_FOUND, 'Message not found', 404);
    const isMember = message.conversation.members.some((m) => m.userId === req.user!.id);
    if (!isMember) throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    const updated = await prisma.message.update({
      where: { id: getParam(req, 'id') },
      data: { readAt: new Date() },
    });
    await broadcastConversation(message.conversationId, {
      type: 'message.read',
      payload: updated,
    });
    return success(res, updated);
  } catch (err) {
    next(err);
  }
}
