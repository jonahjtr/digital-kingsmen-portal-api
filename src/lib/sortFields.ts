const TASK_SORT_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'dueDate',
  'title',
  'status',
  'priority',
  'archivedAt',
]);

export function resolveTaskSortField(sortBy: string, archivedOnly: boolean): string {
  if (TASK_SORT_FIELDS.has(sortBy)) return sortBy;
  return archivedOnly ? 'archivedAt' : 'createdAt';
}
