import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertCanAccessProject, assertCanAccessCompany } from '../permissions/access';
import { projectWhereForUser, companyWhereForUser } from '../permissions/filters';
import { getStorageProvider } from '../storage';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip, status, companyId, projectId } = parsePagination(req.query);
    if (companyId) await assertCanAccessCompany(req.user!, companyId);
    if (projectId) await assertCanAccessProject(req.user!, projectId);
    const projectScope = await projectWhereForUser(req.user!);
    const companyScope = await companyWhereForUser(req.user!);
    const andFilters: Record<string, unknown>[] = [
      {
        OR: [
          { project: projectScope },
          { company: companyScope },
          { uploadedBy: req.user!.id },
        ],
      },
    ];
    if (companyId) {
      andFilters.push({
        OR: [{ companyId }, { project: { companyId } }],
      });
    }
    if (projectId) andFilters.push({ projectId });
    if (status) andFilters.push({ status: status as never });
    const where = { AND: andFilters };
    const [files, total] = await Promise.all([
      prisma.file.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.file.count({ where }),
    ]);
    return success(res, files, 200, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const file = await prisma.file.findUnique({ where: { id: getParam(req, 'id') } });
    if (!file) throw new AppError(ErrorCodes.NOT_FOUND, 'File not found', 404);
    if (file.projectId) await assertCanAccessProject(req.user!, file.projectId);
    else if (file.companyId) await assertCanAccessCompany(req.user!, file.companyId);
  else if (file.uploadedBy !== req.user!.id && req.user!.role !== 'admin') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    return success(res, file);
  } catch (err) {
    next(err);
  }
}

export async function upload(req: Request, res: Response, next: NextFunction) {
  try {
    const multerFile = req.file;
    if (!multerFile) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'No file uploaded', 400);
    const body = req.body;
    if (body.project_id) await assertCanAccessProject(req.user!, body.project_id);
    if (body.company_id) await assertCanAccessCompany(req.user!, body.company_id);
    const storage = getStorageProvider();
    const result = await storage.upload(multerFile.buffer, {
      fileName: multerFile.originalname,
      mimeType: multerFile.mimetype,
      size: multerFile.size,
    });
    const file = await prisma.file.create({
      data: {
        companyId: body.company_id,
        projectId: body.project_id,
        taskId: body.task_id,
        uploadedBy: req.user!.id,
        fileName: multerFile.originalname,
        fileUrl: result.key,
        fileType: multerFile.mimetype,
        fileSize: multerFile.size,
        category: body.category ?? 'other',
      },
    });
    return created(res, file);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const file = await prisma.file.findUnique({ where: { id: getParam(req, 'id') } });
    if (!file) throw new AppError(ErrorCodes.NOT_FOUND, 'File not found', 404);
    if (file.projectId) await assertCanAccessProject(req.user!, file.projectId);
    const body = req.body;
    const updated = await prisma.file.update({
      where: { id: getParam(req, 'id') },
      data: {
        category: body.category,
        status: body.status,
        fileName: body.file_name,
      },
    });
    return success(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const file = await prisma.file.findUnique({ where: { id: getParam(req, 'id') } });
    if (!file) throw new AppError(ErrorCodes.NOT_FOUND, 'File not found', 404);
    if (file.uploadedBy !== req.user!.id && req.user!.role !== 'admin') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    const storage = getStorageProvider();
    await storage.delete(file.fileUrl);
    await prisma.file.delete({ where: { id: getParam(req, 'id') } });
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

export async function download(req: Request, res: Response, next: NextFunction) {
  try {
    const file = await prisma.file.findUnique({ where: { id: getParam(req, 'id') } });
    if (!file) throw new AppError(ErrorCodes.NOT_FOUND, 'File not found', 404);
    if (file.projectId) await assertCanAccessProject(req.user!, file.projectId);
    else if (file.companyId) await assertCanAccessCompany(req.user!, file.companyId);
    else if (file.uploadedBy !== req.user!.id && req.user!.role !== 'admin') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    const storage = getStorageProvider();
    if (!storage.get) {
      throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Storage provider does not support downloads', 500);
    }
    const object = await storage.get(file.fileUrl);
    if (!object) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'File content not found', 404);
    }
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Content-Type', object.mimeType || file.fileType || 'application/octet-stream');
    return res.send(Buffer.from(object.body));
  } catch (err) {
    next(err);
  }
}
