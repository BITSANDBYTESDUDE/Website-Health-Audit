import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { validateAuditTarget, UrlValidation } from '../utils/url';

/**
 * SSRF-safe HTTP client.
 *
 * Every request:
 *   - validates the host + every redirect target (shape, DNS, IP policy)
 *   - connects to a validated IP with `Host`/SNI pinned to the hostname
 *   - enforces timeouts, response-size caps and a redirect limit
 *
 * Returns real timings (DNS / connect / TLS / TTFB) where measurable.
 */

export type HeaderBag = Record<string, string | string[] | undefined>;

export interface HttpResponse {
  statusCode: number;
  statusMessage: string;
  headers: HeaderBag;
  body: Buffer;
  text: string;
  finalUrl: string;
  redirectChain: string[];
  sizeBytes: number;
  httpVersion: string;
  tls: {
    protocol: string | null;
    cipher: string | null;
    certificate: {
      subject: Record<string, string> | null;
      issuer: Record<string, string> | null;
      validFrom: string | null;
      validTo: string | null;
      fingerprint: string | null;
      authority: boolean | null;
    } | null;
  };
  timings: {
    dnsMs: number;
    connectMs: number;
    tlsMs: number;
    ttfbMs: number;
    totalMs: number;
  };
}

export interface HttpErrorInfo {
  kind:
    | 'DNS'
    | 'TIMEOUT'
    | 'SSL'
    | 'CONNECTION'
    | 'RESPONSE_TOO_LARGE'
    | 'BLOCKED'
    | 'REDIRECT_LIMIT'
    | 'INVALID_TARGET'
    | 'PROTOCOL'
    | 'UNKNOWN';
  message: string;
}

export class HttpRequestError extends Error {
  info: HttpErrorInfo;
  statusCode?: number;
  constructor(info: HttpErrorInfo, statusCode?: number) {
    super(info.message);
    this.name = 'HttpRequestError';
    this.info = info;
    this.statusCode = statusCode;
  }
}

export interface HttpFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  method?: 'GET' | 'HEAD';
  accept?: string;
  extraHeaders?: Record<string, string>;
  /** When true a non-2xx is returned normally instead of throwing. */
  allowErrorStatus?: boolean;
  validation?: UrlValidation;
}

function pickHeader(headers: HeaderBag, name: string): string | null {
  if (!headers) return null;
  const v = headers[name];
  if (Array.isArray(v)) return v.join(', ');
  return v ?? null;
}

function decodeBody(buf: Buffer, headers: HeaderBag): string {
  const ct = (pickHeader(headers, 'content-type') ?? '').toLowerCase();
  const match = /charset=([a-z0-9_\-]+)/i.exec(ct);
  let charset: string | null = match ? match[1] : null;
  if (!charset) {
    const head = buf.subarray(0, 2048).toString('latin1');
    const m = /<meta[^>]+charset=["']?\s*([a-z0-9_\-]+)/i.exec(head);
    charset = m ? m[1] : null;
  }
  if (!charset) charset = 'utf-8';
  const clean = charset.replace(/["']/g, '');
  const lower = clean.toLowerCase();
  if (lower === 'utf-8' || lower === 'utf8') return buf.toString('utf8');
  if (lower === 'windows-1252' || lower === 'iso-8859-1' || lower === 'latin1') {
    return buf.toString('latin1');
  }
  try {
    return new TextDecoder(clean).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

function formatHost(ip: string): string {
  return net.isIP(ip) === 6 ? `[${ip}]` : ip;
}

function mapNodeError(err: NodeJS.ErrnoException & { code?: string }, host: string): HttpErrorInfo {
  const code = (err.code ?? '').toUpperCase();
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENODATA') {
    return { kind: 'DNS', message: `DNS lookup failed for ${host}.` };
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || code === 'ECONNRESET') {
    return { kind: 'TIMEOUT', message: `Connection to ${host} timed out.` };
  }
  if (code.startsWith('DEPTH_ZERO_SELF_SIGNED') || code.startsWith('SELF_SIGNED') || code.startsWith('UNABLE_TO_VERIFY') || code.startsWith('CERT') || code.startsWith('ERR_TLS') || code === 'EPROTO' || code === 'ECONNRESET') {
    if (code === 'ECONNRESET') {
      return { kind: 'CONNECTION', message: `Connection to ${host} was reset.` };
    }
    return {
      kind: 'SSL',
      message: `We could not establish a trusted TLS connection with ${host} (${code}).`,
    };
  }
  if (code === 'ECONNREFUSED') {
    return { kind: 'CONNECTION', message: `Connection to ${host} was refused.` };
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return { kind: 'CONNECTION', message: `${host} is unreachable from this server.` };
  }
  return { kind: 'UNKNOWN', message: err.message ?? `Request to ${host} failed (${code || 'unknown error'}).` };
}

/** Raw single-request fetch (no redirects) against a validated target. */
export function rawRequest(
  url: URL,
  addresses: string[],
  opts: HttpFetchOptions = {},
): Promise<HttpResponse> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
  const method = opts.method ?? 'GET';
  const isHttps = url.protocol === 'https:';
  const hostname = url.hostname;

  return new Promise<HttpResponse>((resolve, reject) => {
    const timings = { dnsMs: 0, connectMs: 0, tlsMs: 0, ttfbMs: 0, totalMs: 0 };
    const started = Date.now();
    let settled = false;

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err instanceof HttpRequestError ? err : new HttpRequestError(mapNodeError(err as NodeJS.ErrnoException, hostname)));
    };

    let currentAddress = addresses[0] ?? hostname;
    let addrIndex = 0;
    const mod = isHttps ? https : http;

    const attempt = (): void => {
      if (settled) return;
      const connectAt = Date.now();
      // Connect to the validated IP; keep hostname via Host header + SNI.
      const options: https.RequestOptions = {
        host: formatHost(currentAddress),
        hostname: currentAddress,
        port: Number(url.port || (isHttps ? 443 : 80)),
        path: url.pathname + url.search,
        method,
        servername: isHttps ? hostname : undefined,
        headers: {
          Host: hostname + (url.port ? `:${url.port}` : ''),
          'user-agent': 'SitePulseBot/1.0 (+https://sitepulse.app; website health audit)',
          accept: opts.accept ?? '*/*',
          ...opts.extraHeaders,
        },
        timeout: timeoutMs,
      };
      if (!isHttps) delete options.servername;

      const req = mod.request(options, (res) => {
        if (settled) return;
        timings.ttfbMs = Date.now() - connectAt;
        const total = Number(res.headers['content-length'] ?? '0') || 0;
        const chunks: Buffer[] = [];
        let size = 0;
        let tooLarge = false;

        res.on('data', (chunk: Buffer) => {
          if (settled) return;
          size += chunk.length;
          if (size > maxBytes) {
            tooLarge = true;
            req.destroy();
            settled = true;
            reject(
              new HttpRequestError({
                kind: 'RESPONSE_TOO_LARGE',
                message: `The response from ${hostname} exceeded the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`,
              }),
            );
            return;
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          if (settled) return;
          settled = true;
          const wire = Buffer.concat(chunks);
          const enc = String(res.headers['content-encoding'] ?? '')
            .toLowerCase()
            .trim();
          let body = wire;
          if (enc) {
            try {
              if (enc.includes('gzip') || enc === 'x-gzip') body = zlib.gunzipSync(wire);
              else if (enc.includes('br')) body = zlib.brotliDecompressSync(wire);
              else if (enc.includes('deflate')) {
                try {
                  body = zlib.inflateSync(wire);
                } catch {
                  body = zlib.inflateRawSync(wire);
                }
              }
              if (body.length > maxBytes * 8) {
                reject(
                  new HttpRequestError({
                    kind: 'RESPONSE_TOO_LARGE',
                    message: `The decompressed response from ${hostname} exceeded the size limit.`,
                  }),
                );
                return;
              }
            } catch {
              // leave body compressed if we cannot decode it; text parse will likely fail downstream
            }
          }
          const decoded = decodeBody(body, res.headers as HeaderBag);
          const tls = (res.socket as (net.Socket & { getProtocol?: () => string | null; getCipher?: () => { name: string } | null; getPeerCertificate?: (detailed?: boolean) => Record<string, unknown> | null }) | null) ?? null;
          let cert: HttpResponse['tls']['certificate'] = null;
          let protocol: string | null = null;
          let cipher: string | null = null;
          try {
            protocol = tls?.getProtocol?.() ?? null;
            const c = tls?.getCipher?.();
            cipher = c?.name ?? null;
            const peer = tls?.getPeerCertificate?.(false) ?? null;
            if (peer && typeof peer === 'object' && Object.keys(peer).length > 0) {
              cert = {
                subject: (peer.subject as Record<string, string>) ?? null,
                issuer: (peer.issuer as Record<string, string>) ?? null,
                validFrom: (peer.valid_from as string) ?? null,
                validTo: (peer.valid_to as string) ?? null,
                fingerprint: (peer.fingerprint256 as string) ?? null,
                authority: (peer.issuerCertificate ? true : null) as boolean | null,
              };
            }
          } catch {
            /* TLS inspection is best-effort */
          }
          timings.totalMs = Date.now() - started;
          if (total > 0 && total > maxBytes) {
            // Content-Length lied or is too large: treat as too large only if body truncated is impossible; we streamed up to cap.
          }
          resolve({
            statusCode: res.statusCode ?? 0,
            statusMessage: res.statusMessage ?? '',
            headers: res.headers as HeaderBag,
            body,
            text: decoded,
            finalUrl: url.toString(),
            redirectChain: [],
            sizeBytes: wire.length,
            httpVersion: `HTTP/${res.httpVersion}`,
            tls: { protocol, cipher, certificate: cert },
            timings: { ...timings, totalMs: Date.now() - started },
          });
        });
      });

      req.on('timeout', () => {
        req.destroy(new HttpRequestError({ kind: 'TIMEOUT', message: `Request to ${hostname} timed out after ${Math.round(timeoutMs / 1000)}s.` }));
      });
      req.on('error', (err) => {
        const info = mapNodeError(err as NodeJS.ErrnoException, hostname);
        if (info.kind === 'CONNECTION' && addrIndex + 1 < addresses.length) {
          currentAddress = addresses[++addrIndex];
          if (!settled) {
            timings.connectMs = Date.now() - started;
            attempt();
          }
          return;
        }
        fail(err);
      });
      req.on('socket', (socket) => {
        socket.on('secureConnect', () => {
          timings.tlsMs = Date.now() - connectAt;
          timings.connectMs = Date.now() - connectAt;
        });
        socket.on('connect', () => {
          timings.connectMs = Date.now() - connectAt;
        });
      });
      req.end();
    };

    attempt();
  });
}

/**
 * Full fetch with SSRF validation + redirect handling.
 * Every hop is validated (shape + DNS + IP policy) before connecting.
 */
export async function safeFetch(rawUrl: string, opts: HttpFetchOptions = {}): Promise<HttpResponse> {
  const maxRedirects = opts.maxRedirects ?? 5;
  let currentUrl = rawUrl;
  const chain: string[] = [];
  let redirectCount = 0;
  let previousValidation: UrlValidation | undefined = opts.validation;

  for (;;) {
    const validation = previousValidation ?? (await validateAuditTarget(currentUrl));
    if (!validation.ok || !validation.url || !validation.addresses) {
      throw new HttpRequestError({
        kind: 'INVALID_TARGET',
        message: validation.message ?? 'This target is not allowed.',
      });
    }
    const res = await rawRequest(validation.url, validation.addresses, { ...opts, validation });
    const status = res.statusCode;

    if (status >= 300 && status < 400 && res.headers.location) {
      const loc = Array.isArray(res.headers.location) ? res.headers.location[0] : res.headers.location;
      if (redirectCount >= maxRedirects) {
        throw new HttpRequestError({
          kind: 'REDIRECT_LIMIT',
          message: `The website redirected more than ${maxRedirects} times.`,
        });
      }
      let next: URL;
      try {
        next = new URL(loc, validation.url);
      } catch {
        throw new HttpRequestError({ kind: 'PROTOCOL', message: 'The website returned an invalid redirect.' });
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        throw new HttpRequestError({
          kind: 'INVALID_TARGET',
          message: `Redirect to unsupported protocol "${next.protocol}" blocked.`,
        });
      }
      chain.push(validation.url.toString());
      currentUrl = next.toString();
      redirectCount += 1;
      previousValidation = undefined;
      continue;
    }
    res.redirectChain = chain;
    res.finalUrl = validation.url.toString();
    if (status >= 400 && !opts.allowErrorStatus) {
      throw new HttpRequestError(
        { kind: 'BLOCKED', message: `The server responded with HTTP ${status}.` },
        status,
      );
    }
    return res;
  }
}

export const hasHeader = (headers: HeaderBag, name: string): string | null => pickHeader(headers, name);
export const headerValue = pickHeader;
