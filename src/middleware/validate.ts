import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { error } from '../lib/apiResponse';
import { ErrorCodes } from '../lib/errors';

type RequestPart = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, part: RequestPart = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const message = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      return error(res, ErrorCodes.VALIDATION_ERROR, message, 400);
    }
    req[part] = result.data;
    next();
  };
}
