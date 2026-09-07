import http, { type Server } from 'node:http';
import zlib from 'node:zlib';

/**
 * Offline test fixture website: a small configurable HTTP server with
 * deliberately flawed pages (missing meta description, empty titles,
 * missing alt, broken links, weak security headers, a heavy image, etc).
 */

export interface FixturePage {
  path: string;
  html: string;
}

export interface FixtureOptions {
  robotsTxt?: string;
  sitemapXml?: string;
  securityHeaders?: boolean;
  /** page path -> 4xx/5xx status code */
  errors?: Record<string, number>;
  imageBytes?: number;
}

const LAYOUT = (body: string, extraHead = ''): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test &amp; Fixture Shop</title>
<meta name="description" content="Fixture shop for SitePulse automated tests.">
${extraHead}
</head>
<body>
<header><nav aria-label="Main"><a href="/">Home</a><a href="/products">Products</a><a href="/about">About</a></nav></header>
<main>${body}</main>
<footer><a href="mailto:hello@fixture.test">Contact</a></footer>
</body>
</html>`;

export const FIXTURE_PAGES: Record<string, FixturePage> = {
  '/': {
    path: '/',
    html: LAYOUT(
      `<h1>Fixture shop — everything for automated audits</h1>
       <p>This is a stable fixture website used only inside automated tests.</p>
       <h2>Categories</h2>
       <p><a href="/products">Products</a> · <a href="/about">About us</a></p>
       <p><a href="/missing-page">This link is broken</a></p>
       <img src="/img/hero.png" alt="Fixture hero image">
       <img src="/img/decor.png">`,
      '<link rel="canonical" href="/">',
    ),
  },
  '/products': {
    path: '/products',
    html: LAYOUT(
      `<h1>Products</h1><p>Quality fixtures for testers since 2026.</p><h2>Bestsellers</h2>
       <p><a href="/products/widget">Widget</a></p><p><a href="/products/gadget">Gadget</a></p>`,
    ),
  },
  '/products/widget': {
    path: '/products/widget',
    html: LAYOUT(`<h1>Widget</h1><p>A fine widget.</p>`),
  },
  '/products/gadget': {
    path: '/products/gadget',
    html: LAYOUT(`<h1>Gadget</h1><p>A fine gadget.</p>`),
  },
  '/about': {
    path: '/about',
    html: LAYOUT(
      `<h1>About</h1><p>We make fixtures. Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
       <img src="/img/logo.png" alt="">`,
    ),
  },
  '/seo-poor': {
    path: '/seo-poor',
    html: `<!doctype html><html><head><meta charset="utf-8"></head><body><p>Page without title, description or headings.</p><img src="/img/decor.png"></body></html>`,
  },
  '/no-labels': {
    path: '/no-labels',
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>No labels</title></head>
      <body><main><h1>Form</h1><form><input type="text" placeholder="Name"><input type="email" placeholder="Email"><button>Send</button></form></main></body></html>`,
  },
};

export interface FixtureServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startFixtureServer(opts: FixtureOptions = {}): Promise<FixtureServer> {
  const pages = { ...FIXTURE_PAGES };
  const server: Server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture.test');
    const path = url.pathname;
    if (path === '/robots.txt') {
      const body = opts.robotsTxt ?? 'User-agent: *\nAllow: /\nDisallow: /private\n\nSitemap: /sitemap.xml\n';
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(body);
      return;
    }
    if (path === '/sitemap.xml') {
      const body =
        opts.sitemapXml ??
        '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
          Object.keys(pages).map((p) => `<url><loc>http://fixture.test${p}</loc></url>`).join('') +
          '</urlset>';
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(body);
      return;
    }
    if (path.startsWith('/img/')) {
      const size = opts.imageBytes ?? 24 * 1024;
      const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const filler = Buffer.alloc(Math.max(0, size - head.length), 0x5a);
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(head.length + filler.length) });
      res.end(Buffer.concat([head, filler]));
      return;
    }
    if (opts.errors && opts.errors[path]) {
      res.writeHead(opts.errors[path], { 'content-type': 'text/html' });
      res.end(`<h1>HTTP ${opts.errors[path]}</h1>`);
      return;
    }
    const page = pages[path] ?? pages[`${path}/`];
    if (!page) {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<h1>404 not found</h1>');
      return;
    }
    const headers: Record<string, string> = {
      'content-type': 'text/html; charset=utf-8',
      'content-encoding': 'gzip',
    };
    if (opts.securityHeaders) {
      headers['strict-transport-security'] = 'max-age=31536000';
      headers['content-security-policy'] = "default-src 'self'";
      headers['x-frame-options'] = 'SAMEORIGIN';
      headers['x-content-type-options'] = 'nosniff';
      headers['referrer-policy'] = 'strict-origin-when-cross-origin';
    }
    const gz = zlib.gzipSync(Buffer.from(page.html, 'utf8'));
    res.writeHead(200, headers);
    res.end(gz);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
