import { AsyncLocalStorage } from 'async_hooks';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Request-ID context (populated by the enrichment middleware)
// ---------------------------------------------------------------------------
export const requestContext = new AsyncLocalStorage<{ requestId?: string; userId?: string }>();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const IS_PROD = process.env.NODE_ENV === 'production';
const LOG_LEVEL = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
const LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[LOG_LEVEL] ?? 1;

const BASE = {
  service: 'soroban-explorer',
  version: process.env.npm_package_version ?? '1.0.0',
  env: process.env.NODE_ENV ?? 'development',
  hostname: os.hostname(),
};

// ---------------------------------------------------------------------------
// Core write function
// ---------------------------------------------------------------------------
function write(
  level: 'debug' | 'info' | 'warn' | 'error',
  msg: string,
  meta?: Record<string, unknown>,
) {
  if (LEVELS[level] < currentLevel) return;

  const ctx = requestContext.getStore();
  const entry = {
    level,
    time: new Date().toISOString(),
    ...BASE,
    ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx?.userId ? { userId: ctx.userId } : {}),
    msg,
    ...meta,
  };

  const line = IS_PROD ? JSON.stringify(entry) : prettyPrint(entry);

  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

function prettyPrint(e: Record<string, unknown>): string {
  const { level, time, msg, ...rest } = e;
  const extras = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
  return `[${String(time).slice(11, 23)}] ${String(level).toUpperCase().padEnd(5)} ${msg}${extras}`;
}

// ---------------------------------------------------------------------------
// Exported logger
// ---------------------------------------------------------------------------
export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => write('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => write('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write('error', msg, meta),
};

// ---------------------------------------------------------------------------
// Express enrichment middleware — attach request ID + duration to each log
// ---------------------------------------------------------------------------
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
  const userId = (req as any).user?.id;
  const start = Date.now();

  res.setHeader('x-request-id', requestId);

  requestContext.run({ requestId, userId }, () => {
    res.on('finish', () => {
      logger.info('request completed', {
        method: req.method,
        route: req.route?.path ?? req.path,
        status: res.statusCode,
        duration_ms: Date.now() - start,
      });
    });
    next();
  });
}
