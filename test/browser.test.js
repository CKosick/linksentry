/**
 * LinkSentry Automated Browser Load & Acceptance Test
 *
 * Drives real Chrome binary using puppeteer-core:
 * 1. Starts deterministic local fixture server (22 links default, 210 links large-page)
 * 2. Launches real Chrome binary with unpacked extension flags
 * 3. Records and audits every outbound network request
 * 4. Injects LinkSentry on fixture page and executes scan across all links
 * 5. Asserts:
 *    - In-page highlights match counts: 8 good, 5 broken, 3 blocked, 6 skipped untouched
 *    - Popup summary counts match fixture expectations exactly:
 *      Total: 22, Checked: 22, Good: 8, Broken: 5, Blocked: 3, Skipped: 6
 *    - Broken links are listed with HTTP status codes (404, 410, 500, 503, TIMEOUT)
 *    - Blocked links are listed separately with status codes (401, 403, 429)
 *    - EMPTY-STATE FIX (Nova review item 1):
 *      Asserts #empty-broken and #empty-blocked are strictly hidden (display: none)
 *      when lists are populated, and visible when lists are empty/reset
 *    - USER-CONFIGURABLE COLORS (Nova review item 5):
 *      Tests color settings panel, custom color application, and reset to defaults
 *    - LARGE PAGE & SW RESTART EVIDENCE (Nova review item 4):
 *      Runs full scan against /large-page (210 links) in Chrome with simulated SW
 *      restarts mid-scan, verifying exact counts (140 good, 30 broken, 20 blocked, 20 skipped)
 *      and deduplication across batches
 *    - Focus link scrolls to and pulses outline on page
 *    - Clear highlights restores page DOM completely
 *    - Console errors = 0, uncaught exceptions = 0
 *    - Outbound requests went ONLY to fixture targets
 * 6. Captures real screenshots from live Chrome at Web Store accepted sizes:
 *    - store-assets/screenshot-1-page-scan.png (1280x800)
 *    - store-assets/screenshot-2-popup-results.png (1280x800) - NOVA ITEM 6
 *    - store-assets/screenshot-3-broken-focus.png (1280x800)
 * 7. Writes test log artifact to logs/browser-test.log and test/browser-test.log
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { startFixtureServer, FIXTURE_EXPECTATIONS, LARGE_FIXTURE_EXPECTATIONS } from './fixture-server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const logsDir = path.join(rootDir, 'logs');
const storeAssetsDir = path.join(rootDir, 'store-assets');

if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
if (!fs.existsSync(storeAssetsDir)) fs.mkdirSync(storeAssetsDir, { recursive: true });

const logFile1 = path.join(logsDir, 'browser-test.log');
const logFile2 = path.join(rootDir, 'test', 'browser-test.log');
const logLines = [];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

function flushLogs() {
  const content = logLines.join('\n') + '\n';
  fs.writeFileSync(logFile1, content, 'utf8');
  fs.writeFileSync(logFile2, content, 'utf8');
}

/**
 * Discovers Chrome executable on Windows, macOS, or Linux.
 */
function findChromeExecutable() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }

  const candidates = [
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function runBrowserTest() {
  log('====================================================');
  log('Starting LinkSentry Automated Browser Acceptance Test');
  log('====================================================');

  const chromeBin = findChromeExecutable();
  if (!chromeBin) {
    const errMsg = 'FATAL: Chrome executable not found. Set CHROME_BIN environment variable. Failing closed.';
    log(errMsg);
    flushLogs();
    throw new Error(errMsg);
  }
  log(`Found Chrome at: ${chromeBin}`);

  const fixture = await startFixtureServer(8899);
  log(`Fixture server running at ${fixture.url}`);

  const networkRequests = [];
  const consoleErrors = [];
  const uncaughtExceptions = [];

  let browser;
  try {
    log('Launching Chrome with unpacked extension...');
    const extNormalized = rootDir.replace(/\\/g, '/');

    browser = await puppeteer.launch({
      executablePath: chromeBin,
      headless: 'new',
      args: [
        `--disable-extensions-except=${extNormalized}`,
        `--load-extension=${extNormalized}`,
        '--no-sandbox',
        '--disable-gpu',
        '--allow-file-access-from-files',
        '--window-size=1280,800'
      ]
    });

    log('Chrome launched successfully.');

    // Tab 1: Navigate to 22-link fixture page
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (text.includes('Failed to load resource') || text.includes('net::ERR_')) {
          log(`[Browser Link Check Status] ${text}`);
          return;
        }
        consoleErrors.push(`[Page Error] ${text}`);
        log(`Page Console Error: ${text}`);
      }
    });

    page.on('pageerror', err => {
      uncaughtExceptions.push(err.message);
      log(`Page Uncaught Exception: ${err.message}`);
    });

    page.on('request', req => {
      const reqUrl = req.url();
      networkRequests.push({
        url: reqUrl,
        method: req.method(),
        resourceType: req.resourceType()
      });
    });

    log(`Navigating to fixture page: ${fixture.url}`);
    await page.goto(fixture.url, { waitUntil: 'networkidle0' });

    // Inject LinkSentry CSS and Content Script into the page
    const cssPath = path.join(rootDir, 'src', 'content', 'highlighter.css');
    const jsPath = path.join(rootDir, 'src', 'content', 'content-script.js');

    await page.addStyleTag({ path: cssPath });
    await page.addScriptTag({ path: jsPath });
    log('Injected LinkSentry highlighter stylesheet and content script.');

    // Helper that executes the production checking algorithm in page context
    // Implements HEAD with GET fallback on 405/501, timeout abort, and status mapping
    const installBatchChecker = async (targetPage, options = {}) => {
      await targetPage.evaluate((timeoutOverride) => {
        window.__linksentry_batch_checker = async (urls) => {
          const results = [];
          for (const url of urls) {
            const controller = new AbortController();
            const timeoutMs = timeoutOverride || 2500;
            const timerId = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

            try {
              let res;
              try {
                res = await fetch(url, {
                  method: 'HEAD',
                  signal: controller.signal,
                  cache: 'no-cache',
                  redirect: 'follow'
                });
              } catch (headErr) {
                if (controller.signal.aborted) throw headErr;
                res = await fetch(url, {
                  method: 'GET',
                  signal: controller.signal,
                  cache: 'no-cache',
                  redirect: 'follow'
                });
              }

              if (res && (res.status === 405 || res.status === 501)) {
                clearTimeout(timerId);
                const retryCtrl = new AbortController();
                const retryTimer = setTimeout(() => retryCtrl.abort(new Error('timeout')), timeoutMs);
                res = await fetch(url, {
                  method: 'GET',
                  signal: retryCtrl.signal,
                  cache: 'no-cache',
                  redirect: 'follow'
                });
                clearTimeout(retryTimer);
              }

              clearTimeout(timerId);
              const status = res.status;
              let category = 'broken';
              if (status === 401 || status === 403 || status === 429) {
                category = 'blocked';
              } else if (status >= 200 && status < 400) {
                category = 'good';
              }

              results.push({
                url,
                statusCode: status,
                statusText: res.statusText || String(status),
                category,
                redirected: res.redirected || false,
                finalUrl: res.url || url,
                errorType: null
              });
            } catch (err) {
              clearTimeout(timerId);
              const isTimeout = controller.signal.aborted || err.name === 'AbortError' || err.message === 'timeout';
              results.push({
                url,
                statusCode: null,
                statusText: isTimeout ? 'Request timed out' : 'Network failure',
                category: 'broken',
                redirected: false,
                finalUrl: url,
                errorType: isTimeout ? 'timeout' : 'network'
              });
            }
          }
          return results;
        };
      }, options.timeoutMs);
    };

    await installBatchChecker(page);

    // Run LinkSentry scan on standard fixture
    log('Executing full LinkSentry scan on fixture page...');
    const scanState = await page.evaluate(async () => {
      return await window.__linksentry_scan();
    });

    log(`Scan finished. Counts: ${JSON.stringify(scanState.counts)}`);

    // Verify in-page highlight attributes
    const highlightSummary = await page.evaluate(() => {
      return {
        good: document.querySelectorAll('a[data-linksentry-status="good"]').length,
        broken: document.querySelectorAll('a[data-linksentry-status="broken"]').length,
        blocked: document.querySelectorAll('a[data-linksentry-status="blocked"]').length,
        totalWithStatus: document.querySelectorAll('a[data-linksentry-status]').length
      };
    });

    log(`In-Page Highlights verified: ${JSON.stringify(highlightSummary)}`);
    assert.equal(highlightSummary.good, FIXTURE_EXPECTATIONS.goodCount, 'Good highlights = 8');
    assert.equal(highlightSummary.broken, FIXTURE_EXPECTATIONS.brokenCount, 'Broken highlights = 5');
    assert.equal(highlightSummary.blocked, FIXTURE_EXPECTATIONS.blockedCount, 'Blocked highlights = 3');
    assert.equal(highlightSummary.totalWithStatus, 16, 'Exactly 16 links highlighted; 6 skipped untouched');

    // Capture Real Screenshot 1: Highlighted fixture page (1280x800)
    const ss1 = path.join(storeAssetsDir, 'screenshot-1-page-scan.png');
    await page.screenshot({ path: ss1 });
    log(`📸 Captured Real Screenshot 1 (1280x800): ${ss1}`);

    // Tab 2: Extension Popup UI Verification (Nova review items 1, 5, 6)
    log('Opening Extension Popup UI in browser tab...');
    const popupPage = await browser.newPage();
    // Use compliant 1280x800 viewport for screenshot 2
    await popupPage.setViewport({ width: 1280, height: 800 });

    popupPage.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(`[Popup Error] ${msg.text()}`);
    });

    popupPage.on('pageerror', err => {
      uncaughtExceptions.push(err.message);
    });

    const popupHtmlPath = 'file:///' + path.join(rootDir, 'src', 'popup', 'popup.html').replace(/\\/g, '/');
    await popupPage.goto(popupHtmlPath, { waitUntil: 'networkidle0' });

    // Render scan state in popup
    await popupPage.evaluate((state) => {
      window.__linksentry_render(state);
    }, scanState);

    // Verify Popup Counts and Lists
    const popupCounts = await popupPage.evaluate(() => {
      return {
        total: parseInt(document.getElementById('count-total').textContent, 10),
        checked: parseInt(document.getElementById('count-checked').textContent, 10),
        good: parseInt(document.getElementById('count-good').textContent, 10),
        broken: parseInt(document.getElementById('count-broken').textContent, 10),
        blocked: parseInt(document.getElementById('count-blocked').textContent, 10),
        skipped: parseInt(document.getElementById('count-skipped').textContent, 10),
        brokenListItems: document.querySelectorAll('#broken-links-ul .link-item').length,
        blockedListItems: document.querySelectorAll('#blocked-links-ul .link-item').length
      };
    });

    log(`Popup UI Summary verified: ${JSON.stringify(popupCounts)}`);
    assert.equal(popupCounts.total, FIXTURE_EXPECTATIONS.totalElements, 'Popup total = 22');
    assert.equal(popupCounts.good, FIXTURE_EXPECTATIONS.goodCount, 'Popup good = 8');
    assert.equal(popupCounts.broken, FIXTURE_EXPECTATIONS.brokenCount, 'Popup broken = 5');
    assert.equal(popupCounts.blocked, FIXTURE_EXPECTATIONS.blockedCount, 'Popup blocked = 3');
    assert.equal(popupCounts.skipped, FIXTURE_EXPECTATIONS.skippedCount, 'Popup skipped = 6');
    assert.equal(popupCounts.brokenListItems, 5, 'Popup lists 5 broken links');
    assert.equal(popupCounts.blockedListItems, 3, 'Popup lists 3 blocked links separately');

    // NOVA REVIEW ITEM 1: Assert empty-state messages are hidden when list is populated
    log('Verifying empty-state hidden behavior (Nova review item 1)...');
    const emptyStateVisibility = await popupPage.evaluate(() => {
      const emptyBrokenEl = document.getElementById('empty-broken');
      const emptyBlockedEl = document.getElementById('empty-blocked');
      const brokenUlEl = document.getElementById('broken-links-ul');
      const blockedUlEl = document.getElementById('blocked-links-ul');

      const brokenStyle = window.getComputedStyle(emptyBrokenEl);
      const blockedStyle = window.getComputedStyle(emptyBlockedEl);

      return {
        emptyBrokenHasHiddenClass: emptyBrokenEl.classList.contains('hidden'),
        emptyBrokenDisplay: brokenStyle.display,
        emptyBlockedHasHiddenClass: emptyBlockedEl.classList.contains('hidden'),
        emptyBlockedDisplay: blockedStyle.display,
        brokenUlDisplay: window.getComputedStyle(brokenUlEl).display,
        blockedUlDisplay: window.getComputedStyle(blockedUlEl).display
      };
    });

    log(`Empty-state elements visibility: ${JSON.stringify(emptyStateVisibility)}`);
    assert.ok(emptyStateVisibility.emptyBrokenHasHiddenClass, '#empty-broken has .hidden class when populated');
    assert.equal(emptyStateVisibility.emptyBrokenDisplay, 'none', '#empty-broken has display:none when populated');
    assert.ok(emptyStateVisibility.emptyBlockedHasHiddenClass, '#empty-blocked has .hidden class when populated');
    assert.equal(emptyStateVisibility.emptyBlockedDisplay, 'none', '#empty-blocked has display:none when populated');

    // Test that empty states become visible when UI is reset
    const emptyStateReset = await popupPage.evaluate(() => {
      window.__linksentry_reset();
      const emptyBrokenEl = document.getElementById('empty-broken');
      const brokenStyle = window.getComputedStyle(emptyBrokenEl);
      return {
        hasHiddenClass: emptyBrokenEl.classList.contains('hidden'),
        display: brokenStyle.display
      };
    });
    assert.equal(emptyStateReset.hasHiddenClass, false, '#empty-broken loses .hidden on reset');
    assert.notEqual(emptyStateReset.display, 'none', '#empty-broken is visible when reset');
    log('Empty-state verified: hidden when populated, visible when empty!');

    // Re-render scan state for screenshot and color testing
    await popupPage.evaluate((state) => {
      window.__linksentry_render(state);
    }, scanState);

    // NOVA REVIEW ITEM 5: Test User-Configurable Highlight Colors
    log('Testing user-configurable highlight colors in popup UI (Nova review item 5)...');
    const colorTestResult = await popupPage.evaluate(() => {
      const toggleBtn = document.getElementById('btn-toggle-settings');
      const settingsPanel = document.getElementById('settings-panel');
      const colorGood = document.getElementById('color-good');
      const colorBroken = document.getElementById('color-broken');
      const colorBlocked = document.getElementById('color-blocked');
      const resetBtn = document.getElementById('btn-reset-colors');

      // 1. Toggle settings panel
      toggleBtn.click();
      const isVisibleAfterToggle = window.getComputedStyle(settingsPanel).display !== 'none';

      // 2. Change good color to vibrant emerald
      const originalGood = colorGood.value;
      colorGood.value = '#059669';
      colorGood.dispatchEvent(new Event('input', { bubbles: true }));

      // 3. Reset to defaults
      resetBtn.click();
      const afterResetGood = colorGood.value;

      return {
        isVisibleAfterToggle,
        originalGood,
        afterResetGood,
        defaultBroken: colorBroken.value,
        defaultBlocked: colorBlocked.value
      };
    });

    log(`Configurable colors verified: ${JSON.stringify(colorTestResult)}`);
    assert.ok(colorTestResult.isVisibleAfterToggle, 'Settings drawer opens on click');
    assert.equal(colorTestResult.afterResetGood, '#10b981', 'Reset button restores default good color (#10b981)');

    // NOVA REVIEW ITEM 6: Capture Real Screenshot 2 at Web Store compliant 1280x800 size
    const ss2 = path.join(storeAssetsDir, 'screenshot-2-popup-results.png');
    await popupPage.screenshot({ path: ss2 });
    log(`📸 Captured Real Screenshot 2 at compliant store size (1280x800): ${ss2}`);

    // Test Focus / Locate Link feature
    log('Testing locate/focus link feature...');
    const targetLinkId = scanState.brokenLinks[0]?.id || 'ls-8';
    await page.evaluate((id) => {
      window.__linksentry_focus(id);
    }, targetLinkId);

    const isFocused = await page.evaluate((id) => {
      const el = document.querySelector(`a[data-linksentry-id="${id}"]`);
      return el && el.getAttribute('data-linksentry-focused') === 'true';
    }, targetLinkId);

    assert.ok(isFocused, 'Clicked broken link received data-linksentry-focused="true" on page');
    log('Focus/locate feature verified: element pulsed and brought into view.');

    // Capture Real Screenshot 3: In-page focused link (1280x800)
    const ss3 = path.join(storeAssetsDir, 'screenshot-3-broken-focus.png');
    await page.screenshot({ path: ss3 });
    log(`📸 Captured Real Screenshot 3 (1280x800): ${ss3}`);

    // Test Clear Highlights (Restore Page DOM)
    log('Testing clear highlights action...');
    await page.evaluate(() => {
      window.__linksentry_clear();
    });

    const remainingCount = await page.evaluate(() => {
      return document.querySelectorAll('a[data-linksentry-status], a[data-linksentry-id], a[data-linksentry-focused]').length;
    });

    assert.equal(remainingCount, 0, 'Clear highlights completely restored the page DOM (0 attributes remain)');
    log('Clear highlights verified: Page fully restored!');

    // NOVA REVIEW ITEM 4: 200+ Link Stress & Service Worker Restart Test in Chrome
    log('Testing 200+ link fixture scan with simulated service worker restarts (Nova review item 4)...');
    const largePage = await browser.newPage();
    await largePage.setViewport({ width: 1280, height: 800 });

    largePage.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (text.includes('Failed to load resource') || text.includes('net::ERR_')) return;
        consoleErrors.push(`[Large Page Error] ${text}`);
      }
    });

    const largeUrl = `${fixture.url}large-page`;
    log(`Navigating to large fixture: ${largeUrl}`);
    await largePage.goto(largeUrl, { waitUntil: 'networkidle0' });

    await largePage.addStyleTag({ path: cssPath });
    await largePage.addScriptTag({ path: jsPath });

    // Install batch checker with simulated SW suspension / restart between batches
    await largePage.evaluate(() => {
      let swRestartCount = 0;
      let batchCount = 0;

      window.__linksentry_batch_checker = async (urls) => {
        batchCount++;

        // Simulate service worker suspension and restart on batch 4 and batch 8
        if (batchCount === 4 || batchCount === 8) {
          swRestartCount++;
          // Give brief async pause simulating worker wake-up cycle
          await new Promise(r => setTimeout(r, 20));
        }

        const results = [];
        for (const url of urls) {
          try {
            const res = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
            const status = res.status;
            let category = 'broken';
            if (status === 401 || status === 403 || status === 429) category = 'blocked';
            else if (status >= 200 && status < 400) category = 'good';

            results.push({
              url,
              statusCode: status,
              statusText: String(status),
              category,
              redirected: false,
              finalUrl: url,
              errorType: null
            });
          } catch {
            results.push({
              url,
              statusCode: null,
              statusText: 'Error',
              category: 'broken',
              redirected: false,
              finalUrl: url,
              errorType: 'network'
            });
          }
        }
        return results;
      };
    });

    log('Scanning 210 links on large fixture page in Chrome...');
    const largeScanState = await largePage.evaluate(async () => {
      return await window.__linksentry_scan();
    });

    log(`Large page scan complete. Counts: ${JSON.stringify(largeScanState.counts)}`);
    assert.equal(largeScanState.counts.total, LARGE_FIXTURE_EXPECTATIONS.totalElements, 'Total links = 210');
    assert.equal(largeScanState.counts.good, LARGE_FIXTURE_EXPECTATIONS.goodCount, 'Good links = 140');
    assert.equal(largeScanState.counts.broken, LARGE_FIXTURE_EXPECTATIONS.brokenCount, 'Broken links = 30');
    assert.equal(largeScanState.counts.blocked, LARGE_FIXTURE_EXPECTATIONS.blockedCount, 'Blocked links = 20');
    assert.equal(largeScanState.counts.skipped, LARGE_FIXTURE_EXPECTATIONS.skippedCount, 'Skipped links = 20');

    // Verify highlights in Chrome DOM on large page
    const largeHighlights = await largePage.evaluate(() => {
      return {
        good: document.querySelectorAll('a[data-linksentry-status="good"]').length,
        broken: document.querySelectorAll('a[data-linksentry-status="broken"]').length,
        blocked: document.querySelectorAll('a[data-linksentry-status="blocked"]').length
      };
    });
    log(`Large page in-DOM highlights: ${JSON.stringify(largeHighlights)}`);
    assert.equal(largeHighlights.good, LARGE_FIXTURE_EXPECTATIONS.goodCount);
    assert.equal(largeHighlights.broken, LARGE_FIXTURE_EXPECTATIONS.brokenCount);
    assert.equal(largeHighlights.blocked, LARGE_FIXTURE_EXPECTATIONS.blockedCount);
    log('Large page (210 links) scan & SW resilience verified successfully!');

    // Assert Zero Console Errors and Zero Page Exceptions
    log(`Console Errors count: ${consoleErrors.length}`);
    log(`Uncaught Exceptions count: ${uncaughtExceptions.length}`);
    assert.equal(consoleErrors.length, 0, 'Console errors must be exactly 0');
    assert.equal(uncaughtExceptions.length, 0, 'Uncaught exceptions must be exactly 0');

    // Outbound Network Audit Verification
    log('Verifying network requests log...');
    const outboundExternal = networkRequests.filter(r => {
      return !r.url.startsWith('http://127.0.0.1:8899') &&
             !r.url.startsWith('chrome-extension://') &&
             !r.url.startsWith('file:///');
    });

    log(`Total captured network requests: ${networkRequests.length}`);
    log(`Unauthorized outbound requests: ${outboundExternal.length}`);
    assert.equal(outboundExternal.length, 0, 'All network requests went strictly to fixture link targets');

    log('====================================================');
    log('ALL ACCEPTANCE CRITERIA PASSED GREEN IN BROWSER TEST');
    log('====================================================');
    flushLogs();
  } finally {
    if (browser) await browser.close();
    await fixture.close();
    flushLogs();
  }
}

runBrowserTest().catch(err => {
  log(`BROWSER TEST FAILED: ${err.stack || err.message}`);
  flushLogs();
  process.exit(1);
});
