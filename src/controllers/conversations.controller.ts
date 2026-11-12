import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertCanAccessProject } from '../permissions/access';
import { messageInternalFilter } from '../permissions/filters';
import { broadcastConversation } from '../party/broadcast';
import { getStorageProvider } from '../storage';
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
  listDirectCandidates,
  openDirectConversation,
} from '../services/conversation-members.service';
import { clientCanSee } from '../services/conversation-read.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.id;
    const user = req.user!;
    const conversations = await prisma.conversation.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: { where: { userId }, take: 1 },
        messages: { where: messageInternalFilter(user), take: 1, orderBy: { createdAt: 'desc' }, include: { attachment: { select: { fileType: true } } } },
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
        messages: { where: messageInternalFilter(user), take: 1, orderBy: { createdAt: 'desc' }, include: { attachment: { select: { fileType: true } } } },
        project: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const filtered = refreshed.filter((c) => {
      if (user.role === 'client') {
        return clientCanSee(c.type);
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

export async function directCandidates(req: Request, res: Response, next: NextFunction) {
  try {
    return success(res, await listDirectCandidates(req.user!));
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
        members: { include: { user: { select: { id: true, fullName: true, email: true, role: true, avatarUrl: true } } } },
        project: { select: { id: true, name: true } },
      },
    });
    if (!conversation) throw new AppError(ErrorCodes.NOT_FOUND, 'Conversation not found', 404);
    if (req.user!.role === 'client' && !clientCanSee(conversation.type)) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    // Clients must not learn staff emails; staff see everything.
    if (req.user!.role === 'client') {
      for (const m of conversation.members) (m.user as { email?: string }).email = undefined;
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
    if (req.user!.role === 'client' && !clientCanSee(conversation.type)) {
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
    if (body.type === 'direct') return created(res, await openDirectConversation(req.user!, body.member_ids));
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
    if (req.user!.role === 'client' && !clientCanSee(conversation.type)) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    const conversationId = getParam(req, 'id');
    const baseWhere = { conversationId, ...messageInternalFilter(req.user!) };

    // Cursor mode (messaging UI): newest `limit` messages before `before` (ISO or message id),
    // returned oldest→newest, with hasMore for "load older".
    if (req.query.before !== undefined || req.query.cursor === 'latest') {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
      let beforeDate: Date | undefined;
      const before = typeof req.query.before === 'string' ? req.query.before : undefined;
      if (before) {
        const ref = /^[0-9a-f-]{36}$/i.test(before)
          ? await prisma.message.findFirst({ where: { id: before, conversationId }, select: { createdAt: true } })
          : null;
        beforeDate = ref?.createdAt ?? (Number.isNaN(Date.parse(before)) ? undefined : new Date(before));
      }
      const rows = await prisma.message.findMany({
        where: { ...baseWhere, ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}) },
        take: limit + 1,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: messageWithMentionsInclude,
      });
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit).reverse().map(mapMessageWithMentions);
      return success(res, page, 200, { hasMore });
    }

    const { page, limit, skip } = parsePagination(req.query, { maxLimit: 200 });
    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: baseWhere,
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
        include: messageWithMentionsInclude,
      }),
      prisma.message.count({ where: baseWhere }),
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
    if (req.user!.role === 'client' && !clientCanSee(conversation.type)) {
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

    let attachmentFileId: string | undefined;
    let isVoice = false;
    if (body.attachment_file_id) {
      // Only your own upload, and only one that isn't already attached elsewhere.
      const file = await prisma.file.findFirst({
        where: { id: body.attachment_file_id, uploadedBy: req.user!.id, messages: { none: {} } },
        select: { id: true, fileType: true },
      });
      if (!file) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Attachment not found', 400);
      attachmentFileId = file.id;
      isVoice = /^audio\//i.test(file.fileType ?? '');
    }
    const text = typeof body.message === 'string' ? body.message : '';
    if (!text.trim() && !attachmentFileId) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Message is empty', 400);
    }

    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId: req.user!.id,
        message: text,
        internalOnly,
        attachmentFileId,
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

    const preview = (text || (isVoice ? '🎤 Voice memo' : '📎 Attachment')).slice(0, 120);
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
    if (req.user!.role === 'client' && !clientCanSee(conversation.type)) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }

    const messageId = req.body?.message_id as string | undefined;
    const lastReadAt = await markConversationReadService(conversationId, req.user!, messageId);
    await broadcastConversation(conversationId, {
      type: 'conversation.read',
      payload: { userId: req.user!.id, lastReadAt },
    });

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


async function loadOwnMessageForMutation(req: Request) {
  const message = await prisma.message.findFirst({
    where: {
      id: getParam(req, 'id'),
      conversation: { members: { some: { userId: req.user!.id } } },
      ...messageInternalFilter(req.user!),
    },
    select: { id: true, senderId: true, conversationId: true, internalOnly: true, deletedAt: true, createdAt: true },
  });
  if (!message || message.deletedAt) throw new AppError(ErrorCodes.NOT_FOUND, 'Message not found', 404);
  return message;
}

async function broadcastMessageUpdate(conversationId: string, messageId: string, internalOnly: boolean) {
  const full = await prisma.message.findUnique({ where: { id: messageId }, include: messageWithMentionsInclude });
  if (!full) return;
  await broadcastConversation(conversationId, {
    type: 'message.updated',
    payload: mapMessageWithMentions(full),
    tags: internalOnly ? ['staff'] : undefined,
  });
  return mapMessageWithMentions(full);
}

/** Edit your own message (text only). */
export async function editMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const msg = await loadOwnMessageForMutation(req);
    if (msg.senderId !== req.user!.id) throw new AppError(ErrorCodes.FORBIDDEN, 'You can only edit your own messages', 403);
    const current = await prisma.message.findUniqueOrThrow({ where: { id: msg.id }, select: { message: true } });
    if (current.message === req.body.message) {
      return success(res, await broadcastMessageUpdate(msg.conversationId, msg.id, msg.internalOnly));
    }
    // Keep every prior version so anyone in the thread can see what it said before.
    await prisma.$transaction([
      prisma.messageEdit.create({ data: { messageId: msg.id, previousMessage: current.message } }),
      prisma.message.update({ where: { id: msg.id }, data: { message: req.body.message, editedAt: new Date() } }),
    ]);
    const mapped = await broadcastMessageUpdate(msg.conversationId, msg.id, msg.internalOnly);
    return success(res, mapped);
  } catch (err) {
    next(err);
  }
}

/** Edit history (oldest first) + the current text. Same visibility as the message itself. */
export async function listMessageEdits(req: Request, res: Response, next: NextFunction) {
  try {
    const msg = await loadOwnMessageForMutation(req);
    const [edits, current] = await Promise.all([
      prisma.messageEdit.findMany({ where: { messageId: msg.id }, orderBy: { editedAt: 'asc' } }),
      prisma.message.findUniqueOrThrow({ where: { id: msg.id }, select: { message: true, editedAt: true } }),
    ]);
    return success(res, {
      original: edits[0]?.previousMessage ?? current.message,
      versions: [
        ...edits.map((e, i) => ({ text: e.previousMessage, at: i === 0 ? msg.createdAt : edits[i - 1].editedAt })),
        { text: current.message, at: edits.at(-1)?.editedAt ?? msg.createdAt, current: true },
      ],
    });
  } catch (err) {
    next(err);
  }
}

/** ADMIN ONLY: what a deleted message said (every version, last = text at deletion) + its attachment. */
export async function getDeletedMessage(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user!.role !== 'admin') throw new AppError(ErrorCodes.NOT_FOUND, 'Message not found', 404);
    const msg = await prisma.message.findFirst({
      where: {
        id: getParam(req, 'id'),
        deletedAt: { not: null },
        conversation: { members: { some: { userId: req.user!.id } } },
      },
      select: {
        createdAt: true,
        deletedAt: true,
        sender: { select: { fullName: true } },
        attachment: { select: { id: true, fileName: true, fileType: true, fileSize: true } },
        edits: { orderBy: { editedAt: 'asc' }, select: { previousMessage: true, editedAt: true } },
      },
    });
    if (!msg) throw new AppError(ErrorCodes.NOT_FOUND, 'Message not found', 404);
    return success(res, {
      sender: msg.sender.fullName,
      deletedAt: msg.deletedAt,
      attachment: msg.attachment,
      versions: msg.edits.map((e, i) => ({
        text: e.previousMessage,
        at: i === 0 ? msg.createdAt : msg.edits[i - 1].editedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/** Delete (soft) your own message; admins can delete anyone's. Leaves a "deleted" placeholder. */
export async function deleteMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const msg = await loadOwnMessageForMutation(req);
    if (msg.senderId !== req.user!.id && req.user!.role !== 'admin') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'You can only delete your own messages', 403);
    }
    const current = await prisma.message.findUniqueOrThrow({ where: { id: msg.id }, select: { message: true } });
    // Blank the live text (nobody sees it in the thread), but archive the final text as the last
    // version so admins can review what was deleted. Edit history is kept for the same reason.
    await prisma.$transaction([
      prisma.messageEdit.create({ data: { messageId: msg.id, previousMessage: current.message } }),
      prisma.message.update({ where: { id: msg.id }, data: { deletedAt: new Date(), message: '' } }),
      prisma.messageReaction.deleteMany({ where: { messageId: msg.id } }),
      prisma.messageMention.deleteMany({ where: { messageId: msg.id } }),
    ]);
    const mapped = await broadcastMessageUpdate(msg.conversationId, msg.id, msg.internalOnly);
    return success(res, mapped);
  } catch (err) {
    next(err);
  }
}

/** Toggle an emoji reaction for the current user. */
export async function toggleReaction(req: Request, res: Response, next: NextFunction) {
  try {
    const msg = await loadOwnMessageForMutation(req);
    const emoji = String(req.body.emoji);
    const key = { messageId_userId_emoji: { messageId: msg.id, userId: req.user!.id, emoji } };
    const existing = await prisma.messageReaction.findUnique({ where: key });
    if (existing) {
      await prisma.messageReaction.delete({ where: { id: existing.id } });
    } else {
      const distinct = await prisma.messageReaction.findMany({
        where: { messageId: msg.id },
        distinct: ['emoji'],
        select: { emoji: true },
      });
      if (distinct.length >= 20) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Too many reactions', 400);
      await prisma.messageReaction.create({ data: { messageId: msg.id, userId: req.user!.id, emoji } });
    }
    const mapped = await broadcastMessageUpdate(msg.conversationId, msg.id, msg.internalOnly);
    return success(res, mapped);
  } catch (err) {
    next(err);
  }
}

/** Ephemeral "is typing" relay. Not stored. */
export async function typing(req: Request, res: Response, next: NextFunction) {
  try {
    const conversationId = getParam(req, 'id');
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, members: { some: { userId: req.user!.id } } },
      select: { type: true },
    });
    if (!conversation) throw new AppError(ErrorCodes.NOT_FOUND, 'Conversation not found', 404);
    if (req.user!.role === 'client' && !clientCanSee(conversation.type)) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    // Staff typing a team-only note must not show up for the client.
    const internal = req.user!.role !== 'client' && req.body?.internal_only === true;
    await broadcastConversation(conversationId, {
      type: 'typing',
      payload: { userId: req.user!.id, fullName: req.user!.fullName },
      tags: internal ? ['staff'] : undefined,
    });
    return success(res, { ok: true });
  } catch (err) {
    next(err);
  }
}

/** Download a message attachment. Access = can see the message (member + team-only rules). */
export async function messageAttachment(req: Request, res: Response, next: NextFunction) {
  try {
    const msg = await prisma.message.findFirst({
      where: {
        id: getParam(req, 'id'),
        // Deleted attachments stay reviewable by admins only.
        ...(req.user!.role === 'admin' ? {} : { deletedAt: null }),
        conversation: { members: { some: { userId: req.user!.id } } },
        ...messageInternalFilter(req.user!),
      },
      select: { conversation: { select: { type: true } }, attachment: true },
    });
    if (!msg?.attachment) throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment not found', 404);
    if (req.user!.role === 'client' && !clientCanSee(msg.conversation.type)) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment not found', 404);
    }
    const storage = getStorageProvider();
    const object = storage.get ? await storage.get(msg.attachment.fileUrl) : null;
    if (!object) throw new AppError(ErrorCodes.NOT_FOUND, 'Attachment not found', 404);
    const type = (object.mimeType || msg.attachment.fileType || 'application/octet-stream').split(';')[0].trim();
    // Images + voice memos render inline; everything else is forced to download.
    const inline = /^(image\/(png|jpe?g|gif|webp)|audio\/(webm|ogg|mp4|mpeg|aac|x-m4a))$/i.test(type) && req.query.download !== '1';
    const safeName = msg.attachment.fileName.replace(/["\r\n]/g, '_');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`);
    res.setHeader('Content-Type', inline ? type : 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(Buffer.from(object.body));
  } catch (err) {
    next(err);
  }
}
