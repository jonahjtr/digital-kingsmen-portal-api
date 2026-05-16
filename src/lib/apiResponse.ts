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

export function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10) || 20));
  const skip = (page - 1) * limit;
  const search = query.search ? String(query.search) : undefined;
  const status = query.status ? String(query.status) : undefined;
  const sortBy = query.sortBy ? String(query.sortBy) : 'createdAt';
  const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
  return { page, limit, skip, search, status, sortBy, sortOrder };
}

export function buildMeta(page: number, limit: number, total: number): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}
