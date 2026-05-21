import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { success } from '../lib/apiResponse';
import { assertNotClient } from '../permissions/access';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const tags = await prisma.staffTag.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    return success(res, tags);
  } catch (err) {
    next(err);
  }
}
