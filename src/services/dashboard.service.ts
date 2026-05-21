import type {
  Approval,
  File,
  Message,
  Project,
  ProjectUpdate,
  Task,
} from '@prisma/client';

type ProjectWithCompany = Project & {
  company?: { id: string; name: string; logoUrl?: string | null } | null;
};
type UpdateWithProject = ProjectUpdate & { project?: { name: string } | null };
type TaskWithProject = Task & { project?: { name: string } | null };

export function mapDashboardProject(p: ProjectWithCompany) {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    progress: Math.round(p.overallProgress ?? 0),
    dueDate: p.dueDate?.toISOString() ?? undefined,
    companyId: p.companyId,
    companyName: p.company?.name,
    companyHasLogo: !!p.company?.logoUrl,
  };
}

export function mapDashboardUpdate(u: UpdateWithProject) {
  return {
    id: u.id,
    title: u.title,
    body: u.message,
    createdAt: u.createdAt.toISOString(),
    projectName: u.project?.name,
  };
}

export function mapDashboardDeadline(t: TaskWithProject) {
  return {
    id: t.id,
    title: t.title,
    dueDate: t.dueDate?.toISOString() ?? undefined,
    projectName: t.project?.name,
  };
}

export function mapDashboardFile(f: File) {
  return {
    id: f.id,
    name: f.fileName,
    uploadedAt: f.createdAt.toISOString(),
  };
}

export function mapDashboardApproval(a: Approval) {
  return {
    id: a.id,
    title: a.title,
    status: a.status,
  };
}

export function mapDashboardTask(t: TaskWithProject) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    dueDate: t.dueDate?.toISOString() ?? undefined,
    projectName: t.project?.name,
  };
}

export function mapDashboardMessage(m: Message & { conversation?: { project?: { name: string } | null } }) {
  return {
    id: m.id,
    title: m.message.slice(0, 80),
    lastMessageAt: m.createdAt.toISOString(),
    projectName: m.conversation?.project?.name,
  };
}
