# MD Renderer

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Puppeteer](https://img.shields.io/badge/Puppeteer-24.x-40B5A4?logo=puppeteer&logoColor=white)](https://pptr.dev/)
[![Marked](https://img.shields.io/badge/Marked-12.x-black)](https://marked.js.org/)
[![KaTeX](https://img.shields.io/badge/KaTeX-0.16.x-6B54A3)](https://katex.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Cross--platform-0078D4?logo=windows&logoColor=white)](#prerequisites)

A local-first Markdown + LaTeX editor with live preview, syntax highlighting, and server-side PDF export — powered by Node.js, Puppeteer, and vanilla JavaScript.

## Features

- **Live Preview** — Real-time rendering as you type with debounced updates and render-time reporting
- **LaTeX Mathematics** — Full KaTeX support for all four delimiter styles: `$...$`, `$$...$$`, `\(...\)`, and `\[...\]`
- **Syntax Highlighting** — Fenced code blocks with automatic language detection via highlight.js
- **PDF Export** — Three output modes:
  - **Multi-page** (A4/Letter) — paginated with automatic page breaks
  - **Single-page** — one continuous page sized to fit the content
  - **Print (browser)** — native browser print dialog as a fallback
- **Dark / Light Theme** — Toggle between GitHub-inspired dark and light themes; PDF output respects the active theme
- **File I/O** — Open, Save, and Save As through native Windows file dialogs (PowerShell-backed)
- **Local Image Support** — Relative image paths from opened `.md` files are resolved and served by the backend
- **Resizable Panes** — Drag the divider to adjust the editor/preview split ratio
- **View Modes** — Split, editor-only, or preview-only layouts
- **Formatting Toolbar** — Bold, italic, strikethrough, headings, lists, blockquotes, code, links, images, tables, and math
- **Keyboard Shortcuts** — `Ctrl+B` (bold), `Ctrl+I` (italic), `Ctrl+S` (save), `Ctrl+Shift+S` (save as), `Ctrl+O` (open), `Tab` (indent)
- **Copy HTML** — Export the rendered HTML to clipboard with one click
- **Korean Bold-Span Fixer** — O(n) state machine that corrects bold-emphasis rendering when Korean particles follow closing `**`
- **LocalStorage Persistence** — Editor content is auto-saved to the browser and restored on reload

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js |
| Server | Express 4.x |
| PDF Engine | Puppeteer 24.x (headless Chromium) |
| Markdown | Marked.js 12.x (CDN) |
| Math | KaTeX 0.16.x (CDN) |
| Syntax | highlight.js 11.x (CDN) |
| Fonts | Inter, JetBrains Mono, Merriweather (Google Fonts) |
| Frontend | Vanilla JS, custom CSS with CSS custom properties |

## Prerequisites

- **Node.js** 18 or later
- **Windows** for native file dialogs (Open / Save As); all other features work cross-platform

## Getting Started

### Quick Start (Windows)

Double-click **`start.bat`** — it checks for Node.js, runs `npm install` on first launch, starts the server, and opens the app at [`http://localhost:8766`](http://localhost:8766).

### Manual Setup

```bash
# Clone the repository
git clone https://github.com/Soluna-Angelito/md-renderer-exporter.git
cd md-renderer-exporter

# Install dependencies
npm install

# Start the server
npm start
```

Open [`http://localhost:8766`](http://localhost:8766) in your browser.

### Stopping the Server

Press `Ctrl+C` in the terminal, or on Windows run **`stop.bat`** to kill the process listening on port 8766.

## Usage

1. **Write** Markdown and LaTeX in the left editor pane.
2. **Preview** the rendered output in the right pane (updates live).
3. **Open** an existing `.md` file with `Ctrl+O` or the folder icon — relative images from the file's directory are resolved automatically.
4. **Save** with `Ctrl+S` or **Save As** with `Ctrl+Shift+S`.
5. **Export PDF** via the dropdown button — choose multi-page, single-page, or browser print.
6. **Copy HTML** using the button in the preview header.

## API Reference

The Express server exposes a REST API used internally by the frontend. All endpoints are served from `http://localhost:8766`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/open-markdown` | Opens a native Windows file picker and returns the file content, path, and base directory. |
| `POST` | `/api/save-markdown` | Writes content to an existing file path. Body: `{ filePath, content }` |
| `POST` | `/api/save-markdown-as` | Opens a Save As dialog, then writes. Body: `{ content, defaultName }` |
| `GET`  | `/api/local-file` | Serves a local file for image resolution. Query: `baseDir`, `src` |
| `POST` | `/api/export-pdf` | Generates a PDF from rendered HTML. Body: `{ html, theme?, mode?, format? }` |
| `GET`  | `/api/health` | Health check — returns `{ ok: true }` |

### PDF Export Options

The `/api/export-pdf` endpoint accepts the following body parameters:

| Parameter | Values | Default | Description |
|-----------|--------|---------|-------------|
| `html` | string | — | Pre-rendered HTML content (required) |
| `theme` | `dark` \| `light` | `dark` | Color theme applied to the PDF |
| `mode` | `multi` \| `single` | `multi` | Multi-page (paginated A4/Letter) or single continuous page |
| `format` | `a4` \| `letter` | `a4` | Page format for multi-page mode; sets width for single-page mode |

## Project Structure

```
md-renderer/
├── server.js          # Express server — API routes, Puppeteer PDF pipeline, native dialogs
├── index.html         # Single-page app shell — toolbar, editor, preview, status bar
├── js/
│   └── app.js         # Client-side logic — Markdown/LaTeX pipeline, UI, API calls
├── css/
│   └── style.css      # Theming (dark/light), layout, Markdown body styles, print styles
├── package.json       # npm metadata and dependencies
├── start.bat          # Windows launcher — checks Node, installs deps, starts server
└── stop.bat           # Windows helper — kills process on port 8766
```

## Configuration

| Variable | Location | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | `server.js` / `process.env.PORT` | `8766` | HTTP server port |
| Body limit | `server.js` | `50mb` | Max JSON payload size for large documents |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+O` | Open file |
| `Tab` | Insert 2-space indent |

## License

This project is licensed under the [MIT License](LICENSE).
