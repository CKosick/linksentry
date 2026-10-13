/**
 * LinkSentry URL Classification & Skip Rules
 *
 * Skip rules (on by default):
 * - mailto:, tel:, javascript:, data:, blob:, chrome:, about:, file:, and any non-http(s) schemes
 * - Anchor-only links ('#' or empty)
 * - Same-page anchors (resolving to current page URL ignoring fragment)
 */

const NON_HTTP_SCHEMES = new Set([
  'mailto:',
  'tel:',
  'javascript:',
  'data:',
  'blob:',
  'chrome:',
  'chrome-extension:',
  'edge:',
  'about:',
  'file:',
  'ftp:',
  'ws:',
  'wss:'
]);

/**
 * Normalizes URL and determines whether it should be skipped.
 * @param {string} rawHref - Raw href attribute from <a> tag
 * @param {string} pageUrl - Base URL of the page containing the link
 * @returns {{ isSkippable: boolean, reason?: string, resolvedUrl?: string, category?: string }}
 */
export function classifyUrl(rawHref, pageUrl) {
  if (rawHref === undefined || rawHref === null) {
    return { isSkippable: true, reason: 'missing-href', category: 'skipped' };
  }

  const trimmed = String(rawHref).trim();

  if (trimmed === '' || trimmed === '#') {
    return { isSkippable: true, reason: 'anchor-only', category: 'skipped' };
  }

  // Check scheme before full URL parsing (handles javascript:, mailto:, etc.)
  const lower = trimmed.toLowerCase();
  for (const scheme of NON_HTTP_SCHEMES) {
    if (lower.startsWith(scheme)) {
      return { isSkippable: true, reason: `scheme-${scheme.replace(':', '')}`, category: 'skipped' };
    }
  }

  // Handle same-page hash references like "#section"
  if (trimmed.startsWith('#')) {
    return { isSkippable: true, reason: 'same-page-anchor', category: 'skipped' };
  }

  // Resolve absolute URL against page base
  let resolved;
  try {
    resolved = new URL(trimmed, pageUrl);
  } catch {
    return { isSkippable: true, reason: 'invalid-url', category: 'skipped' };
  }

  // Check scheme of resolved URL
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    return { isSkippable: true, reason: `unsupported-protocol-${resolved.protocol}`, category: 'skipped' };
  }

  // Check if it's a same-page anchor via fully-resolved URL
  if (pageUrl) {
    try {
      const currentPage = new URL(pageUrl);
      const isSameHostAndPath =
        resolved.origin === currentPage.origin &&
        resolved.pathname === currentPage.pathname &&
        resolved.search === currentPage.search;

      if (isSameHostAndPath && resolved.hash) {
        return { isSkippable: true, reason: 'same-page-anchor', category: 'skipped', resolvedUrl: resolved.href };
      }
    } catch {
      // Ignore URL parsing errors for pageUrl fallback
    }
  }

  return {
    isSkippable: false,
    resolvedUrl: resolved.href
  };
}
