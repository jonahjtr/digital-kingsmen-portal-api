import { ConversationType, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';

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
    const project = await loadProjectContext(projectId);
    if (project) {
      ids.push(project.projectManagerId, project.company.assignedProjectManagerId);
    }
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
