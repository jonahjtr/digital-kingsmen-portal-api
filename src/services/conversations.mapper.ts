import type { Conversation, Message, User } from '@prisma/client';

const TYPE_LABELS: Record<string, string> = {
  client_project: 'Client project',
  internal_project: 'Internal project',
  admin_salesman: 'Admin ↔ Sales',
  admin_employee: 'Admin ↔ Team',
};

type ConversationWithRelations = Conversation & {
  project?: { id: string; name: string } | null;
  company?: { id: string; name: string } | null;
  messages: Message[];
  _count?: { messages: number };
};

type MessageWithSender = Message & {
  sender: Pick<User, 'id' | 'fullName' | 'avatarUrl'>;
};

export function conversationTitle(c: {
  type: string;
  project?: { name: string } | null;
  company?: { name: string } | null;
}): string {
  return c.project?.name ?? c.company?.name ?? TYPE_LABELS[c.type] ?? 'Conversation';
}

export function mapConversationListItem(c: ConversationWithRelations) {
  const last = c.messages[0];
  return {
    id: c.id,
    type: c.type,
    title: conversationTitle(c),
    projectName: c.project?.name,
    companyName: c.company?.name,
    lastMessageAt: last?.createdAt.toISOString() ?? c.updatedAt.toISOString(),
    lastMessagePreview: last?.message?.slice(0, 120),
    isInternal: c.type !== 'client_project',
    unreadCount: c._count?.messages ?? 0,
  };
}

export function mapMessageItem(m: MessageWithSender) {
  return {
    id: m.id,
    body: m.message,
    authorId: m.senderId,
    authorName: m.sender.fullName,
    avatarUrl: m.sender.avatarUrl,
    createdAt: m.createdAt.toISOString(),
    isInternal: m.internalOnly,
    readAt: m.readAt?.toISOString() ?? null,
  };
}
