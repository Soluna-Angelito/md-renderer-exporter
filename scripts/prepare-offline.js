// scripts/prepare-offline.js — Download CDN assets, Google Fonts, and Chromium for offline/airgapped use
'use strict';

const https = require('https');
const http  = require('http');
const path  = require('path');
const fs    = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..');
const VENDOR_DIR   = path.join(PROJECT_ROOT, 'vendor');

const SKIP_CHROMIUM = process.argv.includes('--skip-chromium');

// ─── CDN assets to mirror locally ───

const CDN_ASSETS = [
  { url: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',                dest: 'katex/katex.min.css' },
  { url: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js',                 dest: 'katex/katex.min.js' },
  { url: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js',   dest: 'katex/contrib/auto-render.min.js' },
  { url: 'https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.umd.js',                 dest: 'marked/marked.umd.js' },
  { url: 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js',  dest: 'hljs/highlight.min.js' },
  { url: 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css', dest: 'hljs/styles/github-dark.min.css' },
  { url: 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css',      dest: 'hljs/styles/github.min.css' },
];

const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Merriweather:ital,wght@0,400;0,700;1,400&display=swap';

const KATEX_CDN_BASE = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/';

// ─── HTTP helper (follows redirects, supports custom headers) ───

function httpGet(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        ...extraHeaders,
      },
    };

    client.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirect = new URL(res.headers.location, url).href;
        res.resume();
        return httpGet(redirect, extraHeaders).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function downloadFile(url, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  return httpGet(url).then((data) => {
    fs.writeFileSync(destPath, data);
    return data;
  });
}

// ─── Step 1: CDN assets ───

async function downloadCdnAssets() {
  console.log('\n[1/4] Downloading CDN assets...');
  for (const asset of CDN_ASSETS) {
    process.stdout.write(`  ${asset.dest} ... `);
    await downloadFile(asset.url, path.join(VENDOR_DIR, asset.dest));
    console.log('ok');
  }
}

// ─── Step 2: KaTeX fonts (parsed from katex.min.css) ───

async function downloadKaTeXFonts() {
  console.log('\n[2/4] Downloading KaTeX fonts...');
  const cssPath = path.join(VENDOR_DIR, 'katex', 'katex.min.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  const fontRefs = new Set();
  const re = /url\((?:["']?)([^"')]+\.(?:woff2?|ttf|eot))(?:["']?)\)/g;
  let m;
  while ((m = re.exec(css)) !== null) fontRefs.add(m[1]);

  let count = 0;
  for (const ref of fontRefs) {
    const clean = ref.split('?')[0].split('#')[0];
    const fullUrl = new URL(clean, KATEX_CDN_BASE).href;
    const dest = path.join(VENDOR_DIR, 'katex', clean);
    process.stdout.write(`  ${path.basename(clean)} ... `);
    await downloadFile(fullUrl, dest);
    console.log('ok');
    count++;
  }
  console.log(`  ${count} font files downloaded.`);
}

// ─── Step 3: Google Fonts (CSS + woff2 files) ───

async function downloadGoogleFonts() {
  console.log('\n[3/4] Downloading Google Fonts...');

  const cssBuffer = await httpGet(GOOGLE_FONTS_URL);
  let cssText = cssBuffer.toString('utf8');

  const fontUrls = new Map();
  const re = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g;
  let m, idx = 0;
  while ((m = re.exec(cssText)) !== null) {
    const url = m[1];
    if (!fontUrls.has(url)) {
      const ext = url.includes('.woff2') ? '.woff2' : '.woff';
      fontUrls.set(url, `font-${idx++}${ext}`);
    }
  }

  const fontsDir = path.join(VENDOR_DIR, 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });

  for (const [url, filename] of fontUrls) {
    process.stdout.write(`  ${filename} ... `);
    const data = await httpGet(url);
    fs.writeFileSync(path.join(fontsDir, filename), data);
    console.log('ok');
  }

  for (const [url, filename] of fontUrls) {
    cssText = cssText.split(url).join(filename);
  }
  fs.writeFileSync(path.join(fontsDir, 'fonts.css'), cssText, 'utf8');
  console.log(`  fonts.css + ${fontUrls.size} font files downloaded.`);
}

// ─── Step 4: Chromium (via @puppeteer/browsers) ───

async function downloadChromium() {
  if (SKIP_CHROMIUM) {
    console.log('\n[4/4] Chromium download skipped (--skip-chromium).');
    return null;
  }
  console.log('\n[4/4] Downloading Chromium (this may take a few minutes)...');

  let puppeteerBrowsers;
  try {
    puppeteerBrowsers = require('@puppeteer/browsers');
  } catch {
    console.warn('  @puppeteer/browsers not found — run "npm install" first.');
    return null;
  }

  try {
    const { install, Browser, resolveBuildId, detectBrowserPlatform, computeExecutablePath } = puppeteerBrowsers;
    const platform = detectBrowserPlatform();
    const buildId  = await resolveBuildId(Browser.CHROME, platform, 'stable');
    const cacheDir = path.join(VENDOR_DIR, 'chromium');

    console.log(`  Platform: ${platform}, Build: ${buildId}`);

    await install({ cacheDir, browser: Browser.CHROME, buildId });

    const execPath = computeExecutablePath({ cacheDir, browser: Browser.CHROME, buildId });
    const relPath  = path.relative(PROJECT_ROOT, execPath);
    console.log(`  Installed: ${relPath}`);
    return relPath;
  } catch (err) {
    console.warn(`  Chromium download failed: ${err.message}`);
    console.warn('  PDF export will require a locally installed Chrome/Chromium.');
    return null;
  }
}

// ─── Generate manifest.json ───

function writeManifest(chromiumPath) {
  const manifest = {
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    chromiumPath: chromiumPath || null,
    urlMap: {},
  };

  for (const asset of CDN_ASSETS) {
    manifest.urlMap[asset.url] = `/vendor/${asset.dest}`;
  }
  manifest.urlMap[GOOGLE_FONTS_URL] = '/vendor/fonts/fonts.css';

  const manifestPath = path.join(VENDOR_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\nManifest written: ${path.relative(PROJECT_ROOT, manifestPath)}`);
}

// ─── Main ───

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   MD Renderer — Offline Asset Preparation    ║');
  console.log('╚══════════════════════════════════════════════╝');

  if (fs.existsSync(VENDOR_DIR)) {
    console.log('\nRemoving existing vendor/ directory...');
    fs.rmSync(VENDOR_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(VENDOR_DIR, { recursive: true });

  await downloadCdnAssets();
  await downloadKaTeXFonts();
  await downloadGoogleFonts();
  const chromiumPath = await downloadChromium();

  writeManifest(chromiumPath);

  console.log('\n════════════════════════════════════════════════');
  console.log('  Offline preparation complete!');
  console.log(`  Vendor directory: vendor/`);
  if (chromiumPath) console.log(`  Chromium:         ${chromiumPath}`);
  console.log('');
  console.log('  Start the server normally — offline mode is auto-detected.');
  console.log('  To revert to online mode, delete the vendor/ directory.');
  console.log('════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('\nPreparation failed:', err);
  process.exit(1);
});
