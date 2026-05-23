import type { Prisma, ProjectStatus } from '@prisma/client';

const PROJECT_STATUSES = new Set<ProjectStatus>([
  'not_started',
  'in_progress',
  'waiting_on_client',
  'internal_review',
  'client_review',
  'complete',
  'paused',
]);

const ACTIVE_STATUSES: ProjectStatus[] = [
  'not_started',
  'in_progress',
  'waiting_on_client',
  'internal_review',
  'client_review',
];

/** Maps list query `status` to a safe Prisma where clause (invalid values → no filter). */
export function projectListStatusWhere(
  status?: string,
): Pick<Prisma.ProjectWhereInput, 'status'> | undefined {
  if (!status) return undefined;
  const normalized = status.trim().toLowerCase();

  if (normalized === 'completed') return { status: 'complete' };
  if (normalized === 'active') return { status: { in: ACTIVE_STATUSES } };
  // Projects are not archivable (unlike tasks); return empty set without error.
  if (normalized === 'archived') return { status: { in: [] } };

  if (PROJECT_STATUSES.has(normalized as ProjectStatus)) {
    return { status: normalized as ProjectStatus };
  }
  return undefined;
}

const PROJECT_SORT_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'dueDate',
  'name',
  'status',
  'priority',
  'overallProgress',
]);

export function resolveProjectSortField(sortBy: string): string {
  return PROJECT_SORT_FIELDS.has(sortBy) ? sortBy : 'createdAt';
}
