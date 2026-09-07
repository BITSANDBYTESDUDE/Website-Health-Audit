import { HttpRequestError } from '../http/httpClient';

/**
 * Audit fatal errors. `clientMessage` is safe to show to end users — no
 * stack traces or internal details ever leak into it.
 */
export class AuditFatalError extends Error {
  code: string;
  clientMessage: string;
  constructor(code: string, clientMessage: string, detail?: string) {
    super(detail ?? clientMessage);
    this.name = 'AuditFatalError';
    this.code = code;
    this.clientMessage = clientMessage;
  }
}

export const BLOCKED_MARKERS = [
  'just a moment',
  'attention required',
  'cf-chl',
  'checking your browser',
  'enable javascript and cookies to continue',
  'cf-error',
  'captcha',
  'access denied',
  'request unsuccessful',
  'robot detection',
  'verify you are human',
  'are you a human',
  'before continuing',
];

export function mapErrorToAudit(err: unknown, targetUrl: string): AuditFatalError {
  if (err instanceof AuditFatalError) return err;
  if (err instanceof HttpRequestError) {
    const kind = err.info.kind;
    const status = err.statusCode;
    const host = safeHost(targetUrl);
    switch (kind) {
      case 'DNS':
        return new AuditFatalError('DNS_FAILURE', `We could not resolve "${host}". Check that the domain exists and is spelled correctly.`);
      case 'TIMEOUT':
        return new AuditFatalError('TIMEOUT', `The connection to "${host}" timed out. The website may be slow, overloaded or blocking automated access.`);
      case 'SSL':
        return new AuditFatalError('SSL_ERROR', `We could not establish a secure connection with "${host}" (TLS certificate problem).`);
      case 'CONNECTION':
        return new AuditFatalError('OFFLINE', `We could not reach "${host}". The website may be offline or unreachable from our servers.`);
      case 'RESPONSE_TOO_LARGE':
        return new AuditFatalError('TOO_LARGE', `The response from "${host}" was too large to analyse safely.`);
      case 'REDIRECT_LIMIT':
        return new AuditFatalError('REDIRECT_LOOP', `"${host}" redirects too many times. This usually indicates a redirect loop.`);
      case 'INVALID_TARGET':
        return new AuditFatalError('URL_NOT_ALLOWED', err.info.message);
      case 'BLOCKED': {
        if (status === 401 || status === 403 || status === 429) {
          return new AuditFatalError(
            'ACCESS_RESTRICTED',
            status === 429
              ? `"${host}" is rate-limiting requests. Try again later or with a lower scan depth.`
              : `"${host}" restricted automated access (HTTP ${status}). If this is unexpected, the site may use bot protection such as Cloudflare.`,
          );
        }
        return new AuditFatalError('HTTP_ERROR', `The website responded with HTTP ${status}.`, err.message);
      }
      default:
        return new AuditFatalError('UNREACHABLE', `The audit could not be completed: ${err.message}`);
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new AuditFatalError('INTERNAL', 'An unexpected error occurred while auditing the website.', msg);
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 120);
  }
}

/** Detect bot-protection challenge bodies for friendly messaging. */
export function looksBlocked(statusCode: number, bodyText: string): boolean {
  if (statusCode === 403 || statusCode === 429 || statusCode === 503) {
    const lower = bodyText.toLowerCase().slice(0, 40_000);
    return BLOCKED_MARKERS.some((m) => lower.includes(m));
  }
  return false;
}
