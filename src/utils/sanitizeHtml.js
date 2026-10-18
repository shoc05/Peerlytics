// Sanitise student-written HTML before it is rendered with dangerouslySetInnerHTML (audit S3).
// A student can write any `html` into documents/{fileId} straight through the Firestore SDK,
// so nothing stored there is trusted. The allow-list matches what our TipTap editor produces
// (StarterKit, underline, text-align, highlight marks) plus the report card's <mark> badges.
// Images are not allowed: an <img> pointing at another site would leak the lecturer's IP.
import createDOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'div', 'span',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'sub', 'sup', 'mark',
  'code', 'pre', 'blockquote',
  'ul', 'ol', 'li',
  'a',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
];

// data-* attributes (inert, used by the highlight marks) stay allowed by DOMPurify's default.
const ALLOWED_ATTR = ['href', 'title', 'style', 'class', 'colspan', 'rowspan'];

// CSS that can fetch or run something: url(), legacy IE expression(), @import, behavior.
const UNSAFE_CSS = /url\s*\(|expression\s*\(|@import|behavior\s*:|javascript:/i;

/** Build a sanitiser for a given window (the browser's, or jsdom's in tests). */
export function makeSanitizer(win) {
  const purify = createDOMPurify(win);
  purify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName === 'style' && UNSAFE_CSS.test(data.attrValue)) data.keepAttr = false;
  });
  purify.addHook('afterSanitizeAttributes', (node) => {
    // Links open in a new tab without giving the new page a handle on ours.
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
  return (html) =>
    purify.sanitize(String(html ?? ''), {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ADD_ATTR: ['target', 'rel'],
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
    });
}

let browserSanitizer = null;

/** Sanitise HTML for rendering in the browser. Returns '' if there is no DOM. */
export function sanitizeHtml(html) {
  if (typeof window === 'undefined') return '';
  if (!browserSanitizer) browserSanitizer = makeSanitizer(window);
  return browserSanitizer(html);
}
