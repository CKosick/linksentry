/**
 * LinkSentry Status-to-Category Mapping
 *
 * Rules:
 * - good: final status 2xx/3xx after redirects (200-399)
 * - broken: 404, 410, 5xx, network error, DNS error, timeout
 * - blocked: 401, 403, 429 (site refused check; NOT proof link is broken)
 * - skipped: non-http(s), anchor-only, same-page anchor
 *
 * Always preserves raw status code and status text.
 */

export const CATEGORIES = Object.freeze({
  GOOD: 'good',
  BROKEN: 'broken',
  BLOCKED: 'blocked',
  SKIPPED: 'skipped'
});

/**
 * Maps an HTTP status code or error state to a result category.
 *
 * @param {number|null} statusCode - HTTP status code, or null if network error
 * @param {string|null} [errorType] - 'timeout' | 'network' | 'dns' | etc.
 * @returns {'good'|'broken'|'blocked'|'skipped'}
 */
export function categorizeStatus(statusCode, errorType = null) {
  if (errorType === 'skipped') {
    return CATEGORIES.SKIPPED;
  }

  if (errorType === 'timeout' || errorType === 'network' || errorType === 'dns') {
    return CATEGORIES.BROKEN;
  }

  if (typeof statusCode !== 'number' || isNaN(statusCode)) {
    return CATEGORIES.BROKEN;
  }

  // Blocked codes: 401 Unauthorized, 403 Forbidden, 429 Too Many Requests
  if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
    return CATEGORIES.BLOCKED;
  }

  // Good: 2xx Success, 3xx Redirection
  if (statusCode >= 200 && statusCode < 400) {
    return CATEGORIES.GOOD;
  }

  // Broken: 400, 404, 410, 5xx, etc.
  return CATEGORIES.BROKEN;
}

/**
 * Formats a display label for a category.
 * @param {string} category
 * @returns {string}
 */
export function formatCategoryLabel(category) {
  switch (category) {
    case CATEGORIES.GOOD: return 'Good';
    case CATEGORIES.BROKEN: return 'Broken';
    case CATEGORIES.BLOCKED: return 'Blocked';
    case CATEGORIES.SKIPPED: return 'Skipped';
    default: return 'Unknown';
  }
}
