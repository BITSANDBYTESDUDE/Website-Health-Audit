import express from 'express';
import zlib from 'node:zlib';
import { config } from '../config';
import { log } from '../utils/log';

/**
 * Development-only sample website served on DEMO_SITE_PORT.
 *
 * A realistic small-business site with genuine, reproducible issues so a
 * full end-to-end audit can be demonstrated in offline sandboxes. When
 * SITEPULSE_ALLOW_PRIVATE_TARGETS=false (the default), the audit engine
 * refuses to scan it — the demo is opt-in.
 */

const PAGES: { path: string; title: string; description?: string; h1: string; body: string; canonical?: string; og?: boolean }[] = [
  {
    path: '/',
    title: 'Nordlicht Café & Coffee Roastery | Berlin',
    description: 'Specialty coffee roastery and café in Berlin Kreuzberg. Espresso, filter coffee and fresh pastries — roasted in-house since 2012.',
    h1: 'Small-batch specialty coffee, roasted in Berlin',
    body: `
      <p class="lead">Nordlicht is a neighbourhood café and micro-roastery in Kreuzberg. We roast every Monday and Thursday in small batches of 12&nbsp;kg or less, and we pull shots that taste like the harvest, not the roast date.</p>
      <p>Walk in for espresso, filter bar, or a pastry from our friends at <a href="https://www.example.com/pastry-supplier" rel="noopener">Kiez Bakery</a>. Our baristas host a free cupping every first Friday of the month.</p>
      <h2>This week's single origins</h2>
      <p>Two lots on the bar right now: a washed Yirgacheffe from the Worka cooperative and a natural-process Caturra from Finca San Jeronimo in Huila.</p>
      <h2>Roastery tours</h2>
      <p>See the roaster in action. Tours run Saturdays at 11:00 in German and 12:30 in English. <a href="/contact">Book a tour</a> — group size is limited to eight.</p>
      <p><img src="/img/bar.jpg" alt="Barista pouring latte art at Nordlicht" width="640" height="427" loading="lazy"></p>
      <p>Don't just take our word for it — <a href="/menu">see the current menu</a> or <a href="/about">read our story</a>.</p>
    `,
    canonical: 'https://nordlicht.example/',
    og: true,
  },
  {
    path: '/menu',
    title: 'Menu — Nordlicht Café',
    description: 'Espresso drinks, filter coffee and seasonal pastries at Nordlicht Café, Berlin Kreuzberg.',
    h1: 'Menu & prices',
    body: `
      <p>All drinks are available to stay, to go, or with oat / soy / lactose-free milk (no extra charge). Prices include the 19% German VAT.</p>
      <h2>Espresso bar</h2>
      <p>Espresso 2.60 · Double 3.20 · Flat white 4.00 · Cappuccino 3.80 · Cortado 3.40</p>
      <h2>Filter bar</h2>
      <p>V60 / Chemex / French press from 3.50. Ask the barista for today's brew recipe.</p>
      <h2>Something to eat</h2>
      <p>Butter croissant 2.80 · Cardamom bun 3.20 · Sourdough toast with house jam 4.50</p>
      <p><img src="/img/croissant.svg" alt="Cardamom bun on a ceramic plate"></p>
    `,
  },
  {
    path: '/about',
    title: 'About us — Nordlicht Café',
    h1: 'About Nordlicht',
    body: `
      <p>Nordlicht started in 2012 as a single espresso cart outside a Kreuzberg record shop. Today we roast on a 15&nbsp;kg Probat and serve around four hundred cups a week — still mostly to the same neighbourhood.</p>
      <h2>The team</h2>
      <p>Mira (founder, head roaster), Jonas (barista + fermentation experiments), and Pauli the shop dog.</p>
      <p><img src="/img/team.svg" alt=""></p>
    `,
  },
  {
    path: '/contact',
    title: 'Contact — Nordlicht Café',
    description: 'Find Nordlicht Café in Kreuzberg, Berlin. Opening hours, address and booking for roastery tours.',
    h1: 'Visit us',
    body: `
      <p>Adalbertstraße 32, 10999 Berlin — two minutes from U-Bhf Kottbusser Tor.</p>
      <h2>Opening hours</h2>
      <p>Mon–Fri 08:00–18:00 · Sat–Sun 09:00–19:00</p>
      <h2>Tour booking</h2>
      <p>Tell us when you would like to visit and how many people are in your group. We confirm by email within one working day.</p>
      <form action="/contact" method="post">
        <p><label>Your email <input type="email" name="email"></label></p>
        <p><label>Date <input type="date" name="date"></label></p>
        <p><label>Guests <input type="number" name="guests" value="2"></label></p>
        <p><button type="submit">Send request</button></p>
      </form>
    `,
  },
  {
    path: '/old-services',
    title: 'Old wholesale menu',
    h1: 'Wholesale (archived)',
    body: '<p>This page has been archived since 2023 — our wholesale programme is described on the <a href="/menu">menu page</a>.</p><p>Remember to remove this page and the links pointing to it.</p>',
  },
];

function layout(title: string, h1: string, body: string, description?: string): string {
  const canonical = description ? 'https://nordlicht.example/' : undefined;
  void canonical;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${description ? `<meta name="description" content="${description}">` : ''}
<meta property="og:site_name" content="Nordlicht Café">
<meta property="og:title" content="${title}">
<meta property="og:type" content="website">
${title.includes('Nordlicht Café &') ? '<meta property="og:image" content="/img/bar.jpg">' : ''}
<link rel="stylesheet" href="/css/site.css">
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
</head>
<body>
<header class="site-header">
  <a class="brand" href="/"><img src="/img/logo.svg" alt="Nordlicht logo"> Nordlicht</a>
  <nav aria-label="Main">
    <a href="/">Home</a>
    <a href="/menu">Menu</a>
    <a href="/about">About</a>
    <a href="/contact">Contact</a>
  </nav>
</header>
<main>
  <h1>${h1}</h1>
  ${body}
</main>
<footer>
  <p>Adalbertstraße 32 · 10999 Berlin · <a href="mailto:hallo@nordlicht.example">hallo@nordlicht.example</a></p>
  <p><a href="/old-menu">Old menu archive</a> · <a href="/old-services">Old wholesale page</a></p>
</footer>
</body>
</html>`;
}

export function buildDemoSiteApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send(`User-agent: *
Allow: /
Disallow: /old-services

Sitemap: http://127.0.0.1:${config.demo.port}/sitemap.xml
`);
  });

  app.get('/sitemap.xml', (_req, res) => {
    const urls = PAGES.map((p) => `  <url><loc>http://127.0.0.1:${config.demo.port}${p.path}</loc></url>`).join('\n');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
  });

  app.get('/css/site.css', (_req, res) => {
    res.type('text/css').send(`
      :root { color-scheme: light; }
      body { margin: 0; font-family: Georgia, serif; color: #1f2328; line-height: 1.6; }
      .site-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 24px; border-bottom: 1px solid #e5e0d8; background:#faf7f2; }
      .brand { display: flex; align-items: center; gap: 8px; font-weight: bold; text-decoration: none; color: #1f2328; }
      nav a { margin-left: 16px; color: #4a2f1d; text-decoration: none; }
      main { max-width: 720px; margin: 40px auto; padding: 0 20px; }
      h1 { font-size: 2rem; }
      .lead { font-size: 1.15rem; }
      footer { border-top: 1px solid #e5e0d8; margin-top: 60px; padding: 24px; text-align: center; font-size: .9rem; }
      img { max-width: 100%; height: auto; border-radius: 4px; }
      @media (max-width: 640px) { .site-header { flex-direction: column; gap: 8px; } nav a { margin: 0 10px; } }
    `);
  });

  app.get('/img/favicon.svg', (_req, res) => res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="12" fill="#3b2415"/><circle cx="32" cy="32" r="16" fill="#d9a05b"/></svg>'));
  app.get('/img/logo.svg', (_req, res) => res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="32"><text x="4" y="22" font-family="Georgia" font-size="20" fill="#3b2415">Nordlicht</text></svg>'));
  app.get('/img/croissant.svg', (_req, res) => res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#f5efe4"/><ellipse cx="320" cy="210" rx="180" ry="90" fill="#d9a05b"/><ellipse cx="280" cy="180" rx="60" ry="34" fill="#e9c07a"/><ellipse cx="360" cy="180" rx="60" ry="34" fill="#e9c07a"/></svg>'));
  app.get('/img/team.svg', (_req, res) => res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#eae3d6"/><circle cx="200" cy="170" r="60" fill="#8a6a4b"/><rect x="150" y="220" width="100" height="140" fill="#6b4f37"/><circle cx="430" cy="170" r="60" fill="#7a5a3c"/><rect x="380" y="220" width="100" height="140" fill="#5d4328"/></svg>'));

  // One deliberately heavy PNG so the demo shows a real image-weight finding.
  const heavyPng = createNoisyPng();
  app.get('/img/bar.jpg', (_req, res) => {
    res.type('image/png').set('content-type', 'image/png').send(heavyPng);
  });

  for (const page of PAGES) {
    app.get(page.path, (_req, res) => {
      if (page.path === '/old-services') {
        // intentionally served so crawlers can discover it (broken-ish legacy page)
      }
      const html = layout(page.title, page.h1, page.body, page.description);
      if (page.path === '/') {
        res.set('cache-control', 'public, max-age=60');
      }
      res.type('html').send(html);
    });
  }

  // /old-menu intentionally 404s to demonstrate broken-link detection
  app.get('/old-menu', (_req, res) => res.status(404).type('html').send('<h1>404 — old menu removed</h1>'));
  app.get('/missing', (_req, res) => res.status(404).type('html').send('<h1>404</h1>'));

  app.use((_req, res) => res.status(404).type('text/plain').send('Not found'));
  return app;
}

/** Deterministic ~350 KB PNG (valid header + pseudo-random scanline data). */
function createNoisyPng(): Buffer {
  const width = 900;
  const height = 900;
  // Minimal PNG: signature + IHDR + IDAT(zlib) + IEND using node zlib.
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  const raw = Buffer.alloc(height * (1 + width * 3));
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let row = 0; row < height; row += 1) {
    const off = row * (1 + width * 3);
    raw[off] = 0;
    for (let x = 0; x < width; x += 1) {
      const warm = 0.55 + 0.45 * Math.sin(x / 90 + row / 120);
      const base = Math.floor(80 + warm * 150);
      raw[off + 1 + x * 3] = Math.min(255, base + Math.floor(rnd() * 40 - 20));
      raw[off + 2 + x * 3] = Math.min(255, Math.floor(base * 0.72) + Math.floor(rnd() * 30 - 15));
      raw[off + 3 + x * 3] = Math.min(255, Math.floor(base * 0.55) + Math.floor(rnd() * 25 - 12));
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function logDemoInfo(): void {
  log.info(`demo site available at ${config.demo.url}`, { enabled: config.demo.enabled });
}
