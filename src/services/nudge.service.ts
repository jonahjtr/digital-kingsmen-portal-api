import { User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertCanAccessProject } from '../permissions/access';
import { createNotification, notifyUsers } from './notification.service';

export async function sendNudge(user: User, projectId: string) {
  await assertCanAccessProject(user, projectId);

  if (user.role !== 'client' && user.role !== 'salesman' && user.role !== 'admin') {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Only clients and salesmen can send nudges', 403);
  }

  const cooldownMs = env.NUDGE_COOLDOWN_MINUTES * 60 * 1000;
  const since = new Date(Date.now() - cooldownMs);
  const recent = await prisma.nudge.findFirst({
    where: { projectId, userId: user.id, createdAt: { gte: since } },
  });
  if (recent) {
    throw new AppError(
      ErrorCodes.NUDGE_RATE_LIMITED,
      `Please wait before sending another nudge (${env.NUDGE_COOLDOWN_MINUTES} min cooldown)`,
      409,
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { company: true },
  });
  if (!project) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Project not found', 404);
  }

  await prisma.nudge.create({ data: { projectId, userId: user.id } });

  const nudgeTitle = `Nudge: ${project.name}`;
  const nudgeMessage = `${user.fullName} requested an update on project "${project.name}".`;

  await prisma.projectUpdate.create({
    data: {
      projectId,
      title: nudgeTitle,
      message: nudgeMessage,
      postedBy: user.id,
      visibility: 'internal_only',
    },
  });

  const notifyIds: string[] = [];
  if (project.projectManagerId) notifyIds.push(project.projectManagerId);
  const admins = await prisma.user.findMany({
    where: { role: 'admin', isActive: true },
    select: { id: true },
  });
  notifyIds.push(...admins.map((a) => a.id));

  await notifyUsers(notifyIds, nudgeTitle, nudgeMessage, 'nudge');

  let conversation = await prisma.conversation.findFirst({
    where: { projectId, type: 'internal_project' },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { projectId, type: 'internal_project' },
    });
  }

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderId: user.id,
      message: nudgeMessage,
      internalOnly: true,
    },
  });

  return { nudged: true, projectId };
}
