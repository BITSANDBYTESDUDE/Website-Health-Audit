import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { log } from '../utils/log';

export function corsMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  const origins = config.corsOrigins;
  const allowAll = origins.includes('*');
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (allowAll || (origin && origins.includes(origin))) {
      res.setHeader('access-control-allow-origin', allowAll ? '*' : (origin as string));
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
      res.setHeader('access-control-max-age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

export function requestLogger(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      if (res.statusCode >= 500) {
        log.error(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
      } else if (req.originalUrl.startsWith('/api/audits/') && req.method === 'GET') {
        log.debug(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
      } else {
        log.info(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms}ms`);
      }
    });
    next();
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  log.error('unhandled request error', { error: err instanceof Error ? err.message : String(err) });
  if (res.headersSent) return;
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'An internal server error occurred. Please try again later.',
    },
  });
}

export function clientFacingId(): string {
  return randomUUID();
}
