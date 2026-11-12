import { ConversationType, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { messageInternalFilter } from '../permissions/filters';

const EPOCH = new Date(0);

/** Conversation types a client login may read/post in (still membership-gated). */
export function clientCanSee(type: ConversationType | string): boolean {
  return type === 'client_project' || type === 'direct';
}

export function conversationTitle(
  type: ConversationType,
  projectName?: string | null,
  companyName?: string | null,
): string {
  if (projectName) return projectName;
  if (companyName) return companyName;
  if (type === 'internal_project') return 'Internal project';
  if (type === 'admin_salesman') return 'Admin ↔ Sales';
  if (type === 'admin_employee') return 'Admin ↔ Team';
  if (type === 'direct') return 'Direct message';
  return 'Conversation';
}

export async function countUnreadForMember(
  conversationId: string,
  userId: string,
  user: User,
  lastReadAt: Date | null,
): Promise<number> {
  const since = lastReadAt ?? EPOCH;
  return prisma.message.count({
    where: {
      conversationId,
      createdAt: { gt: since },
      senderId: { not: userId },
      ...messageInternalFilter(user),
    },
  });
}

export async function totalUnreadForUser(user: User): Promise<number> {
  const memberships = await prisma.conversationMember.findMany({
    where: { userId: user.id },
    include: { conversation: { select: { type: true } } },
  });

  const eligible =
    user.role === 'client'
      ? memberships.filter((m) => clientCanSee(m.conversation.type))
      : memberships;

  let total = 0;
  for (const m of eligible) {
    total += await countUnreadForMember(m.conversationId, user.id, user, m.lastReadAt);
  }
  return total;
}

export async function markConversationRead(
  conversationId: string,
  user: User,
  messageId?: string,
): Promise<Date> {
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  });
  if (!member) {
    throw new Error('NOT_MEMBER');
  }

  let readThrough: Date;
  if (messageId) {
    const msg = await prisma.message.findFirst({
      where: {
        id: messageId,
        conversationId,
        ...messageInternalFilter(user),
      },
    });
    readThrough = msg?.createdAt ?? new Date();
  } else {
    const latest = await prisma.message.findFirst({
      where: { conversationId, ...messageInternalFilter(user) },
      orderBy: { createdAt: 'desc' },
    });
    readThrough = latest?.createdAt ?? new Date();
  }

  const now = new Date();
  const candidate = readThrough > now ? readThrough : now;
  const lastReadAt =
    member.lastReadAt && member.lastReadAt > candidate ? member.lastReadAt : candidate;

  await prisma.conversationMember.update({
    where: { id: member.id },
    data: { lastReadAt },
  });

  return lastReadAt;
}

type ConversationWithPreview = {
  id: string;
  type: ConversationType;
  updatedAt: Date;
  project: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
  messages: Array<{ message: string; createdAt: Date }>;
};

export async function mapConversationWithUnread(
  conversation: ConversationWithPreview,
  user: User,
  lastReadAt: Date | null,
): Promise<Record<string, unknown>> {
  const last = conversation.messages[0];
  // ponytail: one extra query per DM row; fine at DK scale, batch it if the inbox gets big.
  const other =
    conversation.type === 'direct'
      ? await prisma.conversationMember.findFirst({
          where: { conversationId: conversation.id, userId: { not: user.id } },
          select: { user: { select: { id: true, fullName: true } } },
        })
      : null;
  const unreadCount = await countUnreadForMember(
    conversation.id,
    user.id,
    user,
    lastReadAt,
  );

  return {
    id: conversation.id,
    type: conversation.type,
    updatedAt: conversation.updatedAt,
    title: other
      ? other.user.fullName
      : conversationTitle(conversation.type, conversation.project?.name, conversation.company?.name),
    directUserId: other?.user.id ?? null,
    projectName: conversation.project?.name ?? null,
    companyName: conversation.company?.name ?? null,
    project: conversation.project,
    company: conversation.company,
    lastMessageAt: last?.createdAt ?? conversation.updatedAt,
    lastMessagePreview: last?.message?.slice(0, 120) ?? null,
    unreadCount,
    isInternal: conversation.type !== 'client_project' && conversation.type !== 'direct',
    isDirect: conversation.type === 'direct',
  };
}

export async function recentConversationsForUser(
  user: User,
  limit = 5,
): Promise<Record<string, unknown>[]> {
  const where =
    user.role === 'client'
      ? {
          members: { some: { userId: user.id } },
          type: { in: ['client_project', 'direct'] as ConversationType[] },
        }
      : { members: { some: { userId: user.id } } };

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: limit,
    include: {
      project: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      messages: { where: messageInternalFilter(user), take: 1, orderBy: { createdAt: 'desc' } },
      members: { where: { userId: user.id }, take: 1 },
    },
  });

  return Promise.all(
    conversations.map((c) => {
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
}
