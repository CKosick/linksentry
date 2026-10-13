/**
 * LinkSentry Background Service Worker (Manifest V3)
 *
 * Responsibilities:
 * - Performs cross-origin link checking using ConcurrencyLimiter and HEAD/GET fallback
 * - Survives ephemeral worker lifecycle via chrome.storage persistence
 * - Injects highlighter content scripts and CSS on demand via chrome.scripting
 * - Updates toolbar badge with broken link counts
 */

import { checkLink } from './link-checker.js';
import { ConcurrencyLimiter } from '../common/limiter.js';
import { DEFAULT_CONFIG } from '../common/config.js';

let limiter = new ConcurrencyLimiter({
  concurrency: DEFAULT_CONFIG.concurrency,
  perDomainDelayMs: DEFAULT_CONFIG.perDomainDelayMs
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('LinkSentry extension installed');
});

// Update config if modified in storage
chrome.storage.local.get('linksentry_config', (res) => {
  if (res?.linksentry_config) {
    const cfg = res.linksentry_config;
    limiter = new ConcurrencyLimiter({
      concurrency: cfg.concurrency || DEFAULT_CONFIG.concurrency,
      perDomainDelayMs: cfg.perDomainDelayMs !== undefined ? cfg.perDomainDelayMs : DEFAULT_CONFIG.perDomainDelayMs
    });
  }
});

/**
 * Ensures content script and styles are injected into the tab.
 * @param {number} tabId
 */
async function ensureInjected(tabId) {
  try {
    // Ping to see if already present
    await chrome.tabs.sendMessage(tabId, { action: 'GET_STATE' });
    return true;
  } catch {
    // Inject CSS first, then JS
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['src/content/highlighter.css']
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/content-script.js']
      });
      return true;
    } catch (injectErr) {
      console.warn('Script injection failed:', injectErr);
      return false;
    }
  }
}

/**
 * Updates extension badge based on scan results.
 * @param {number|undefined} tabId
 * @param {Object} counts
 * @param {boolean} isScanning
 */
async function updateBadge(tabId, counts, isScanning) {
  try {
    const target = tabId ? { tabId } : {};
    if (isScanning) {
      await chrome.action.setBadgeText({ text: '…', ...target });
      await chrome.action.setBadgeBackgroundColor({ color: '#3b82f6', ...target });
    } else if (counts?.broken > 0) {
      await chrome.action.setBadgeText({ text: String(counts.broken), ...target });
      await chrome.action.setBadgeBackgroundColor({ color: '#ef4444', ...target });
    } else if (counts?.good > 0) {
      await chrome.action.setBadgeText({ text: 'OK', ...target });
      await chrome.action.setBadgeBackgroundColor({ color: '#10b981', ...target });
    } else {
      await chrome.action.setBadgeText({ text: '', ...target });
    }
  } catch {}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  const tabId = sender.tab?.id || message.tabId;

  // Check batch of URLs scheduled through ConcurrencyLimiter
  if (message.action === 'CHECK_BATCH') {
    const urls = message.urls || [];
    const timeoutMs = message.timeoutMs || DEFAULT_CONFIG.timeoutMs;

    (async () => {
      try {
        const promises = urls.map(url => limiter.schedule(url, () => checkLink(url, { timeoutMs })));
        const results = await Promise.all(promises);
        sendResponse({ results });
      } catch (err) {
        sendResponse({ error: err.message, results: [] });
      }
    })();
    return true; // Keep message channel open for async response
  }

  // Inject content script on demand
  if (message.action === 'ENSURE_INJECTED') {
    (async () => {
      const ok = await ensureInjected(message.tabId);
      sendResponse({ success: ok });
    })();
    return true;
  }

  // Scan progress updates from content script
  if (message.action === 'SCAN_PROGRESS') {
    const state = message.state;
    if (tabId && state) {
      chrome.storage.local.set({
        [`linksentry_scan_${tabId}`]: state,
        linksentry_last_active_tab: tabId
      });
      updateBadge(tabId, state.counts, state.isScanning);
    }
    return false;
  }

  // Scan cleared
  if (message.action === 'SCAN_CLEARED') {
    if (tabId) {
      chrome.storage.local.remove([`linksentry_scan_${tabId}`]);
      updateBadge(tabId, null, false);
    }
    return false;
  }

  return false;
});
