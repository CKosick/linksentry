/**
 * LinkSentry Content Script
 *
 * Runs inside the inspected page:
 * - Collects and classifies all links on current page
 * - Orchestrates chunked link validation with background service worker
 * - Safely applies outline/box-shadow highlights via requestAnimationFrame
 * - Handles link focus / scrollIntoView requests from popup
 * - Implements complete restore / clear highlights action
 */

(() => {
  // Guard against multiple injections in the same frame
  if (window.__linksentry_initialized) {
    return;
  }
  window.__linksentry_initialized = true;

  const DEFAULT_CONFIG = Object.freeze({
    concurrency: 5,
    timeoutMs: 8000,
    perDomainDelayMs: 50,
    colors: {
      good: '#10b981',
      broken: '#ef4444',
      blocked: '#f59e0b'
    }
  });

  const NON_HTTP_SCHEMES = new Set([
    'mailto:', 'tel:', 'javascript:', 'data:', 'blob:', 'chrome:',
    'chrome-extension:', 'edge:', 'about:', 'file:', 'ftp:', 'ws:', 'wss:'
  ]);

  function classifyUrl(rawHref, pageUrl) {
    if (rawHref === undefined || rawHref === null) {
      return { isSkippable: true, reason: 'missing-href', category: 'skipped' };
    }
    const trimmed = String(rawHref).trim();
    if (trimmed === '' || trimmed === '#') {
      return { isSkippable: true, reason: 'anchor-only', category: 'skipped' };
    }
    const lower = trimmed.toLowerCase();
    for (const scheme of NON_HTTP_SCHEMES) {
      if (lower.startsWith(scheme)) {
        return { isSkippable: true, reason: `scheme-${scheme.replace(':', '')}`, category: 'skipped' };
      }
    }
    if (trimmed.startsWith('#')) {
      return { isSkippable: true, reason: 'same-page-anchor', category: 'skipped' };
    }
    let resolved;
    try {
      resolved = new URL(trimmed, pageUrl);
    } catch {
      return { isSkippable: true, reason: 'invalid-url', category: 'skipped' };
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return { isSkippable: true, reason: `unsupported-protocol-${resolved.protocol}`, category: 'skipped' };
    }
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
      } catch {}
    }
    return { isSkippable: false, resolvedUrl: resolved.href };
  }

  const BATCH_SIZE = 10;
  let currentScanState = null;
  let linkElementsMap = new Map();
  let focusedTimer = null;

  // Apply stored highlight colors
  try {
    chrome?.storage?.local?.get?.('linksentry_config', (res) => {
      const config = res?.linksentry_config || DEFAULT_CONFIG;
      if (config.colors) {
        applyHighlightColors(config.colors);
      }
    });
  } catch {}

  function applyHighlightColors(colors) {
    if (colors.good) document.documentElement.style.setProperty('--linksentry-good-color', colors.good);
    if (colors.broken) document.documentElement.style.setProperty('--linksentry-broken-color', colors.broken);
    if (colors.blocked) document.documentElement.style.setProperty('--linksentry-blocked-color', colors.blocked);
  }

  /**
   * Clears all in-page highlights and restores DOM cleanly.
   */
  function clearHighlights() {
    const highlighted = document.querySelectorAll('a[data-linksentry-id], a[data-linksentry-status], a[data-linksentry-focused]');
    for (const el of highlighted) {
      el.removeAttribute('data-linksentry-id');
      el.removeAttribute('data-linksentry-status');
      el.removeAttribute('data-linksentry-focused');
    }
    linkElementsMap.clear();
    currentScanState = null;

    try {
      chrome?.runtime?.sendMessage?.({
        action: 'SCAN_CLEARED',
        pageUrl: window.location.href
      })?.catch?.(() => {});
    } catch {}
  }

  /**
   * Scrolls to and highlights the target link element.
   * @param {string} linkId
   */
  function focusLink(linkId) {
    const prev = document.querySelector('a[data-linksentry-focused="true"]');
    if (prev) {
      prev.removeAttribute('data-linksentry-focused');
    }

    const el = linkElementsMap.get(linkId) || document.querySelector(`a[data-linksentry-id="${linkId}"]`);
    if (!el) return false;

    el.setAttribute('data-linksentry-focused', 'true');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try {
      el.focus({ preventScroll: true });
    } catch {}

    if (focusedTimer) clearTimeout(focusedTimer);
    focusedTimer = setTimeout(() => {
      el.removeAttribute('data-linksentry-focused');
    }, 4000);

    return true;
  }

  /**
   * Starts a full scan of links on the current page.
   */
  async function startScan() {
    clearHighlights();

    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const pageUrl = window.location.href;

    const items = [];
    const urlToElements = new Map();
    let skippedCount = 0;

    anchors.forEach((el, index) => {
      const rawHref = el.getAttribute('href');
      const text = el.textContent?.trim() || el.getAttribute('title') || rawHref || 'Link';
      const id = `ls-${index}`;

      el.setAttribute('data-linksentry-id', id);
      linkElementsMap.set(id, el);

      const classification = classifyUrl(rawHref, pageUrl);

      if (classification.isSkippable) {
        skippedCount++;
        items.push({
          id,
          rawHref,
          text,
          url: classification.resolvedUrl || rawHref,
          category: 'skipped',
          reason: classification.reason,
          statusCode: null,
          statusText: classification.reason || 'Skipped'
        });
      } else {
        const resolved = classification.resolvedUrl;
        items.push({
          id,
          rawHref,
          text,
          url: resolved,
          category: 'pending',
          statusCode: null,
          statusText: 'Pending'
        });

        if (!urlToElements.has(resolved)) {
          urlToElements.set(resolved, []);
        }
        urlToElements.get(resolved).push(id);
      }
    });

    const uniqueUrlsToCheck = Array.from(urlToElements.keys());

    currentScanState = {
      pageUrl,
      isScanning: true,
      totalLinks: items.length,
      uniqueUrlsTotal: uniqueUrlsToCheck.length,
      checkedUniqueUrls: 0,
      checkedCount: skippedCount,
      counts: {
        total: items.length,
        checked: skippedCount,
        good: 0,
        broken: 0,
        blocked: 0,
        skipped: skippedCount
      },
      items,
      brokenLinks: [],
      blockedLinks: []
    };

    // Broadcast initial state
    notifyScanProgress(currentScanState);

    // If no unique URLs to check over network, scan is complete
    if (uniqueUrlsToCheck.length === 0) {
      currentScanState.isScanning = false;
      notifyScanProgress(currentScanState);
      return currentScanState;
    }

    // Process URLs in batches to survive service worker lifecycle and stream progress
    for (let i = 0; i < uniqueUrlsToCheck.length; i += BATCH_SIZE) {
      const batchUrls = uniqueUrlsToCheck.slice(i, i + BATCH_SIZE);

      let batchResults = [];
      try {
        if (typeof window.__linksentry_batch_checker === 'function') {
          batchResults = await window.__linksentry_batch_checker(batchUrls);
        } else {
          const response = await chrome.runtime.sendMessage({
            action: 'CHECK_BATCH',
            urls: batchUrls
          });
          batchResults = response?.results || [];
        }
      } catch (err) {
        try {
          if (typeof window.__linksentry_batch_checker === 'function') {
            batchResults = await window.__linksentry_batch_checker(batchUrls);
          } else {
            const response = await chrome.runtime.sendMessage({
              action: 'CHECK_BATCH',
              urls: batchUrls
            });
            batchResults = response?.results || [];
          }
        } catch {
          batchResults = batchUrls.map(u => ({
            url: u,
            statusCode: null,
            statusText: 'Extension error',
            category: 'broken',
            errorType: 'network'
          }));
        }
      }

      // Apply batch results to DOM and state
      await applyBatchResults(batchResults, urlToElements);

      currentScanState.checkedUniqueUrls += batchUrls.length;
      notifyScanProgress(currentScanState);
    }

    currentScanState.isScanning = false;
    notifyScanProgress(currentScanState);
    return currentScanState;
  }

  /**
   * Applies results of a batch to DOM elements and accumulates state.
   */
  async function applyBatchResults(results, urlToElements) {
    const resultMap = new Map(results.map(r => [r.url, r]));

    await new Promise(resolve => {
      requestAnimationFrame(() => {
        for (const [url, elIds] of urlToElements) {
          const res = resultMap.get(url);
          if (!res) continue;

          for (const id of elIds) {
            const el = linkElementsMap.get(id);
            if (el) {
              el.setAttribute('data-linksentry-status', res.category);
            }

            const item = currentScanState.items.find(it => it.id === id);
            if (item && item.category === 'pending') {
              item.category = res.category;
              item.statusCode = res.statusCode;
              item.statusText = res.statusText;
              item.finalUrl = res.finalUrl;
              item.errorType = res.errorType;

              currentScanState.checkedCount++;
              currentScanState.counts.checked++;

              if (res.category === 'good') {
                currentScanState.counts.good++;
              } else if (res.category === 'broken') {
                currentScanState.counts.broken++;
                currentScanState.brokenLinks.push(item);
              } else if (res.category === 'blocked') {
                currentScanState.counts.blocked++;
                currentScanState.blockedLinks.push(item);
              }
            }
          }
        }
        resolve();
      });
    });
  }

  /**
   * Broadcasts scan progress to storage and popup.
   */
  function notifyScanProgress(state) {
    if (typeof window.__linksentry_on_progress === 'function') {
      try { window.__linksentry_on_progress(state); } catch {}
    }
    try {
      chrome.runtime.sendMessage({
        action: 'SCAN_PROGRESS',
        state
      }).catch(() => {});
    } catch {}
  }

  // Listen for control messages from popup or background
  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || !message.action) return false;

      if (message.action === 'START_SCAN') {
        startScan().then(res => sendResponse({ success: true, state: res }));
        return true; // Keep channel open for async response
      }

      if (message.action === 'CLEAR_HIGHLIGHTS') {
        clearHighlights();
        sendResponse({ success: true });
        return false;
      }

      if (message.action === 'GET_STATE') {
        sendResponse({ state: currentScanState });
        return false;
      }

      if (message.action === 'FOCUS_LINK') {
        const ok = focusLink(message.linkId);
        sendResponse({ success: ok });
        return false;
      }

      if (message.action === 'SET_COLORS') {
        if (message.colors) applyHighlightColors(message.colors);
        sendResponse({ success: true });
        return false;
      }

      return false;
    });
  }

  // Expose methods on window for programmatic control during browser testing
  window.__linksentry_scan = startScan;
  window.__linksentry_focus = focusLink;
  window.__linksentry_clear = clearHighlights;
})();
