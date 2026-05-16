import { prisma } from '../lib/prisma';

export async function createNotification(
  userId: string,
  title: string,
  message: string,
  type: string,
) {
  return prisma.notification.create({
    data: { userId, title, message, type },
  });
}

export async function notifyUsers(
  userIds: string[],
  title: string,
  message: string,
  type: string,
) {
  const unique = [...new Set(userIds)];
  await prisma.notification.createMany({
    data: unique.map((userId) => ({ userId, title, message, type })),
  });
}
