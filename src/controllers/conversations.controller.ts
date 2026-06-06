import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertCanAccessProject } from '../permissions/access';
import { messageInternalFilter } from '../permissions/filters';
import { broadcastConversation } from '../party/broadcast';
import { createNotification, notifyUsers } from '../services/notification.service';
import {
  buildMentionCreates,
  mapMessageWithMentions,
  messageWithMentionsInclude,
  resolveMentionedUserIds,
} from '../services/message-mentions.service';
import {
  mapConversationWithUnread,
  markConversationRead as markConversationReadService,
} from '../services/conversation-read.service';
import {
  ensureConversationMembers,
  ensureProjectConversation,
  resolveDefaultMemberIds,
} from '../services/conversation-members.service';

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

    const projectIds = [
      ...new Set(
        conversations
          .map((c) => c.projectId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    await Promise.all(projectIds.map((projectId) => ensureProjectConversation(projectId)));

    const refreshed = await prisma.conversation.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: { where: { userId }, take: 1 },
        messages: { take: 1, orderBy: { createdAt: 'desc' } },
        project: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const filtered = refreshed.filter((c) => {
      if (user.role === 'client') {
        return c.type === 'client_project';
      }
      return c.type !== 'internal_project';
    });

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

export async function getForProject(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = getParam(req, 'projectId');
    await assertCanAccessProject(req.user!, projectId);
    const { id } = await ensureProjectConversation(projectId);

    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
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

    if (
      body.project_id &&
      (body.type === 'client_project' || body.type === 'internal_project')
    ) {
      const { id } = await ensureProjectConversation(body.project_id);
      const conversation = await prisma.conversation.findUnique({
        where: { id },
        include: { members: true },
      });
      return created(res, conversation);
    }

    const memberIds = await resolveDefaultMemberIds({
      type: body.type,
      projectId: body.project_id,
      companyId: body.company_id,
      creatorId: req.user!.id,
      explicitMemberIds: body.member_ids,
    });
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
        include: messageWithMentionsInclude,
      }),
      prisma.message.count({ where }),
    ]);
    return success(res, messages.map(mapMessageWithMentions), 200, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function sendMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const conversationId = getParam(req, 'id');
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, members: { some: { userId: req.user!.id } } },
      include: {
        members: { include: { user: { select: { id: true, role: true, fullName: true } } } },
      },
    });
    if (!conversation) throw new AppError(ErrorCodes.NOT_FOUND, 'Conversation not found', 404);
    if (req.user!.role === 'client' && conversation.type !== 'client_project') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }

    await ensureConversationMembers(conversationId, [req.user!.id]);

    const refreshed = await prisma.conversation.findFirst({
      where: { id: conversationId, members: { some: { userId: req.user!.id } } },
      include: {
        members: { include: { user: { select: { id: true, role: true, fullName: true } } } },
      },
    });
    if (!refreshed) throw new AppError(ErrorCodes.NOT_FOUND, 'Conversation not found', 404);

    const body = req.body;
    let internalOnly = body.internal_only ?? false;
    if (req.user!.role === 'client') internalOnly = false;

    const mentionedUserIds = resolveMentionedUserIds(
      body.mentioned_user_ids,
      refreshed.members,
      req.user!.id,
      internalOnly,
    );
    const mentionCreates = buildMentionCreates(mentionedUserIds);

    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId: req.user!.id,
        message: body.message,
        internalOnly,
        mentions: mentionCreates.length
          ? { create: mentionCreates }
          : undefined,
      },
      include: messageWithMentionsInclude,
    });
    const mapped = mapMessageWithMentions(message);

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
    await broadcastConversation(conversationId, {
      type: 'message.created',
      payload: mapped,
      tags: internalOnly ? ['staff'] : undefined,
    });

    const preview = body.message.slice(0, 120);
    const senderName = req.user!.fullName ?? 'Someone';
    await Promise.all(
      refreshed.members
        .filter((m) => m.userId !== req.user!.id)
        .filter((m) => !(internalOnly && m.user.role === 'client'))
        .filter((m) => !mentionedUserIds.includes(m.userId))
        .map((m) =>
          createNotification(m.userId, 'New message', preview, 'message').catch(() => undefined),
        ),
    );

    if (mentionedUserIds.length > 0) {
      await notifyUsers(
        mentionedUserIds,
        'You were mentioned',
        `${senderName}: ${preview}`,
        'mention',
      );
    }

    return created(res, mapped);
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
