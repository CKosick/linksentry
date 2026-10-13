/**
 * LinkSentry Link Checking Engine
 *
 * Implements:
 * - HEAD request first with GET fallback on 405/501
 * - Per-link timeout via AbortController
 * - Preserves status code and categorizes accurately (good / broken / blocked / skipped)
 * - Safe network operations
 */

import { categorizeStatus, CATEGORIES } from '../common/categories.js';

/**
 * Checks a single HTTP/HTTPS URL.
 *
 * @param {string} url - Target URL to check
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=8000] - Request timeout in milliseconds
 * @returns {Promise<{
 *   url: string,
 *   statusCode: number|null,
 *   statusText: string,
 *   category: 'good'|'broken'|'blocked'|'skipped',
 *   redirected: boolean,
 *   finalUrl: string,
 *   errorType: string|null,
 *   errorMessage: string|null
 * }>}
 */
export async function checkLink(url, { timeoutMs = 8000 } = {}) {
  let controller = new AbortController();
  let timerId = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  try {
    let response;
    let methodUsed = 'HEAD';

    try {
      response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        cache: 'no-cache',
        redirect: 'follow'
      });
    } catch (headErr) {
      if (controller.signal.aborted) {
        throw headErr;
      }
      // If HEAD threw a network error that might be method-specific, fallback to GET
      methodUsed = 'GET';
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-cache',
        redirect: 'follow',
        headers: {
          'Range': 'bytes=0-1024' // Avoid downloading entire bodies
        }
      });
    }

    // Spec rule: HEAD requests first with a GET fallback when server refuses HEAD (405/501)
    if (response && (response.status === 405 || response.status === 501)) {
      methodUsed = 'GET';
      // Clear previous timer and reset for fallback GET
      clearTimeout(timerId);
      controller = new AbortController();
      timerId = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-cache',
        redirect: 'follow',
        headers: {
          'Range': 'bytes=0-1024'
        }
      });
    }

    clearTimeout(timerId);

    const statusCode = response.status;
    const statusText = response.statusText || String(statusCode);
    const category = categorizeStatus(statusCode);

    return {
      url,
      statusCode,
      statusText,
      category,
      redirected: response.redirected || false,
      finalUrl: response.url || url,
      methodUsed,
      errorType: null,
      errorMessage: null
    };
  } catch (err) {
    clearTimeout(timerId);

    const isTimeout = controller.signal.aborted || err.name === 'AbortError' || err.message === 'timeout';
    const errorType = isTimeout ? 'timeout' : 'network';
    const statusText = isTimeout ? 'Request timed out' : (err.message || 'Network / DNS failure');

    return {
      url,
      statusCode: null,
      statusText,
      category: CATEGORIES.BROKEN,
      redirected: false,
      finalUrl: url,
      errorType,
      errorMessage: err.message || String(err)
    };
  }
}
