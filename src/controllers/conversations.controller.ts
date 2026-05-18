import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertCanAccessProject, assertNotClient } from '../permissions/access';
import { messageInternalFilter } from '../permissions/filters';
import { mapConversationListItem, mapMessageItem } from '../services/conversations.mapper';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const unreadWhere = {
      readAt: null,
      senderId: { not: userId },
      ...messageInternalFilter(req.user!),
    };
    const conversations = await prisma.conversation.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: { include: { user: { select: { id: true, fullName: true } } } },
        messages: { take: 1, orderBy: { createdAt: 'desc' } },
        project: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
        _count: { select: { messages: { where: unreadWhere } } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const filtered =
      req.user!.role === 'client'
        ? conversations.filter((c) => c.type === 'client_project')
        : conversations;
    return success(res, filtered.map(mapConversationListItem));
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
    const message = await prisma.message.create({
      data: {
        conversationId: getParam(req, 'id'),
        senderId: req.user!.id,
        message: body.message,
        internalOnly,
      },
      include: { sender: { select: { id: true, fullName: true, avatarUrl: true } } },
    });
    await prisma.conversation.update({
      where: { id: getParam(req, 'id') },
      data: { updatedAt: new Date() },
    });
    return created(res, mapMessageItem(message));
  } catch (err) {
    next(err);
  }
}

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
    return success(res, updated);
  } catch (err) {
    next(err);
  }
}
