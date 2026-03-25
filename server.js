// server.js — MD Renderer: Express + Puppeteer PDF export server
'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { execFile } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 8766;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function showWindowsOpenMarkdownDialog() {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    '$owner.ShowInTaskbar = $false',
    '$owner.Size = New-Object System.Drawing.Size(0,0)',
    '$owner.StartPosition = "Manual"',
    '$owner.Location = New-Object System.Drawing.Point(-9999,-9999)',
    '$owner.Show()',
    '$owner.BringToFront()',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    '$dialog.Title = "Open Markdown File"',
    '$dialog.Filter = "Markdown Files (*.md;*.markdown;*.txt)|*.md;*.markdown;*.txt|All Files (*.*)|*.*"',
    '$dialog.Multiselect = $false',
    '$result = $dialog.ShowDialog($owner)',
    '$owner.Close()',
    '$owner.Dispose()',
    'if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '  Write-Output $dialog.FileName',
    '}'
  ].join('; ');

  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-STA',
    '-Command',
    script
  ]);

  const selectedPath = (stdout || '').trim();
  return selectedPath || null;
}

async function showWindowsSaveMarkdownDialog(defaultName) {
  const safeName = String(defaultName || 'document.md').replace(/[`"$]/g, '');
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    '$owner.ShowInTaskbar = $false',
    '$owner.Size = New-Object System.Drawing.Size(0,0)',
    '$owner.StartPosition = "Manual"',
    '$owner.Location = New-Object System.Drawing.Point(-9999,-9999)',
    '$owner.Show()',
    '$owner.BringToFront()',
    '$dialog = New-Object System.Windows.Forms.SaveFileDialog',
    '$dialog.Title = "Save Markdown File"',
    '$dialog.Filter = "Markdown Files (*.md)|*.md|All Files (*.*)|*.*"',
    '$dialog.DefaultExt = "md"',
    `$dialog.FileName = "${safeName}"`,
    '$result = $dialog.ShowDialog($owner)',
    '$owner.Close()',
    '$owner.Dispose()',
    'if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '  Write-Output $dialog.FileName',
    '}'
  ].join('; ');

  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-STA',
    '-Command',
    script
  ]);

  const selectedPath = (stdout || '').trim();
  return selectedPath || null;
}

// ─── Lazy Puppeteer import (only loaded when first PDF is requested) ───
let puppeteer = null;
let browser   = null;

async function getPuppeteer() {
  if (!puppeteer) {
    puppeteer = require('puppeteer');
  }
  return puppeteer;
}

async function getBrowser() {
  const pup = await getPuppeteer();
  if (!browser || !browser.isConnected()) {
    browser = await pup.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browser;
}

// Graceful shutdown
async function closeBrowser() {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
process.on('SIGINT',  async () => { await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });

// ─── Read app CSS once at startup (re-read on each request in dev if needed) ───
function readAppCss() {
  return fs.readFileSync(path.join(__dirname, 'css', 'style.css'), 'utf8');
}

// ─── Build the standalone HTML that Puppeteer will render ───
function buildHtml(renderedHtml, theme) {
  const appCss    = readAppCss();
  const hljsTheme = theme === 'dark' ? 'github-dark' : 'github';

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="UTF-8">

  <!-- KaTeX CSS (for pre-rendered KaTeX spans) -->
  <link rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">

  <!-- highlight.js theme (for pre-highlighted code blocks) -->
  <link rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/${hljsTheme}.min.css">

  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Merriweather:ital,wght@0,400;0,700;1,400&display=swap"
        rel="stylesheet">

  <!-- App CSS (full) -->
  <style>${appCss}</style>

  <!-- Layout overrides for the PDF page
       Mirrors the @media print rules from style.css:
       - Puppeteer margin: 0 (no white page-level borders)
       - CSS padding: 12mm on .preview-content for spacing
       - box-decoration-break: clone  so padding + background repeat
         on EVERY page fragment (per-page top/bottom spacing) -->
  <style>
    html, body {
      height: auto !important;
      overflow: visible !important;
      background: var(--preview-bg) !important;
      color: var(--preview-text) !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .preview-content {
      max-width: none;
      margin: 0;
      padding: 12mm;
      -webkit-box-decoration-break: clone;
      box-decoration-break: clone;
      background: var(--preview-bg) !important;
    }
  </style>
</head>
<body>
  <article class="preview-content markdown-body">${renderedHtml}</article>
</body>
</html>`;
}

// Open local markdown + serve local files for relative image paths.
app.post('/api/open-markdown', async (_req, res) => {
  if (process.platform !== 'win32') {
    return res.status(501).json({ error: 'Native file picker is currently supported on Windows only.' });
  }

  try {
    const filePath = await showWindowsOpenMarkdownDialog();
    if (!filePath) {
      return res.json({ canceled: true });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    return res.json({
      canceled: false,
      filePath,
      fileName: path.basename(filePath),
      baseDir: path.dirname(filePath),
      content
    });
  } catch (err) {
    console.error('Open markdown failed:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Save markdown to an existing file path.
app.post('/api/save-markdown', (req, res) => {
  const { filePath, content } = req.body;

  if (!filePath) {
    return res.status(400).json({ error: 'No file path provided.' });
  }
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'No content provided.' });
  }

  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return res.json({ success: true });
  } catch (err) {
    console.error('Save failed:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Save As — open native save dialog, then write.
app.post('/api/save-markdown-as', async (req, res) => {
  if (process.platform !== 'win32') {
    return res.status(501).json({ error: 'Native file picker is currently supported on Windows only.' });
  }

  const { content, defaultName } = req.body;

  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'No content provided.' });
  }

  try {
    const filePath = await showWindowsSaveMarkdownDialog(defaultName);
    if (!filePath) {
      return res.json({ canceled: true });
    }

    fs.writeFileSync(filePath, content, 'utf8');
    return res.json({
      canceled: false,
      filePath,
      fileName: path.basename(filePath),
      baseDir: path.dirname(filePath)
    });
  } catch (err) {
    console.error('Save As failed:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/local-file', (req, res) => {
  const rawBaseDir = String(req.query.baseDir || '').trim();
  const rawSrc = String(req.query.src || '').trim();

  if (!rawBaseDir || !rawSrc) {
    return res.status(400).send('Missing baseDir or src query parameter.');
  }

  const isWindowsAbsolutePath = /^[a-zA-Z]:[\\/]/.test(rawSrc);
  if (!isWindowsAbsolutePath && /^(?:[a-zA-Z][a-zA-Z\d+.-]*:|\/\/)/.test(rawSrc)) {
    return res.status(400).send('Only local file paths are supported.');
  }

  const cleanSrc = rawSrc.split('#')[0].split('?')[0];
  const targetPath = path.isAbsolute(cleanSrc)
    ? path.normalize(cleanSrc)
    : path.resolve(rawBaseDir, cleanSrc);

  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    return res.status(404).send('File not found.');
  }

  return res.sendFile(targetPath, (err) => {
    if (!err) return;
    console.error('Failed to serve local file:', err);
    if (!res.headersSent) {
      res.status(err.statusCode || 500).send('Failed to read local file.');
    }
  });
});

// PDF export endpoint.
app.post('/api/export-pdf', async (req, res) => {
  const {
    html,
    theme  = 'dark',
    mode   = 'multi',
    format = 'a4'
  } = req.body;

  if (!html || !html.trim()) {
    return res.status(400).json({ error: 'No HTML content provided.' });
  }

  let page = null;
  try {
    const b = await getBrowser();
    page = await b.newPage();

    const fullHtml = buildHtml(html, theme);
    await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 30000 });

    // Use screen media so we get exact on-screen colours/backgrounds.
    await page.emulateMediaType('screen');

    // Wait for web fonts to finish loading inside Puppeteer.
    await page.evaluateHandle('document.fonts.ready');

    let pdfOptions;

    // Zero Puppeteer margins — spacing is handled by CSS padding so
    // the background colour fills the page edge-to-edge (no white borders).
    const zeroMargin = { top: '0', bottom: '0', left: '0', right: '0' };

    if (mode === 'single') {
      // Measure actual content height (the PDFCrowd "page_height: -1" technique).
      const contentHeight = await page.evaluate(() => {
        const el = document.querySelector('.preview-content');
        return el ? el.scrollHeight : document.body.scrollHeight;
      });

      const pageWidth = format === 'letter' ? '215.9mm' : '210mm';

      pdfOptions = {
        width:  pageWidth,
        height: `${contentHeight}px`,
        printBackground: true,
        margin: zeroMargin
      };
    } else {
      const pageFormat = format === 'letter' ? 'Letter' : 'A4';

      pdfOptions = {
        format: pageFormat,
        printBackground: true,
        margin: zeroMargin
      };
    }

    const pdfData = await page.pdf(pdfOptions);
    const pdfBuffer = Buffer.from(pdfData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="document.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF generation failed:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

// ─── Health check ───
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ─── Start ───
app.listen(PORT, () => {
  console.log(`MD Renderer server running at http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop.');
});
