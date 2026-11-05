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
  reactions: { select: { emoji: true, userId: true, user: { select: { fullName: true } } }, orderBy: { createdAt: 'asc' } },
  attachment: { select: { id: true, fileName: true, fileType: true, fileSize: true } },
} as const;

type ReactionRow = { emoji: string; userId: string; user: { fullName: string } };

/** Group reaction rows into [{ emoji, userIds, names }] in first-used order. */
export function groupReactions(rows: ReactionRow[]) {
  const map = new Map<string, { emoji: string; userIds: string[]; names: string[] }>();
  for (const r of rows) {
    const g = map.get(r.emoji) ?? { emoji: r.emoji, userIds: [], names: [] };
    g.userIds.push(r.userId);
    g.names.push(r.user.fullName);
    map.set(r.emoji, g);
  }
  return [...map.values()];
}

export function mapMessageWithMentions<T extends {
  id: string;
  conversationId: string;
  senderId: string;
  message: string;
  internalOnly: boolean;
  readAt: Date | null;
  editedAt?: Date | null;
  deletedAt?: Date | null;
  createdAt: Date;
  sender: { id: string; fullName: string; avatarUrl: string | null };
  mentions: Array<{ userId: string; user: { id: string; fullName: string } }>;
  reactions?: ReactionRow[];
  attachment?: { id: string; fileName: string; fileType: string | null; fileSize: number | null } | null;
}>(msg: T) {
  const { reactions, attachment, ...rest } = msg;
  const deleted = !!msg.deletedAt;
  return {
    ...rest,
    // Deleted messages keep their slot in the thread but never leak content.
    message: deleted ? '' : msg.message,
    mentionedUsers: deleted
      ? []
      : msg.mentions.map((m) => ({ id: m.user.id, fullName: m.user.fullName })),
    reactions: deleted ? [] : groupReactions(reactions ?? []),
    attachment: deleted || !attachment ? null : attachment,
  };
}

export function buildMentionCreates(userIds: string[]) {
  return userIds.map((userId) => ({
    id: randomUUID(),
    userId,
  }));
}
