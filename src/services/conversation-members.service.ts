import { ConversationType, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, ErrorCodes } from '../lib/errors';
import { companyWhereForUser } from '../permissions/filters';
import type { Prisma, User } from '@prisma/client';

const CLIENT_ROLE: UserRole = 'client';

function uniqueIds(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

async function loadProjectContext(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    include: {
      teamMembers: { select: { userId: true } },
      company: {
        select: {
          id: true,
          assignedSalesmanId: true,
          assignedProjectManagerId: true,
          companyUsers: { select: { userId: true, user: { select: { role: true } } } },
          staffAssignments: { select: { userId: true } },
        },
      },
    },
  });
}

async function staffIdsForProject(projectId: string): Promise<string[]> {
  const project = await loadProjectContext(projectId);
  if (!project) return [];

  return uniqueIds([
    project.projectManagerId,
    project.assignedSalesmanId,
    project.company.assignedSalesmanId,
    project.company.assignedProjectManagerId,
    ...project.teamMembers.map((tm) => tm.userId),
    ...project.company.staffAssignments.map((sa) => sa.userId),
  ]);
}

async function clientIdsForProject(projectId: string): Promise<string[]> {
  const project = await loadProjectContext(projectId);
  if (!project) return [];

  return project.company.companyUsers
    .filter((cu) => cu.user.role === CLIENT_ROLE)
    .map((cu) => cu.userId);
}

async function activeMemberIds(
  ids: string[],
  type: ConversationType,
): Promise<string[]> {
  if (ids.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true, role: true },
  });

  if (type === 'client_project') {
    return users.map((u) => u.id);
  }

  return users.filter((u) => u.role !== CLIENT_ROLE).map((u) => u.id);
}

export async function resolveDefaultMemberIds(input: {
  type: ConversationType;
  projectId?: string | null;
  companyId?: string | null;
  creatorId?: string;
  explicitMemberIds?: string[];
}): Promise<string[]> {
  const { type, projectId, companyId, creatorId, explicitMemberIds } = input;
  const ids: (string | null | undefined)[] = creatorId ? [creatorId] : [];

  if (type === 'client_project' && projectId) {
    ids.push(...(await clientIdsForProject(projectId)));
    ids.push(...(await staffIdsForProject(projectId)));
  } else if (type === 'internal_project' && projectId) {
    ids.push(...(await staffIdsForProject(projectId)));
  } else if (type === 'admin_salesman') {
    if (projectId) {
      const project = await loadProjectContext(projectId);
      if (project) {
        ids.push(project.assignedSalesmanId, project.company.assignedSalesmanId);
      }
    } else if (companyId) {
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { assignedSalesmanId: true },
      });
      ids.push(company?.assignedSalesmanId);
    }
  } else if (type === 'admin_employee' && projectId) {
    ids.push(...(await staffIdsForProject(projectId)));
  }

  if (explicitMemberIds?.length) {
    ids.push(...explicitMemberIds);
  }

  return activeMemberIds(uniqueIds(ids), type);
}

/** Move legacy internal_project threads into the unified client_project thread. */
async function mergeInternalThreadsInto(projectId: string, primaryId: string): Promise<void> {
  const legacy = await prisma.conversation.findMany({
    where: { projectId, type: 'internal_project', NOT: { id: primaryId } },
    include: { members: true },
  });

  for (const internal of legacy) {
    await prisma.message.updateMany({
      where: { conversationId: internal.id },
      data: { conversationId: primaryId, internalOnly: true },
    });

    const existing = await prisma.conversationMember.findMany({
      where: { conversationId: primaryId },
      select: { userId: true },
    });
    const existingIds = new Set(existing.map((m) => m.userId));
    const toAdd = internal.members
      .map((m) => m.userId)
      .filter((userId) => !existingIds.has(userId));

    if (toAdd.length > 0) {
      await prisma.conversationMember.createMany({
        data: toAdd.map((userId) => ({ conversationId: primaryId, userId })),
      });
    }

    await prisma.conversationMember.deleteMany({ where: { conversationId: internal.id } });
    await prisma.conversation.delete({ where: { id: internal.id } });
  }
}

/** One unified thread per project: clients + all staff. */
export async function ensureProjectConversation(projectId: string): Promise<{ id: string }> {
  let conversation = await prisma.conversation.findFirst({
    where: { projectId, type: 'client_project' },
  });

  if (!conversation) {
    const memberIds = await resolveDefaultMemberIds({
      type: 'client_project',
      projectId,
    });
    conversation = await prisma.conversation.create({
      data: {
        projectId,
        type: 'client_project',
        members: {
          create: memberIds.map((userId) => ({ userId })),
        },
      },
    });
  }

  await mergeInternalThreadsInto(projectId, conversation.id);
  await ensureConversationMembers(conversation.id);

  return { id: conversation.id };
}

/** Backfill missing members on project-linked conversations (e.g. legacy rows or nudges). */
export async function ensureConversationMembers(
  conversationId: string,
  additionalUserIds: string[] = [],
): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      type: true,
      projectId: true,
      companyId: true,
      members: { select: { userId: true } },
    },
  });
  if (!conversation) return;
  if (!conversation.projectId && !conversation.companyId) return;

  const desired = await resolveDefaultMemberIds({
    type: conversation.type,
    projectId: conversation.projectId,
    companyId: conversation.companyId,
    creatorId: additionalUserIds[0] ?? conversation.members[0]?.userId,
    explicitMemberIds: [
      ...conversation.members.map((m) => m.userId),
      ...additionalUserIds,
    ],
  });

  const existing = new Set(conversation.members.map((m) => m.userId));
  const toAdd = desired.filter((id) => !existing.has(id));
  if (toAdd.length === 0) return;

  await prisma.conversationMember.createMany({
    data: toAdd.map((userId) => ({ conversationId, userId })),
  });
}

/** Backfill unified project threads for all existing projects. */
export async function backfillAllProjectConversations(): Promise<{ projects: number }> {
  const projects = await prisma.project.findMany({ select: { id: true } });
  for (const project of projects) {
    await ensureProjectConversation(project.id);
  }
  return { projects: projects.length };
}

/**
 * 1:1 thread between the caller and one other active user. Reuses the existing pair
 * thread if there is one. Only staff can start a DM (clients can reply in one).
 */
/** Who a staff user may DM: all active staff + clients of companies they can see. */
export async function directCandidateWhere(me: User): Promise<Prisma.UserWhereInput> {
  return {
    isActive: true,
    id: { not: me.id },
    OR: [
      { role: { not: CLIENT_ROLE } },
      { role: CLIENT_ROLE, companyUsers: { some: { company: await companyWhereForUser(me) } } },
    ],
  };
}

export async function listDirectCandidates(me: User) {
  if (me.role === CLIENT_ROLE) throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
  const users = await prisma.user.findMany({
    where: await directCandidateWhere(me),
    orderBy: { fullName: 'asc' },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      companyUsers: { take: 1, select: { company: { select: { name: true } } } },
    },
  });
  return users.map(({ companyUsers, ...u }) => ({ ...u, companyName: companyUsers[0]?.company.name ?? null }));
}

export async function openDirectConversation(
  me: User,
  memberIds: string[] | undefined,
) {
  if (me.role === CLIENT_ROLE) {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Clients cannot start direct messages', 403);
  }
  const otherId = memberIds?.find((id) => id !== me.id);
  if (!otherId || (memberIds?.filter((id) => id !== me.id).length ?? 0) !== 1) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Pick exactly one person to message', 400);
  }
  const other = await prisma.user.findFirst({
    where: { AND: [{ id: otherId }, await directCandidateWhere(me)] },
    select: { id: true },
  });
  if (!other) throw new AppError(ErrorCodes.NOT_FOUND, 'User not found', 404);

  const existing = await prisma.conversation.findFirst({
    where: {
      type: 'direct',
      AND: [{ members: { some: { userId: me.id } } }, { members: { some: { userId: otherId } } }],
    },
    include: { members: true },
  });
  if (existing) return existing;

  return prisma.conversation.create({
    data: { type: 'direct', members: { create: [{ userId: me.id }, { userId: otherId }] } },
    include: { members: true },
  });
}
