import type { Request, Response, NextFunction } from 'express';
import { applyCorsHeaders } from '../lib/cors';

/** Ensures every JSON/status response includes CORS headers (including auth errors). */
export function corsResponseMiddleware(req: Request, res: Response, next: NextFunction) {
  const ensure = () => applyCorsHeaders(req, res);

  ensure();

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    ensure();
    return originalJson(body);
  };

  const originalStatus = res.status.bind(res);
  res.status = (code: number) => {
    ensure();
    return originalStatus(code);
  };

  const originalSend = res.send.bind(res);
  res.send = (body?: unknown) => {
    ensure();
    return originalSend(body);
  };

  next();
}
