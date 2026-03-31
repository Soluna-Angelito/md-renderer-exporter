// app.js — MD Renderer: Markdown + LaTeX → Rendered Preview → PDF

(function () {
  'use strict';

  // ─── DOM References ───
  const editor        = document.getElementById('editor');
  const preview       = document.getElementById('preview');
  const mainContent   = document.getElementById('mainContent');
  const resizer       = document.getElementById('resizer');
  const editorPane    = document.getElementById('editorPane');
  const previewPane   = document.getElementById('previewPane');
  const editorStats   = document.getElementById('editorStats');
  const statusCursor  = document.getElementById('statusCursor');
  const statusChars   = document.getElementById('statusChars');
  const statusFile    = document.getElementById('statusFile');
  const renderTime    = document.getElementById('renderTime');
  const themeToggle   = document.getElementById('themeToggle');
  const openFileBtn     = document.getElementById('openFileBtn');
  const saveGroup       = document.getElementById('saveGroup');
  const saveBtn         = document.getElementById('saveBtn');
  const saveDropdown    = document.getElementById('saveDropdown');
  const exportPdfBtn    = document.getElementById('exportPdf');
  const pdfExportGroup  = document.getElementById('pdfExportGroup');
  const pdfDropdown     = document.getElementById('pdfExportDropdown');
  const pdfOverlay      = document.getElementById('pdfOverlay');
  const toastContainer  = document.getElementById('toastContainer');
  const copyHtmlBtn     = document.getElementById('copyHtmlBtn');
  const viewToggle      = document.getElementById('viewToggle');
  const hljsThemeLink   = document.getElementById('hljs-theme');
  const editorHighlight = document.getElementById('editorHighlight');

  // ─── LaTeX Protection Tokens (null-byte delimited) ───
  const LATEX_TOKENS = {
    INLINE_BLOCK_PREFIX:  '\0LATEX_INLINE_',
    INLINE_BLOCK_SUFFIX:  '_END\0',
    DISPLAY_BLOCK_PREFIX: '\0LATEX_BLOCK_',
    DISPLAY_BLOCK_SUFFIX: '_END\0'
  };

  let currentFilePath = null;
  let currentFileBaseDir = null;
  let isFileDialogOpen = false;

  // ─── Marked.js Configuration ───
  const renderer = new marked.Renderer();
  renderer.code = function (codeObj) {
    const code = typeof codeObj === 'object' ? codeObj.text : codeObj;
    const lang = typeof codeObj === 'object' ? codeObj.lang : arguments[1];
    let highlighted;
    if (lang && hljs.getLanguage(lang)) {
      try { highlighted = hljs.highlight(code, { language: lang }).value; }
      catch (_) { highlighted = escapeHtml(code); }
    } else {
      try { highlighted = hljs.highlightAuto(code).value; }
      catch (_) { highlighted = escapeHtml(code); }
    }
    const langClass = lang ? ` class="language-${lang}"` : '';
    return `<pre><code${langClass}>${highlighted}</code></pre>`;
  };

  renderer.image = function (hrefOrToken, title, text) {
    const token = (hrefOrToken && typeof hrefOrToken === 'object') ? hrefOrToken : null;
    const rawHref = token ? token.href : hrefOrToken;
    const rawTitle = token ? token.title : title;
    const rawAlt = token ? (token.text || token.alt || '') : (text || '');

    const resolvedHref = resolveImageSource(rawHref || '');
    const safeHref = escapeHtml(resolvedHref);
    const safeAlt = escapeHtml(rawAlt);
    const titleAttr = rawTitle ? ` title="${escapeHtml(rawTitle)}"` : '';

    return `<img src="${safeHref}" alt="${safeAlt}"${titleAttr}>`;
  };

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Markdown Syntax Highlighting for Editor Overlay ───
  function hlSpan(cls, content) {
    return '<span class="' + cls + '">' + content + '</span>';
  }

  function highlightMarkdown(text) {
    if (!text) return '\n';
    const lines = text.split('\n');
    const out = [];
    let inFence = false;
    let fenceChar = '';
    let inMathBlock = false;

    for (let li = 0; li < lines.length; li++) {
      const raw = lines[li];
      const trimmed = raw.trimStart();

      if (!inMathBlock) {
        const fm = trimmed.match(/^(`{3,}|~{3,})/);
        if (fm) {
          if (!inFence) {
            inFence = true;
            fenceChar = fm[1][0];
            out.push(hlSpan('md-hl-code-fence', escapeHtml(raw)));
            continue;
          } else if (fm[1][0] === fenceChar) {
            inFence = false;
            fenceChar = '';
            out.push(hlSpan('md-hl-code-fence', escapeHtml(raw)));
            continue;
          }
        }
      }
      if (inFence) { out.push(hlSpan('md-hl-code-text', escapeHtml(raw))); continue; }

      if (trimmed === '$$' || trimmed === '\\[' || trimmed === '\\]') {
        if (trimmed === '$$') inMathBlock = !inMathBlock;
        else if (trimmed === '\\[') inMathBlock = true;
        else inMathBlock = false;
        out.push(hlSpan('md-hl-math-delim', escapeHtml(raw)));
        continue;
      }
      if (inMathBlock) { out.push(hlSpan('md-hl-math', escapeHtml(raw))); continue; }

      const hm = raw.match(/^(#{1,6}\s)(.*)/);
      if (hm) {
        out.push(hlSpan('md-hl-heading-marker', escapeHtml(hm[1])) + hlSpan('md-hl-heading', hlInline(hm[2])));
        continue;
      }

      if (/^\s*([-*_])\1{2,}\s*$/.test(raw)) {
        out.push(hlSpan('md-hl-hr', escapeHtml(raw)));
        continue;
      }

      const qm = raw.match(/^(\s*>+\s?)(.*)/);
      if (qm) {
        out.push(hlSpan('md-hl-quote-marker', escapeHtml(qm[1])) + hlInline(qm[2]));
        continue;
      }

      const um = raw.match(/^(\s*)([-*+]\s)(.*)/);
      if (um) {
        out.push(escapeHtml(um[1]) + hlSpan('md-hl-list-marker', escapeHtml(um[2])) + hlInline(um[3]));
        continue;
      }

      const om = raw.match(/^(\s*)(\d+\.\s)(.*)/);
      if (om) {
        out.push(escapeHtml(om[1]) + hlSpan('md-hl-list-marker', escapeHtml(om[2])) + hlInline(om[3]));
        continue;
      }

      out.push(hlInline(raw));
    }
    return out.join('\n');
  }

  function hlInline(text) {
    if (!text) return '';
    let result = '';
    let i = 0;
    const n = text.length;

    while (i < n) {
      if (text[i] === '`') {
        const end = text.indexOf('`', i + 1);
        if (end !== -1) {
          result += hlSpan('md-hl-code-punct', '`')
                  + hlSpan('md-hl-code-inline', escapeHtml(text.substring(i + 1, end)))
                  + hlSpan('md-hl-code-punct', '`');
          i = end + 1; continue;
        }
      }

      if (text[i] === '\\' && i + 1 < n) {
        if (text[i + 1] === '(') {
          const end = text.indexOf('\\)', i + 2);
          if (end !== -1) {
            result += hlSpan('md-hl-math-delim', escapeHtml('\\('))
                    + hlSpan('md-hl-math', escapeHtml(text.substring(i + 2, end)))
                    + hlSpan('md-hl-math-delim', escapeHtml('\\)'));
            i = end + 2; continue;
          }
        }
        if ('\\`*_{}[]()#+-.!$~>|'.includes(text[i + 1])) {
          result += escapeHtml(text.substring(i, i + 2));
          i += 2; continue;
        }
      }

      if (text[i] === '$' && text[i + 1] === '$') {
        const end = text.indexOf('$$', i + 2);
        if (end !== -1) {
          result += hlSpan('md-hl-math-delim', '$$')
                  + hlSpan('md-hl-math', escapeHtml(text.substring(i + 2, end)))
                  + hlSpan('md-hl-math-delim', '$$');
          i = end + 2; continue;
        }
      }

      if (text[i] === '$') {
        const end = text.indexOf('$', i + 1);
        if (end !== -1 && end > i + 1) {
          result += hlSpan('md-hl-math-delim', '$')
                  + hlSpan('md-hl-math', escapeHtml(text.substring(i + 1, end)))
                  + hlSpan('md-hl-math-delim', '$');
          i = end + 1; continue;
        }
      }

      if (text[i] === '~' && text[i + 1] === '~') {
        const end = text.indexOf('~~', i + 2);
        if (end !== -1 && end > i + 2) {
          result += hlSpan('md-hl-strike-punct', '~~')
                  + hlSpan('md-hl-strike', escapeHtml(text.substring(i + 2, end)))
                  + hlSpan('md-hl-strike-punct', '~~');
          i = end + 2; continue;
        }
      }

      if (text[i] === '*' && text[i + 1] === '*' && text[i + 2] === '*') {
        const end = text.indexOf('***', i + 3);
        if (end !== -1) {
          result += hlSpan('md-hl-bold-punct', '***')
                  + hlSpan('md-hl-bold-italic', escapeHtml(text.substring(i + 3, end)))
                  + hlSpan('md-hl-bold-punct', '***');
          i = end + 3; continue;
        }
      }

      if (text[i] === '*' && text[i + 1] === '*') {
        const end = text.indexOf('**', i + 2);
        if (end !== -1 && end > i + 2) {
          result += hlSpan('md-hl-bold-punct', '**')
                  + hlSpan('md-hl-bold', escapeHtml(text.substring(i + 2, end)))
                  + hlSpan('md-hl-bold-punct', '**');
          i = end + 2; continue;
        }
      }

      if (text[i] === '*') {
        let end = -1;
        for (let j = i + 1; j < n; j++) {
          if (text[j] === '*' && text[j + 1] !== '*' && text[j - 1] !== '*') {
            end = j; break;
          }
        }
        if (end !== -1 && end > i + 1) {
          result += hlSpan('md-hl-italic-punct', '*')
                  + hlSpan('md-hl-italic', escapeHtml(text.substring(i + 1, end)))
                  + hlSpan('md-hl-italic-punct', '*');
          i = end + 1; continue;
        }
      }

      if (text[i] === '!' && text[i + 1] === '[') {
        const be = text.indexOf(']', i + 2);
        if (be !== -1 && text[be + 1] === '(') {
          const pe = text.indexOf(')', be + 2);
          if (pe !== -1) {
            result += hlSpan('md-hl-image', escapeHtml(text.substring(i, pe + 1)));
            i = pe + 1; continue;
          }
        }
      }

      if (text[i] === '[') {
        const be = text.indexOf(']', i + 1);
        if (be !== -1 && text[be + 1] === '(') {
          const pe = text.indexOf(')', be + 2);
          if (pe !== -1) {
            result += hlSpan('md-hl-link-punct', '[')
                    + hlSpan('md-hl-link-text', escapeHtml(text.substring(i + 1, be)))
                    + hlSpan('md-hl-link-punct', '](')
                    + hlSpan('md-hl-link-url', escapeHtml(text.substring(be + 2, pe)))
                    + hlSpan('md-hl-link-punct', ')');
            i = pe + 1; continue;
          }
        }
      }

      result += escapeHtml(text[i]);
      i++;
    }
    return result;
  }

  function syncHighlight() {
    if (!editorHighlight) return;
    editorHighlight.innerHTML = highlightMarkdown(editor.value) + '\n';
  }

  marked.setOptions({
    gfm: true,
    breaks: false,
    pedantic: false,
    renderer: renderer
  });

  function isRemoteOrSpecialSource(src) {
    if (/^[a-zA-Z]:[\\/]/.test(src)) return false;
    return /^(?:[a-zA-Z][a-zA-Z\d+.-]*:|\/\/|#)/.test(src);
  }

  function resolveImageSource(src) {
    const raw = String(src || '').trim();
    if (!raw) return raw;
    if (!currentFileBaseDir) return raw;
    if (isRemoteOrSpecialSource(raw)) return raw;

    const origin = window.location.origin || '';
    const query = `baseDir=${encodeURIComponent(currentFileBaseDir)}&src=${encodeURIComponent(raw)}`;
    return `${origin}/api/local-file?${query}`;
  }

  // ─── Phase 1A: Extract Display Math Blocks ───
  function extractDisplayMathBlocks(text) {
    if (!text) return { text, blocks: [] };

    const blocks = [];
    let index = 0;

    function replaceDisplayMath(segment) {
      let result = segment;
      result = result.replace(/\\\[[\s\S]*?\\\]/g, (match) => {
        const content = match.slice(2, -2);
        const token = `${LATEX_TOKENS.DISPLAY_BLOCK_PREFIX}${index}${LATEX_TOKENS.DISPLAY_BLOCK_SUFFIX}`;
        blocks.push({ delimiter: '\\[', content });
        index += 1;
        return token;
      });
      result = result.replace(/\$\$[\s\S]*?\$\$/g, (match) => {
        const content = match.slice(2, -2);
        const token = `${LATEX_TOKENS.DISPLAY_BLOCK_PREFIX}${index}${LATEX_TOKENS.DISPLAY_BLOCK_SUFFIX}`;
        blocks.push({ delimiter: '$$', content });
        index += 1;
        return token;
      });
      return result;
    }

    function replaceDisplayMathOutsideInlineCode(segment) {
      const inlineCodeRegex = /`[^`\n]*`/g;
      let lastIdx = 0;
      let result = '';
      let m;
      while ((m = inlineCodeRegex.exec(segment))) {
        result += replaceDisplayMath(segment.slice(lastIdx, m.index));
        result += m[0];
        lastIdx = inlineCodeRegex.lastIndex;
      }
      result += replaceDisplayMath(segment.slice(lastIdx));
      return result;
    }

    const fenceRegex = /```[\s\S]*?```/g;
    let lastIdx = 0;
    let rebuilt = '';
    let m;
    while ((m = fenceRegex.exec(text))) {
      rebuilt += replaceDisplayMathOutsideInlineCode(text.slice(lastIdx, m.index));
      rebuilt += m[0];
      lastIdx = fenceRegex.lastIndex;
    }
    rebuilt += replaceDisplayMathOutsideInlineCode(text.slice(lastIdx));

    return { text: rebuilt, blocks };
  }

  // ─── Phase 1B: Extract Inline Math \(...\) ───
  function extractInlineMath(text) {
    if (!text) return { text, inlines: [] };

    const inlines = [];
    let index = 0;

    function replaceInlineMath(segment) {
      return segment.replace(/\\\([\s\S]*?\\\)/g, (match) => {
        const token = `${LATEX_TOKENS.INLINE_BLOCK_PREFIX}${index}${LATEX_TOKENS.INLINE_BLOCK_SUFFIX}`;
        inlines.push(match);
        index += 1;
        return token;
      });
    }

    function replaceOutsideInlineCode(segment) {
      const inlineCodeRegex = /`[^`\n]*`/g;
      let lastIdx = 0;
      let result = '';
      let m;
      while ((m = inlineCodeRegex.exec(segment))) {
        result += replaceInlineMath(segment.slice(lastIdx, m.index));
        result += m[0];
        lastIdx = inlineCodeRegex.lastIndex;
      }
      result += replaceInlineMath(segment.slice(lastIdx));
      return result;
    }

    const fenceRegex = /```[\s\S]*?```/g;
    let lastIdx = 0;
    let rebuilt = '';
    let m;
    while ((m = fenceRegex.exec(text))) {
      rebuilt += replaceOutsideInlineCode(text.slice(lastIdx, m.index));
      rebuilt += m[0];
      lastIdx = fenceRegex.lastIndex;
    }
    rebuilt += replaceOutsideInlineCode(text.slice(lastIdx));

    return { text: rebuilt, inlines };
  }

  // ─── Phase 3A: Restore Inline Math \(...\) ───
  function restoreInlineMath(html, inlines) {
    if (!html || !inlines.length) return html;
    return inlines.reduce((result, expr, idx) => {
      const token = `${LATEX_TOKENS.INLINE_BLOCK_PREFIX}${idx}${LATEX_TOKENS.INLINE_BLOCK_SUFFIX}`;
      return result.replace(new RegExp(escapeRegex(token), 'g'), expr);
    }, html);
  }

  // ─── Phase 3B: Restore Display Math Blocks ───
  function restoreDisplayMathBlocks(html, blocks) {
    if (!html || !blocks.length) return html;
    return blocks.reduce((result, block, idx) => {
      const token = `${LATEX_TOKENS.DISPLAY_BLOCK_PREFIX}${idx}${LATEX_TOKENS.DISPLAY_BLOCK_SUFFIX}`;
      const trimmed = block.content.trim();
      const restored = block.delimiter === '\\['
        ? `\\[\n${trimmed}\n\\]`
        : `$$\n${trimmed}\n$$`;
      return result.replace(new RegExp(escapeRegex(token), 'g'), restored);
    }, html);
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ─── Phase 4: KaTeX Rendering ───
  function applyKaTeX(element) {
    if (typeof window.renderMathInElement === 'function' && typeof katex !== 'undefined') {
      window.renderMathInElement(element, {
        delimiters: [
          { left: '$$',  right: '$$',  display: true },
          { left: '$',   right: '$',   display: false },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false,
        errorColor: '#cc0000'
      });
    }
  }

  // ─── Korean Markdown Bold Span Fixer ───
  /**
   * Fix Markdown bold spans where Korean particles/endings appear after closing **.
   * 
   * Transforms patterns like:
   *   **내용**으로  →  **내용으로**
   *   **"경계선"**이야  →  **"경계선"이야**
   * 
   * Moves Korean suffixes (particles, endings) that immediately follow a closing **
   * inside the bold span, which fixes rendering in Markdown parsers that require
   * word boundaries around emphasis markers.
   * 
   * O(n) single-pass state machine that respects fenced code blocks and inline code.
   */
  function fixKoreanBoldSpans(text) {
    if (!text) return text;

    function isKoreanSuffixChar(c) {
      const code = c.charCodeAt(0);
      if (code >= 0xAC00 && code <= 0xD7A3) return true;   // Hangul syllables (가-힣)
      if (code >= 0x3130 && code <= 0x318F) return true;    // Hangul Compatibility Jamo
      return false;
    }

    const ABSORBABLE_PUNCTUATION = new Set([',', '.', '!', '?', '…', ';', ':']);
    const OPENING_CONTEXT_CHARS = new Set(['(', '[', '{']);

    function extractKoreanSuffix(text, start) {
      let i = start;
      const n = text.length;
      while (i < n && isKoreanSuffixChar(text[i])) i++;
      if (i > start) {
        while (i < n && ABSORBABLE_PUNCTUATION.has(text[i])) i++;
      }
      return text.slice(start, i);
    }

    const result = [];
    let i = 0;
    const n = text.length;

    let inFencedCode = false;
    let fenceChar = '';
    let fenceLength = 0;
    let inInlineCode = false;
    let inlineBacktickCount = 0;

    while (i < n) {
      const atLineStart = (i === 0) || (text[i - 1] === '\n');

      if (atLineStart && !inInlineCode) {
        let wsEnd = i;
        while (wsEnd < n && (wsEnd - i) < 4 && (text[wsEnd] === ' ' || text[wsEnd] === '\t')) wsEnd++;

        if (wsEnd < n && (text[wsEnd] === '`' || text[wsEnd] === '~')) {
          const fc = text[wsEnd];
          let fenceEnd = wsEnd;
          while (fenceEnd < n && text[fenceEnd] === fc) fenceEnd++;
          const fl = fenceEnd - wsEnd;

          if (fl >= 3) {
            if (!inFencedCode) {
              inFencedCode = true;
              fenceChar = fc;
              fenceLength = fl;
            } else if (fc === fenceChar && fl >= fenceLength) {
              inFencedCode = false;
              fenceChar = '';
              fenceLength = 0;
            }

            let lineEnd = text.indexOf('\n', i);
            if (lineEnd === -1) {
              result.push(text.slice(i));
              i = n;
            } else {
              result.push(text.slice(i, lineEnd + 1));
              i = lineEnd + 1;
            }
            continue;
          }
        }
      }

      if (inFencedCode) { result.push(text[i]); i++; continue; }

      if (text[i] === '`') {
        const btStart = i;
        let btCount = 0;
        while (i < n && text[i] === '`') { btCount++; i++; }

        if (!inInlineCode) {
          inInlineCode = true;
          inlineBacktickCount = btCount;
        } else if (btCount === inlineBacktickCount) {
          inInlineCode = false;
          inlineBacktickCount = 0;
        }

        result.push(text.slice(btStart, i));
        continue;
      }

      if (inInlineCode) { result.push(text[i]); i++; continue; }

      if (i + 1 < n && text[i] === '*' && text[i + 1] === '*') {
        let isPotentialClosing = false;
        if (result.length > 0) {
          const lastPiece = result[result.length - 1];
          if (lastPiece && lastPiece.length > 0) {
            const lastChar = lastPiece[lastPiece.length - 1];
            if (!/[\s]/.test(lastChar) && !OPENING_CONTEXT_CHARS.has(lastChar)) {
              isPotentialClosing = true;
            }
          }
        }

        const suffix = extractKoreanSuffix(text, i + 2);

        if (isPotentialClosing && suffix) {
          result.push(suffix);
          result.push('**');
          i += 2 + suffix.length;
        } else {
          result.push('**');
          i += 2;
        }
        continue;
      }

      result.push(text[i]);
      i++;
    }

    return result.join('');
  }

  // ─── Full Render Pipeline ───
  function renderMarkdown(md) {
    if (!md || !md.trim()) return '';

    const displayExtraction = extractDisplayMathBlocks(md);
    let processed = displayExtraction.text;

    const inlineExtraction = extractInlineMath(processed);
    processed = inlineExtraction.text;

    processed = fixKoreanBoldSpans(processed);

    let html = marked.parse(processed);

    html = restoreInlineMath(html, inlineExtraction.inlines);
    html = restoreDisplayMathBlocks(html, displayExtraction.blocks);
    html = rewriteHtmlImageSources(html);

    return html;
  }

  function rewriteHtmlImageSources(html) {
    if (!html || !currentFileBaseDir) return html;

    const container = document.createElement('div');
    container.innerHTML = html;

    container.querySelectorAll('img').forEach((img) => {
      const rawSrc = img.getAttribute('src');
      if (!rawSrc) return;
      img.setAttribute('src', resolveImageSource(rawSrc));
    });

    return container.innerHTML;
  }

  // ─── Update Preview ───
  let renderTimer = null;
  function updatePreview() {
    syncHighlight();
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      const t0 = performance.now();
      const md = editor.value;
      const html = renderMarkdown(md);

      if (html) {
        preview.innerHTML = html;
        applyKaTeX(preview);
      } else {
        preview.innerHTML = `
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
              <polyline points="14,2 14,8 20,8"/>
            </svg>
            <p>Your rendered document will appear here</p>
          </div>`;
      }

      const elapsed = (performance.now() - t0).toFixed(1);
      renderTime.textContent = `Render: ${elapsed}ms`;

      updateStats(md);
      saveToStorage(md);
    }, 150);
  }

  // ─── Stats ───
  function updateStats(text) {
    const trimmed = text.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    const chars = text.length;
    editorStats.textContent = `${words} word${words !== 1 ? 's' : ''}`;
    statusChars.textContent = `${chars} character${chars !== 1 ? 's' : ''}`;
  }

  function updateCursorPos() {
    const val = editor.value;
    const pos = editor.selectionStart;
    const lines = val.substring(0, pos).split('\n');
    const ln = lines.length;
    const col = lines[lines.length - 1].length + 1;
    statusCursor.textContent = `Ln ${ln}, Col ${col}`;
  }

  function getBaseName(filePath) {
    const parts = String(filePath || '').split(/[\\/]/);
    return parts[parts.length - 1] || '';
  }

  function updateFileStatus() {
    if (!statusFile) return;
    if (!currentFilePath) {
      statusFile.textContent = 'File: Scratch';
      statusFile.title = '';
      return;
    }

    const fileName = getBaseName(currentFilePath);
    statusFile.textContent = `File: ${fileName}`;
    statusFile.title = currentFilePath;
  }

  // ─── LocalStorage Persistence ───
  const STORAGE_KEY = 'mdrenderer_content';
  const THEME_KEY = 'mdrenderer_theme';

  function saveToStorage(text) {
    try { localStorage.setItem(STORAGE_KEY, text); } catch (_) { /* quota */ }
  }

  function loadFromStorage() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
  }

  // ─── Theme ───
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    const hljsBase = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/';
    hljsThemeLink.href = theme === 'dark'
      ? hljsBase + 'github-dark.min.css'
      : hljsBase + 'github.min.css';
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'light' : 'dark');
  }

  // ─── View Mode ───
  function setViewMode(mode) {
    mainContent.classList.remove('view-editor', 'view-preview');
    if (mode === 'editor') mainContent.classList.add('view-editor');
    else if (mode === 'preview') mainContent.classList.add('view-preview');

    viewToggle.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === mode);
    });
  }

  // ─── Resizer ───
  function initResizer() {
    let isResizing = false;
    let startX, startLeftWidth;

    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startLeftWidth = editorPane.getBoundingClientRect().width;
      resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const dx = e.clientX - startX;
      const totalWidth = mainContent.getBoundingClientRect().width;
      const newLeftWidth = startLeftWidth + dx;
      const pct = (newLeftWidth / totalWidth) * 100;
      if (pct < 15 || pct > 85) return;
      editorPane.style.flex = `0 0 ${pct}%`;
      previewPane.style.flex = '1';
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  // ─── Toolbar Actions ───
  function wrapSelection(before, after) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.substring(start, end);
    const replacement = before + (selected || 'text') + (after || before);
    editor.focus();
    editor.selectionStart = start;
    editor.selectionEnd = end;
    document.execCommand('insertText', false, replacement);
    editor.selectionStart = start + before.length;
    editor.selectionEnd = start + before.length + (selected || 'text').length;
    updatePreview();
  }

  function insertAtCursor(text) {
    editor.focus();
    document.execCommand('insertText', false, text);
    updatePreview();
  }

  function prefixLine(prefix) {
    const start = editor.selectionStart;
    const lineStart = editor.value.lastIndexOf('\n', start - 1) + 1;
    editor.focus();
    editor.selectionStart = editor.selectionEnd = lineStart;
    document.execCommand('insertText', false, prefix);
    editor.selectionStart = editor.selectionEnd = start + prefix.length;
    updatePreview();
  }

  const toolbarActions = {
    bold:          () => wrapSelection('**', '**'),
    italic:        () => wrapSelection('*', '*'),
    strikethrough: () => wrapSelection('~~', '~~'),
    heading:       () => prefixLine('## '),
    ulist:         () => prefixLine('- '),
    olist:         () => prefixLine('1. '),
    quote:         () => prefixLine('> '),
    code:          () => wrapSelection('`', '`'),
    codeblock:     () => wrapSelection('\n```\n', '\n```\n'),
    link:          () => insertAtCursor('[link text](https://example.com)'),
    image:         () => insertAtCursor('![alt text](https://example.com/image.png)'),
    table:         () => insertAtCursor('\n| Header 1 | Header 2 | Header 3 |\n|----------|----------|----------|\n| Cell 1   | Cell 2   | Cell 3   |\n| Cell 4   | Cell 5   | Cell 6   |\n'),
    math:          () => wrapSelection('$', '$'),
    mathblock:     () => wrapSelection('\n$$\n', '\n$$\n'),
  };

  // ─── Keyboard Shortcuts ───
  const WRAP_PAIRS = { '*': '*', '`': '`', '(': ')', '[': ']', '$': '$', "'": "'", '"': '"' };
  const BRACKET_PAIRS = { '(': ')', '[': ']' };
  const QUOTE_PAIRS = { "'": "'", '"': '"' };
  const OVERTYPE_CHARS = new Set([')', ']', "'", '"']);
  const DELETE_PAIRS = { '(': ')', '[': ']', "'": "'", '"': '"', '`': '`' };

  editor.addEventListener('keydown', (e) => {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const hasSelection = start !== end;
    const text = editor.value;

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'b') { e.preventDefault(); toolbarActions.bold(); return; }
      if (e.key === 'i') { e.preventDefault(); toolbarActions.italic(); return; }
    }

    if (hasSelection && WRAP_PAIRS.hasOwnProperty(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const sel = text.substring(start, end);
      document.execCommand('insertText', false, e.key + sel + WRAP_PAIRS[e.key]);
      editor.selectionStart = start + 1;
      editor.selectionEnd = end + 1;
      updatePreview();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (hasSelection || e.shiftKey) {
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        let searchEnd = end;
        if (hasSelection && end > start && text[end - 1] === '\n') searchEnd = end - 1;
        const lineEnd = text.indexOf('\n', Math.max(searchEnd, start));
        const endPos = lineEnd === -1 ? text.length : lineEnd;
        const block = text.substring(lineStart, endPos);
        const lines = block.split('\n');

        let newLines;
        if (e.shiftKey) {
          newLines = lines.map(line => {
            if (line.startsWith('  ')) return line.substring(2);
            if (line.startsWith('\t')) return line.substring(1);
            if (line.startsWith(' ')) return line.substring(1);
            return line;
          });
        } else {
          newLines = lines.map(line => '  ' + line);
        }

        const newBlock = newLines.join('\n');
        editor.selectionStart = lineStart;
        editor.selectionEnd = endPos;
        document.execCommand('insertText', false, newBlock);
        editor.selectionStart = lineStart;
        editor.selectionEnd = lineStart + newBlock.length;
      } else {
        document.execCommand('insertText', false, '  ');
      }
      updatePreview();
      return;
    }

    if (!hasSelection) {
      const nextChar = text[start] || '';
      const prevChar = start > 0 ? text[start - 1] : '';

      if (OVERTYPE_CHARS.has(e.key) && nextChar === e.key) {
        e.preventDefault();
        editor.selectionStart = editor.selectionEnd = start + 1;
        return;
      }

      if (BRACKET_PAIRS[e.key]) {
        e.preventDefault();
        document.execCommand('insertText', false, e.key + BRACKET_PAIRS[e.key]);
        editor.selectionStart = editor.selectionEnd = start + 1;
        updatePreview();
        return;
      }

      if (QUOTE_PAIRS[e.key]) {
        const afterAlnum = prevChar && /[a-zA-Z0-9]/.test(prevChar);
        const nextSpecial = nextChar === '' || /[\s;:,.!?\)\]\}]/.test(nextChar);
        if (!afterAlnum && nextSpecial) {
          e.preventDefault();
          document.execCommand('insertText', false, e.key + QUOTE_PAIRS[e.key]);
          editor.selectionStart = editor.selectionEnd = start + 1;
          updatePreview();
          return;
        }
      }

      if (e.key === 'Backspace') {
        const pc = start > 0 ? text[start - 1] : '';
        if (DELETE_PAIRS[pc] === nextChar) {
          e.preventDefault();
          editor.selectionStart = start - 1;
          editor.selectionEnd = start + 1;
          document.execCommand('insertText', false, '');
          updatePreview();
          return;
        }
      }
    }
  });

  // ─── Global Shortcuts (Ctrl+S → Save, Ctrl+O → Open) ───
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.shiftKey ? saveFileAs() : saveFile();
      }
      else if (e.key === 'o') { e.preventDefault(); openMarkdownFile(); }
    }
  });

  // ─── PDF Export Dropdown ───
  function togglePdfDropdown(e) {
    e.stopPropagation();
    pdfExportGroup.classList.toggle('open');
    closeSaveDropdown();
  }

  function closePdfDropdown() {
    pdfExportGroup.classList.remove('open');
  }

  // ─── Save Dropdown ───
  function toggleSaveDropdown(e) {
    e.stopPropagation();
    saveGroup.classList.toggle('open');
    closePdfDropdown();
  }

  function closeSaveDropdown() {
    if (saveGroup) saveGroup.classList.remove('open');
  }

  function handleSaveOption(e) {
    const btn = e.target.closest('[data-save]');
    if (!btn) return;
    closeSaveDropdown();
    if (btn.dataset.save === 'save') saveFile();
    else if (btn.dataset.save === 'saveAs') saveFileAs();
  }

  document.addEventListener('click', (e) => {
    if (!pdfExportGroup.contains(e.target)) closePdfDropdown();
    if (saveGroup && !saveGroup.contains(e.target)) closeSaveDropdown();
  });

  async function openMarkdownFile() {
    if (isFileDialogOpen) return;
    isFileDialogOpen = true;
    try {
      const response = await fetch('/api/open-markdown', { method: 'POST' });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || `Server returned ${response.status}`);
      }

      const data = await response.json();
      if (data.canceled) return;

      if (typeof data.content !== 'string') {
        throw new Error('Invalid file payload.');
      }

      editor.value = data.content;
      currentFilePath = data.filePath || null;
      currentFileBaseDir = data.baseDir || null;
      updateFileStatus();
      updateCursorPos();
      updatePreview();

      const fileName = data.fileName || getBaseName(currentFilePath) || 'file';
      showToast(`Opened ${fileName}`, 'success');
    } catch (err) {
      console.error('Open file failed:', err);
      if (err.message === 'Failed to fetch') {
        showToast('Server not running. Start with "node server.js".', 'error');
      } else {
        showToast('Open file failed: ' + err.message, 'error');
      }
    } finally {
      isFileDialogOpen = false;
    }
  }

  // ─── Save File ───
  async function saveFile() {
    if (!currentFilePath) {
      return saveFileAs();
    }

    try {
      const response = await fetch('/api/save-markdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: currentFilePath, content: editor.value })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || `Server returned ${response.status}`);
      }

      const fileName = getBaseName(currentFilePath);
      showToast(`Saved ${fileName}`, 'success');
    } catch (err) {
      console.error('Save failed:', err);
      if (err.message === 'Failed to fetch') {
        showToast('Server not running. Start with "node server.js".', 'error');
      } else {
        showToast('Save failed: ' + err.message, 'error');
      }
    }
  }

  async function saveFileAs() {
    if (isFileDialogOpen) return;
    isFileDialogOpen = true;
    try {
      const defaultName = currentFilePath ? getBaseName(currentFilePath) : 'document.md';
      const response = await fetch('/api/save-markdown-as', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editor.value, defaultName })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || `Server returned ${response.status}`);
      }

      const data = await response.json();
      if (data.canceled) return;

      currentFilePath = data.filePath;
      currentFileBaseDir = data.baseDir;
      updateFileStatus();

      const fileName = getBaseName(currentFilePath);
      showToast(`Saved as ${fileName}`, 'success');
    } catch (err) {
      console.error('Save As failed:', err);
      if (err.message === 'Failed to fetch') {
        showToast('Server not running. Start with "node server.js".', 'error');
      } else {
        showToast('Save As failed: ' + err.message, 'error');
      }
    } finally {
      isFileDialogOpen = false;
    }
  }

  // ─── PDF Export: Browser Print (fallback) ───
  async function exportPdfPrint() {
    pdfOverlay.classList.add('visible');

    try {
      const html = renderMarkdown(editor.value);
      preview.innerHTML = html || `
        <div class="empty-state">
          <p>No content to export.</p>
        </div>`;
      applyKaTeX(preview);

      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }

      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      window.print();
      showToast('Print dialog opened. Enable "Background graphics" for best dark-theme colors.', 'success');
    } catch (err) {
      console.error('PDF export failed:', err);
      showToast('PDF export failed: ' + err.message, 'error');
    } finally {
      pdfOverlay.classList.remove('visible');
    }
  }

  // ─── PDF Export: Server-based (Puppeteer) ───
  async function exportPdfServer(mode = 'multi', format = 'a4') {
    pdfOverlay.classList.add('visible');
    const overlayText = pdfOverlay.querySelector('p');
    const originalText = overlayText.textContent;
    overlayText.textContent = mode === 'single'
      ? 'Generating single-page PDF...'
      : 'Generating multi-page PDF...';

    try {
      const html = renderMarkdown(editor.value);
      if (!html || !html.trim()) {
        showToast('No content to export.', 'error');
        return;
      }

      // Render to preview so KaTeX runs, then grab the output.
      preview.innerHTML = html;
      applyKaTeX(preview);

      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const renderedHtml = preview.innerHTML;
      const theme = document.documentElement.getAttribute('data-theme') || 'dark';

      const response = await fetch('/api/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: renderedHtml, theme, mode, format })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || `Server returned ${response.status}`);
      }

      const blob = await response.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = 'document.pdf';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      const label = mode === 'single' ? 'Single-page' : 'Multi-page';
      showToast(`${label} PDF downloaded successfully.`, 'success');
    } catch (err) {
      console.error('PDF export failed:', err);
      if (err.message === 'Failed to fetch') {
        showToast('Server not running. Start with "node server.js", or use Print (browser).', 'error');
      } else {
        showToast('PDF export failed: ' + err.message, 'error');
      }
    } finally {
      overlayText.textContent = originalText;
      pdfOverlay.classList.remove('visible');
    }
  }

  // ─── Dispatch PDF export from dropdown ───
  function handlePdfOption(e) {
    const btn = e.target.closest('.pdf-option');
    if (!btn) return;

    closePdfDropdown();

    const mode   = btn.dataset.mode;
    const format = btn.dataset.format || 'a4';

    if (mode === 'print') {
      exportPdfPrint();
    } else {
      exportPdfServer(mode, format);
    }
  }

  // ─── Copy HTML ───
  async function copyHtml() {
    const html = renderMarkdown(editor.value);
    try {
      await navigator.clipboard.writeText(html);
      showToast('HTML copied to clipboard', 'success');
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = html;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('HTML copied to clipboard', 'success');
    }
  }

  // ─── Toast Notifications ───
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
  }

  // ─── Sample Content ───
  function getSampleContent() {
    return `# Welcome to MD Renderer

A beautiful **Markdown + LaTeX** editor with live preview and PDF export.

---

## Features

- **Live Preview** — See your rendered document in real-time
- **LaTeX Equations** — Full KaTeX support with all delimiter styles
- **Syntax Highlighting** — Code blocks with language detection
- **PDF Export** — Save your rendered document as a high-quality PDF
- **Dark / Light Theme** — Toggle between themes for comfortable editing
- **Resizable Panes** — Drag the divider to adjust editor/preview ratio

---

## Mathematics

### Inline Math

Einstein's famous equation $E = mc^2$ changed our understanding of physics. The quadratic formula is $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$, and Euler's identity $e^{i\\pi} + 1 = 0$ connects five fundamental constants.

### Display Math

The Gaussian integral:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi}
$$

Maxwell's equations in differential form:

$$
\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}, \\quad
\\nabla \\cdot \\mathbf{B} = 0, \\quad
\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}, \\quad
\\nabla \\times \\mathbf{B} = \\mu_0 \\mathbf{J} + \\mu_0 \\varepsilon_0 \\frac{\\partial \\mathbf{E}}{\\partial t}
$$

The Schrödinger equation:

$$
i\\hbar \\frac{\\partial}{\\partial t} \\Psi(\\mathbf{r}, t) = \\hat{H} \\Psi(\\mathbf{r}, t)
$$

A matrix example:

$$
\\mathbf{A} = \\begin{pmatrix} a_{11} & a_{12} & \\cdots & a_{1n} \\\\ a_{21} & a_{22} & \\cdots & a_{2n} \\\\ \\vdots & \\vdots & \\ddots & \\vdots \\\\ a_{m1} & a_{m2} & \\cdots & a_{mn} \\end{pmatrix}
$$

### Using \\( ... \\) Delimiters

The binomial coefficient \\(\\binom{n}{k} = \\frac{n!}{k!(n-k)!}\\) counts the number of ways to choose \\(k\\) items from \\(n\\).

### Using \\[ ... \\] Delimiters

\\[
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
\\]

---

## Code Examples

### JavaScript

\`\`\`javascript
function fibonacci(n) {
  const memo = new Map();
  function fib(k) {
    if (k <= 1) return k;
    if (memo.has(k)) return memo.get(k);
    const result = fib(k - 1) + fib(k - 2);
    memo.set(k, result);
    return result;
  }
  return fib(n);
}
\`\`\`

### Python

\`\`\`python
import numpy as np

def gradient_descent(f, grad_f, x0, lr=0.01, epochs=1000):
    x = np.array(x0, dtype=float)
    for _ in range(epochs):
        x -= lr * grad_f(x)
    return x, f(x)
\`\`\`

---

## Tables

| Constant | Symbol | Value |
|----------|--------|-------|
| Speed of Light | $c$ | $3 \\times 10^8 \\, \\text{m/s}$ |
| Planck's Constant | $h$ | $6.626 \\times 10^{-34} \\, \\text{J·s}$ |
| Boltzmann's Constant | $k_B$ | $1.381 \\times 10^{-23} \\, \\text{J/K}$ |
| Gravitational Constant | $G$ | $6.674 \\times 10^{-11} \\, \\text{N·m}^2/\\text{kg}^2$ |

---

## Blockquotes

> *"The important thing is not to stop questioning. Curiosity has its own reason for existing."*
> — Albert Einstein

> **Note:** This editor supports all four LaTeX delimiter styles: \`$...$\`, \`$$...$$\`, \`\\(...\\)\`, and \`\\[...\\]\`.

---

## Task List

- [x] Markdown rendering
- [x] LaTeX equation support
- [x] Syntax highlighting
- [x] PDF export
- [x] Dark / Light theme
- [x] Resizable split panes

`;
  }

  // ─── Initialization ───
  function init() {
    const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
    setTheme(savedTheme);

    const savedContent = loadFromStorage();
    editor.value = savedContent !== null ? savedContent : getSampleContent();

    updateFileStatus();
    updatePreview();
    updateCursorPos();

    editor.addEventListener('input', updatePreview);
    editor.addEventListener('keyup', updateCursorPos);
    editor.addEventListener('click', updateCursorPos);
    editor.addEventListener('scroll', () => {
      if (editorHighlight) {
        editorHighlight.scrollTop = editor.scrollTop;
        editorHighlight.scrollLeft = editor.scrollLeft;
      }
    });

    themeToggle.addEventListener('click', toggleTheme);
    if (openFileBtn) openFileBtn.addEventListener('click', openMarkdownFile);
    if (saveBtn) saveBtn.addEventListener('click', toggleSaveDropdown);
    if (saveDropdown) saveDropdown.addEventListener('click', handleSaveOption);
    exportPdfBtn.addEventListener('click', togglePdfDropdown);
    pdfDropdown.addEventListener('click', handlePdfOption);
    copyHtmlBtn.addEventListener('click', copyHtml);

    viewToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.view-btn');
      if (btn) setViewMode(btn.dataset.view);
    });

    document.querySelectorAll('.tool-btn[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (toolbarActions[action]) toolbarActions[action]();
      });
    });

    initResizer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
