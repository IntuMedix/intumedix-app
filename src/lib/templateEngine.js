/**
 * IntuMedix App - Template Engine
 * Renders IntuMedix HTML templates with card data injected
 */

// Cache for loaded template files
let frontTemplateCache = null;
let backTemplateCache = null;
let cssCache = null;

export async function loadTemplates() {
  if (!frontTemplateCache) {
    const [front, back, css] = await Promise.all([
      fetch('./templates/intumedix-front.html').then(r => r.text()),
      fetch('./templates/intumedix-back.html').then(r => r.text()),
      fetch('./templates/intumedix.css').then(r => r.text()),
    ]);
    frontTemplateCache = front;
    backTemplateCache = back;
    cssCache = css;
  }
  return { front: frontTemplateCache, back: backTemplateCache, css: cssCache };
}

/**
 * Render a card template with field data injected
 * @param {string} side - 'front' | 'back'
 * @param {Object} fields - card field values
 * @param {Object} options - extra options (notes, errorCount, etc.)
 * @returns {string} complete HTML document string
 */
export async function renderCard(side, fields, options = {}) {
  const { front, back, css } = await loadTemplates();
  
  let template = side === 'front' ? front : back;
  
  // Replace Anki {{field}} mustache tokens
  template = injectFields(template, fields);
  
  // Replace Anki {{#field}} conditional blocks
  template = processConditionals(template, fields);
  
  // Build full HTML document
  const html = buildHtmlDocument(template, css, fields, options, side);
  
  return html;
}

/**
 * Inject field values into {{FieldName}} tokens
 */
function injectFields(template, fields) {
  return template.replace(/\{\{([^}#\/]+)\}\}/g, (match, fieldName) => {
    const name = fieldName.trim();
    return fields[name] !== undefined ? (fields[name] || '') : '';
  });
}

/**
 * Process {{#field}}...{{/field}} conditional blocks
 */
function processConditionals(template, fields) {
  // Show blocks where field has value
  template = template.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, fieldName, content) => {
    const val = fields[fieldName.trim()];
    return (val && val.toString().trim()) ? content : '';
  });
  
  // Hide blocks where field is empty ({{^field}})
  template = template.replace(/\{\{\^([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, fieldName, content) => {
    const val = fields[fieldName.trim()];
    return (!val || !val.toString().trim()) ? content : '';
  });
  
  return template;
}

/**
 * Build a complete self-contained HTML document
 */
function buildHtmlDocument(template, css, fields, options, side) {
  const { notes = '', errorCount = 0, savedFolder = '' } = options;
  
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IntuMedix Card</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    ${css}
    body { margin: 0; padding: 0; background: transparent; font-family: 'Inter', 'Cairo', sans-serif; }
    /* IntuMedix App specific overrides */
    .tg-header { position: sticky; top: 0; z-index: 100; }
  </style>
</head>
<body>
  ${template}
  <script>
    // Inject saved state
    window.__INTUMEDIX_NOTES__ = ${JSON.stringify(notes)};
    window.__INTUMEDIX_ERRORS__ = ${errorCount};
    window.__INTUMEDIX_SIDE__ = '${side}';
    window.__INTUMEDIX_SAVED_FOLDER__ = ${JSON.stringify(savedFolder)};
    
    // Bridge: send messages to React parent
    function sendToParent(type, data) {
      window.parent && window.parent.postMessage({ type, data, from: 'intumedix-card' }, '*');
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type, data }));
    }
    
    // Override pycmd to use our bridge
    function pycmd(cmd) {
      sendToParent('pycmd', cmd);
    }
    
    // Restore notes from saved state
    document.addEventListener('DOMContentLoaded', function() {
      if (window.__INTUMEDIX_NOTES__) {
        const ta = document.getElementById('notesTextarea');
        if (ta) ta.innerHTML = window.__INTUMEDIX_NOTES__;
        const display = document.getElementById('personalNotesDisplayText');
        if (display) display.innerHTML = window.__INTUMEDIX_NOTES__;
      }
      if (window.__INTUMEDIX_ERRORS__ > 0) {
        const el = document.getElementById('errorCountDisplay');
        const big = document.getElementById('errorBigNum');
        if (el) el.textContent = window.__INTUMEDIX_ERRORS__;
        if (big) big.textContent = window.__INTUMEDIX_ERRORS__;
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Create a blob URL from rendered card HTML
 */
export async function renderCardToBlob(side, fields, options = {}) {
  const html = await renderCard(side, fields, options);
  const blob = new Blob([html], { type: 'text/html' });
  return URL.createObjectURL(blob);
}
