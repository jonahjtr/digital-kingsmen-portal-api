import { prisma } from '../lib/prisma';
import { broadcastUser } from '../party/broadcast';

export async function createNotification(
  userId: string,
  title: string,
  message: string,
  type: string,
) {
  const notification = await prisma.notification.create({
    data: { userId, title, message, type },
  });
  await broadcastUser(userId, {
    type: 'notification.created',
    payload: notification,
  });
  return notification;
}

export async function notifyUsers(
  userIds: string[],
  title: string,
  message: string,
  type: string,
) {
  const unique = [...new Set(userIds)];
  await Promise.all(
    unique.map((userId) => createNotification(userId, title, message, type)),
  );
}
