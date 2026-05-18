import type { Request, Response } from 'express';

function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (parseCorsOrigins().includes(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    return (
      hostname.endsWith('.lovable.app') ||
      hostname.endsWith('.lovableproject.com') ||
      hostname.endsWith('.lovable.dev') ||
      hostname.endsWith('.pages.dev') ||
      hostname.endsWith('.workers.dev')
    );
  } catch {
    return false;
  }
}

/** Ensure error responses still pass browser CORS checks. */
export function applyCorsHeaders(req: Request, res: Response): void {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
}
