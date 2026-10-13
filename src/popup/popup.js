/**
 * LinkSentry Popup Logic
 *
 * Safe DOM rendering:
 * - Uses textContent and safe DOM construction — zero unescaped innerHTML
 * - Subscribes to live scan progress
 * - Supports one-click scan, focus on broken link, and clear highlights
 */

import { safeSetText, createElementSafe } from '../common/sanitize.js';

let activeTabId = null;

// DOM Elements
const btnScan = document.getElementById('btn-scan');
const scanBtnLabel = document.getElementById('scan-btn-label');
const btnClear = document.getElementById('btn-clear');

const progressContainer = document.getElementById('progress-container');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressText = document.getElementById('progress-text');
const progressPercent = document.getElementById('progress-percent');

const countTotal = document.getElementById('count-total');
const countChecked = document.getElementById('count-checked');
const countGood = document.getElementById('count-good');
const countBroken = document.getElementById('count-broken');
const countBlocked = document.getElementById('count-blocked');
const countSkipped = document.getElementById('count-skipped');

const tabBroken = document.getElementById('tab-broken');
const tabBlocked = document.getElementById('tab-blocked');
const tabBrokenCount = document.getElementById('tab-broken-count');
const tabBlockedCount = document.getElementById('tab-blocked-count');

const listBrokenPanel = document.getElementById('list-broken');
const listBlockedPanel = document.getElementById('list-blocked');
const brokenLinksUl = document.getElementById('broken-links-ul');
const blockedLinksUl = document.getElementById('blocked-links-ul');
const emptyBroken = document.getElementById('empty-broken');
const emptyBlocked = document.getElementById('empty-blocked');

/**
 * Initializes popup on load.
 */
async function init() {
  try {
    let tab = null;
    try {
      let tabs = await chrome?.tabs?.query?.({ active: true, currentWindow: true });
      tab = tabs && tabs.length > 0 ? tabs[0] : null;

      if (!tab || (tab.url && tab.url.startsWith('chrome-extension://'))) {
        const allTabs = await chrome?.tabs?.query?.({}) || [];
        tab = allTabs.find(t => t.url && (t.url.startsWith('http://') || t.url.startsWith('https://'))) || tab;
      }
    } catch {}

    if (tab) activeTabId = tab.id;

    setupEventListeners();

    // Check stored state
    if (activeTabId && chrome?.storage?.local) {
      const stored = await chrome.storage.local.get([`linksentry_scan_${activeTabId}`]);
      const scanState = stored?.[`linksentry_scan_${activeTabId}`];
      if (scanState) {
        renderState(scanState);
      }
    }
  } catch (err) {
    console.warn('Popup init warning:', err);
  }
}

// Expose render helper for testing
window.__linksentry_render = renderState;
window.__linksentry_reset = resetUI;

function setupEventListeners() {
  btnScan.addEventListener('click', triggerScan);
  btnClear.addEventListener('click', triggerClear);

  tabBroken.addEventListener('click', () => switchTab('broken'));
  tabBlocked.addEventListener('click', () => switchTab('blocked'));

  // Listen for progress messages
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === 'SCAN_PROGRESS' && message.state) {
      renderState(message.state);
    }
  });

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && activeTabId) {
      const key = `linksentry_scan_${activeTabId}`;
      if (changes[key]?.newValue) {
        renderState(changes[key].newValue);
      } else if (changes[key] && !changes[key].newValue) {
        resetUI();
      }
    }
  });
}

function switchTab(tabName) {
  if (tabName === 'broken') {
    tabBroken.classList.add('active');
    tabBlocked.classList.remove('active');
    listBrokenPanel.classList.add('active');
    listBrokenPanel.classList.remove('hidden');
    listBlockedPanel.classList.remove('active');
    listBlockedPanel.classList.add('hidden');
  } else {
    tabBlocked.classList.add('active');
    tabBroken.classList.remove('active');
    listBlockedPanel.classList.add('active');
    listBlockedPanel.classList.remove('hidden');
    listBrokenPanel.classList.remove('active');
    listBrokenPanel.classList.add('hidden');
  }
}

async function triggerScan() {
  if (!activeTabId) return;

  scanBtnLabel.textContent = 'Scanning...';
  btnScan.disabled = true;

  try {
    // Ensure scripts are injected into active tab
    await chrome.runtime.sendMessage({ action: 'ENSURE_INJECTED', tabId: activeTabId });

    // Trigger scan
    await chrome.tabs.sendMessage(activeTabId, { action: 'START_SCAN' });
  } catch (err) {
    console.error('Scan trigger failed:', err);
    scanBtnLabel.textContent = 'Scan Page';
    btnScan.disabled = false;
  }
}

async function triggerClear() {
  if (!activeTabId) return;
  try {
    await chrome.tabs.sendMessage(activeTabId, { action: 'CLEAR_HIGHLIGHTS' });
  } catch {}
  resetUI();
}

function resetUI() {
  scanBtnLabel.textContent = 'Scan Page';
  btnScan.disabled = false;
  progressContainer.classList.add('hidden');
  progressBarFill.style.width = '0%';

  safeSetText(countTotal, '0');
  safeSetText(countChecked, '0');
  safeSetText(countGood, '0');
  safeSetText(countBroken, '0');
  safeSetText(countBlocked, '0');
  safeSetText(countSkipped, '0');
  safeSetText(tabBrokenCount, '0');
  safeSetText(tabBlockedCount, '0');

  brokenLinksUl.textContent = '';
  brokenLinksUl.classList.add('hidden');
  emptyBroken.classList.remove('hidden');

  blockedLinksUl.textContent = '';
  blockedLinksUl.classList.add('hidden');
  emptyBlocked.classList.remove('hidden');
}

/**
 * Renders complete scan state safely without innerHTML.
 */
function renderState(state) {
  if (!state) return;

  const counts = state.counts || {};
  safeSetText(countTotal, counts.total || 0);
  safeSetText(countChecked, counts.checked || 0);
  safeSetText(countGood, counts.good || 0);
  safeSetText(countBroken, counts.broken || 0);
  safeSetText(countBlocked, counts.blocked || 0);
  safeSetText(countSkipped, counts.skipped || 0);

  const brokenList = state.brokenLinks || [];
  const blockedList = state.blockedLinks || [];

  safeSetText(tabBrokenCount, brokenList.length);
  safeSetText(tabBlockedCount, blockedList.length);

  // Update progress bar
  if (state.isScanning) {
    progressContainer.classList.remove('hidden');
    const total = state.totalLinks || 1;
    const checked = counts.checked || 0;
    const pct = Math.min(100, Math.round((checked / total) * 100));
    progressBarFill.style.width = `${pct}%`;
    safeSetText(progressPercent, `${pct}%`);
    safeSetText(progressText, `Checking ${checked} of ${total} links...`);

    scanBtnLabel.textContent = 'Scanning...';
    btnScan.disabled = true;
  } else {
    progressContainer.classList.add('hidden');
    scanBtnLabel.textContent = 'Re-scan';
    btnScan.disabled = false;
  }

  // Render broken links list safely
  renderLinkList(brokenLinksUl, emptyBroken, brokenList, 'broken');

  // Render blocked links list safely
  renderLinkList(blockedLinksUl, emptyBlocked, blockedList, 'blocked');
}

/**
 * Safely builds link list items using DOM API (no innerHTML).
 */
function renderLinkList(ulEl, emptyEl, items, type) {
  ulEl.textContent = ''; // Clear previous children

  if (!items || items.length === 0) {
    ulEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  ulEl.classList.remove('hidden');

  for (const item of items) {
    const li = createElementSafe('li', { className: 'link-item' });

    // Status code pill
    const badgeText = item.statusCode ? String(item.statusCode) : (item.errorType === 'timeout' ? 'TIMEOUT' : 'ERR');
    const badgeClass = type === 'broken' ? 'status-badge badge-broken' : 'status-badge badge-blocked';
    const badge = createElementSafe('span', { className: badgeClass }, badgeText);

    // Meta container
    const meta = createElementSafe('div', { className: 'link-meta' });
    const textLabel = createElementSafe('div', { className: 'link-text' }, item.text || item.url || 'Link');
    const urlLabel = createElementSafe('div', { className: 'link-url' }, item.url || item.rawHref || '');

    meta.appendChild(textLabel);
    meta.appendChild(urlLabel);

    const hint = createElementSafe('span', { className: 'link-action-hint' }, 'Locate ↗');

    li.appendChild(badge);
    li.appendChild(meta);
    li.appendChild(hint);

    // Click handler to focus link on page
    li.addEventListener('click', () => {
      if (activeTabId && item.id) {
        chrome.tabs.sendMessage(activeTabId, {
          action: 'FOCUS_LINK',
          linkId: item.id
        }).catch(() => {});
      }
    });

    ulEl.appendChild(li);
  }
}

document.addEventListener('DOMContentLoaded', init);
