import { randomUUID } from 'crypto';

type MemberWithUser = {
  userId: string;
  user: { id: string; role: string; fullName: string };
};

export function resolveMentionedUserIds(
  requestedIds: string[] | undefined,
  members: MemberWithUser[],
  senderId: string,
  internalOnly: boolean,
): string[] {
  if (!requestedIds?.length) return [];

  const memberById = new Map(members.map((m) => [m.userId, m.user]));
  const unique = [...new Set(requestedIds)];

  return unique.filter((id) => {
    if (id === senderId) return false;
    const user = memberById.get(id);
    if (!user) return false;
    if (internalOnly && user.role === 'client') return false;
    return true;
  });
}

export const messageWithMentionsInclude = {
  sender: { select: { id: true, fullName: true, avatarUrl: true } },
  mentions: { include: { user: { select: { id: true, fullName: true } } } },
} as const;

export function mapMessageWithMentions<T extends {
  id: string;
  conversationId: string;
  senderId: string;
  message: string;
  internalOnly: boolean;
  readAt: Date | null;
  createdAt: Date;
  sender: { id: string; fullName: string; avatarUrl: string | null };
  mentions: Array<{ userId: string; user: { id: string; fullName: string } }>;
}>(msg: T) {
  return {
    ...msg,
    mentionedUsers: msg.mentions.map((m) => ({
      id: m.user.id,
      fullName: m.user.fullName,
    })),
  };
}

export function buildMentionCreates(userIds: string[]) {
  return userIds.map((userId) => ({
    id: randomUUID(),
    userId,
  }));
}
