import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import {
  assertCanAccessProject,
  assertCanAccessCompany,
  canSeeInternal,
  isAdmin,
} from '../permissions/access';

const TRANSCRIPT_MAX = 500_000;

const includeCreator = {
  creator: { select: { id: true, fullName: true } },
  project: { select: { id: true, name: true } },
};

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!canSeeInternal(req.user!)) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    const { page, limit, skip } = parsePagination(req.query);
    const companyId = req.query.company_id as string | undefined;
    if (!companyId) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'company_id is required', 400);
    }
    await assertCanAccessCompany(req.user!, companyId);

    const where = { companyId };
    const [rows, total] = await Promise.all([
      prisma.callTranscription.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ callDate: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          companyId: true,
          projectId: true,
          title: true,
          callDate: true,
          createdAt: true,
          createdBy: true,
          transcript: true,
          creator: includeCreator.creator,
          project: includeCreator.project,
        },
      }),
      prisma.callTranscription.count({ where }),
    ]);
    const items = rows.map(({ transcript, ...rest }) => ({
      ...rest,
      transcriptPreview: transcript.length > 300 ? `${transcript.slice(0, 300)}…` : transcript,
      transcriptLength: transcript.length,
    }));
    return success(res, items, 200, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    if (!canSeeInternal(req.user!)) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    const item = await prisma.callTranscription.findUnique({
      where: { id: getParam(req, 'id') },
      include: includeCreator,
    });
    if (!item) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Transcription not found', 404);
    }
    await assertCanAccessCompany(req.user!, item.companyId);
    return success(res, item);
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!canSeeInternal(req.user!)) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    const body = req.body;
    await assertCanAccessCompany(req.user!, body.company_id);
    if (body.project_id) {
      await assertCanAccessProject(req.user!, body.project_id);
    }
    const transcript = String(body.transcript ?? '').trim();
    if (transcript.length > TRANSCRIPT_MAX) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        `Transcript must be ${TRANSCRIPT_MAX} characters or fewer`,
        400,
      );
    }
    let callDate: Date | undefined;
    if (body.call_date) {
      const d = new Date(body.call_date);
      if (Number.isNaN(d.getTime())) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid call_date', 400);
      }
      callDate = d;
    }

    const item = await prisma.callTranscription.create({
      data: {
        companyId: body.company_id,
        projectId: body.project_id,
        title: body.title,
        transcript,
        callDate,
        createdBy: req.user!.id,
      },
      include: includeCreator,
    });
    return created(res, item);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!canSeeInternal(req.user!)) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    const id = getParam(req, 'id');
    const existing = await prisma.callTranscription.findUnique({
      where: { id },
      select: { id: true, createdBy: true, companyId: true },
    });
    if (!existing) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Transcription not found', 404);
    }
    await assertCanAccessCompany(req.user!, existing.companyId);
    if (!isAdmin(req.user!) && existing.createdBy !== req.user!.id) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'You can only delete your own transcriptions', 403);
    }
    await prisma.callTranscription.delete({ where: { id } });
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}
