import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const svgPath = path.join(rootDir, 'public', 'icon.svg');
const publicIconsDir = path.join(rootDir, 'public', 'icons');
const assetsDir = path.join(rootDir, 'assets');

// Foreground-only SVG (transparent background, 20% safe-zone padding built-in)
const foregroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="1024" height="1024" fill="none">
  <defs>
    <linearGradient id="windGrad" x1="96" y1="160" x2="416" y2="280" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#0284c7" />
    </linearGradient>
    <linearGradient id="waveGrad" x1="80" y1="330" x2="432" y2="410" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#2dd4bf" />
      <stop offset="100%" stop-color="#0ea5e9" />
    </linearGradient>
  </defs>
  <g transform="translate(51.2, 51.2) scale(0.8)">
    <circle cx="256" cy="256" r="196" stroke="#38bdf8" stroke-width="10" stroke-dasharray="16 28" stroke-linecap="round" opacity="0.7" />
    <line x1="256" y1="44" x2="256" y2="76" stroke="#38bdf8" stroke-width="12" stroke-linecap="round" />
    <polygon points="256,88 296,210 256,184 216,210" fill="#f59e0b" />
    <path
      d="M116 232 H332 C356 232 374 214 374 190 C374 168 356 150 334 150 C314 150 298 164 296 182"
      stroke="url(#windGrad)"
      stroke-width="24"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M100 286 H364 C390 286 410 266 410 240"
      stroke="#7dd3fc"
      stroke-width="20"
      stroke-linecap="round"
    />
    <path
      d="M108 356 C148 320 192 320 232 356 C272 392 316 392 356 356 C378 336 398 332 412 340"
      stroke="url(#waveGrad)"
      stroke-width="26"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <circle cx="256" cy="232" r="14" fill="#f8fafc" />
  </g>
</svg>`;

async function generateIcons() {
  await fs.mkdir(publicIconsDir, { recursive: true });
  await fs.mkdir(assetsDir, { recursive: true });

  const svgBuffer = await fs.readFile(svgPath);
  const fgBuffer = Buffer.from(foregroundSvg, 'utf-8');

  // 1. PWA standard 192x192 & 512x512 (both naming conventions supported)
  const pwa192 = await sharp(svgBuffer).resize(192, 192).png().toBuffer();
  await fs.writeFile(path.join(publicIconsDir, '192x192.png'), pwa192);
  await fs.writeFile(path.join(publicIconsDir, 'icon-192x192.png'), pwa192);

  const pwa512 = await sharp(svgBuffer).resize(512, 512).png().toBuffer();
  await fs.writeFile(path.join(publicIconsDir, '512x512.png'), pwa512);
  await fs.writeFile(path.join(publicIconsDir, 'icon-512x512.png'), pwa512);

  // 2. PWA maskable 512x512 with 20% safe zone (inner 308x308 centered on 512x512 #0f172a canvas)
  const inner308 = await sharp(fgBuffer).resize(410, 410).png().toBuffer();
  const maskable512 = await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 15, g: 23, b: 42, alpha: 1 },
    },
  })
    .composite([{ input: inner308, gravity: 'center' }])
    .png()
    .toBuffer();

  await fs.writeFile(path.join(publicIconsDir, 'maskable-512x512.png'), maskable512);
  await fs.writeFile(path.join(publicIconsDir, 'maskable-icon-512x512.png'), maskable512);

  // 3. Capacitor Android assets (1024x1024)
  await sharp(svgBuffer)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(assetsDir, 'icon-only.png'));

  await sharp(fgBuffer)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(assetsDir, 'icon-foreground.png'));

  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 15, g: 23, b: 42, alpha: 1 },
    },
  })
    .png()
    .toFile(path.join(assetsDir, 'icon-background.png'));

  console.log('[FieldCast] Icons generated successfully in public/icons/ and assets/');
}

generateIcons().catch((err) => {
  console.error('[FieldCast] Icon generation failed:', err);
  process.exit(1);
});
