import { Request, Response, NextFunction } from 'express';

/** Workers-safe body parser (no iconv-lite / body-parser). */
export function workersBodyParser() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      req.body = {};
      return next();
    }

    const chunks: Buffer[] = [];
    try {
      await new Promise<void>((resolve, reject) => {
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve());
        req.on('error', reject);
      });
    } catch {
      return next();
    }

    if (chunks.length === 0) {
      req.body = {};
      return next();
    }

    const buf = Buffer.concat(chunks);
    const ct = req.headers['content-type'] || '';

    if (ct.includes('multipart/form-data')) {
      req.rawBody = buf;
      req.body = {};
      return next();
    }

    if (ct.includes('application/json')) {
      try {
        req.body = JSON.parse(buf.toString('utf8'));
      } catch {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' },
        });
      }
    } else if (ct.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(buf.toString('utf8'));
      const body: Record<string, string> = {};
      params.forEach((v, k) => {
        body[k] = v;
      });
      req.body = body;
    } else {
      req.body = buf;
    }

    next();
  };
}
