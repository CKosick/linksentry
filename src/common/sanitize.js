/**
 * LinkSentry Safe DOM & Escaping Utilities
 *
 * RentReceipt lesson: Never inject page or link text into extension UI via
 * unescaped innerHTML. Link text and URLs are page-controlled data.
 */

/**
 * Escapes special HTML characters in arbitrary string.
 * @param {any} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Safely sets element text content.
 * @param {HTMLElement} el
 * @param {any} text
 */
export function safeSetText(el, text) {
  if (el) {
    el.textContent = text === null || text === undefined ? '' : String(text);
  }
}

/**
 * Creates an element and populates its attributes and text safely.
 * @param {string} tagName
 * @param {Record<string, string>} [attributes={}]
 * @param {string|Array<HTMLElement|string>} [children='']
 * @returns {HTMLElement}
 */
export function createElementSafe(tagName, attributes = {}, children = '') {
  const el = document.createElement(tagName);
  for (const [key, val] of Object.entries(attributes)) {
    if (val !== undefined && val !== null) {
      if (key === 'className') {
        el.className = val;
      } else if (key.startsWith('data-')) {
        el.setAttribute(key, val);
      } else if (key === 'title' || key === 'href' || key === 'id' || key === 'role' || key === 'tabIndex') {
        el.setAttribute(key, val);
      } else {
        el.setAttribute(key, val);
      }
    }
  }

  if (Array.isArray(children)) {
    for (const child of children) {
      if (typeof child === 'string') {
        el.appendChild(document.createTextNode(child));
      } else if (child instanceof Node) {
        el.appendChild(child);
      }
    }
  } else if (typeof children === 'string' && children.length > 0) {
    el.textContent = children;
  }

  return el;
}
