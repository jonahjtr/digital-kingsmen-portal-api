import { Response } from 'express';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function success<T>(res: Response, data: T, statusCode = 200, meta?: PaginationMeta) {
  const body: Record<string, unknown> = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(statusCode).json(body);
}

export function created<T>(res: Response, data: T) {
  return success(res, data, 201);
}

export function error(
  res: Response,
  code: string,
  message: string,
  statusCode = 400,
) {
  return res.status(statusCode).json({
    success: false,
    error: { code, message },
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseOptionalUuid(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const v = String(value).trim();
  return UUID_RE.test(v) ? v : undefined;
}

export function parsePagination(
  query: Record<string, unknown>,
  options?: { maxLimit?: number },
) {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const maxLimit = options?.maxLimit ?? 100;
  const limit = Math.min(maxLimit, Math.max(1, parseInt(String(query.limit ?? '20'), 10) || 20));
  const skip = (page - 1) * limit;
  const search = query.search ? String(query.search) : undefined;
  const status = query.status ? String(query.status) : undefined;
  const archivedOnly = query.archived_only === 'true';
  const sortBy = query.sortBy
    ? String(query.sortBy)
    : archivedOnly
      ? 'archivedAt'
      : 'createdAt';
  const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
  const companyId = parseOptionalUuid(query.company_id);
  const projectId = parseOptionalUuid(query.project_id);
  return { page, limit, skip, search, status, sortBy, sortOrder, companyId, projectId };
}

export function buildMeta(page: number, limit: number, total: number): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}
