# Chrome Web Store Submission & Readiness Documentation: LinkSentry

**Project:** LinkSentry  
**Author:** Cliff Kosick  
**Repository:** [https://github.com/CKosick/linksentry](https://github.com/CKosick/linksentry)  
**Manifest Version:** Manifest V3  
**Current Version:** 1.0.0  
**Status:** Build & Package complete. Queued for developer account slot opening (no submission this round).

---

## 1. Extension Overview

- **Extension Name:** LinkSentry - Broken Link Checker
- **Short Name:** LinkSentry
- **Version:** 1.0.0
- **Category:** Productivity / Developer Tools
- **Short Description (132 chars max):** Fast, privacy-focused broken link checker for the current page. Highlights good, broken, and blocked links with live status.

---

## 2. Permissions Justification

Every permission and host permission requested in `manifest.json` is strictly justified below:

| Permission / Host | Type | One-Line Plain English Justification |
| :--- | :--- | :--- |
| `activeTab` | API Permission | Grants temporary access to inspect links on the currently active tab when the user clicks the extension toolbar icon. |
| `scripting` | API Permission | Used to inject the highlighter CSS and content script into the active tab on demand without running permanent content scripts across all websites. |
| `storage` | API Permission | Persists scan results, resume state, and user highlight color preferences locally on the user's device (`chrome.storage.local`). |
| `http://*/*` | Host Permission | Required by the background service worker to issue HTTP HEAD and GET status verification requests to link destinations found on the scanned page. |
| `https://*/*` | Host Permission | Required by the background service worker to issue HTTPS HEAD and GET status verification requests to secure link destinations found on the scanned page. |

*Note: No `tabs`, `history`, `downloads`, `webRequest`, or background scraping permissions are requested.*

---

## 3. Privacy & Data Use Disclosures

- **Data Collection:** Zero personal or identifying data collected.
- **Off-Device Transmission:** Zero data transmitted off the user's machine. LinkSentry has no backend servers, no analytics, and no telemetry.
- **Outbound Network Traffic:** Network requests are issued solely to check the HTTP status of link target URLs discovered on the page the user explicitly scans.
- **Single Purpose:** Link hygiene — scanning and reporting broken links on the current browser page.

---

## 4. Store Assets

- **Icons:**
  - `icons/icon-16.png` (16×16 px)
  - `icons/icon-48.png` (48×48 px)
  - `icons/icon-128.png` (128×128 px)
- **Store Screenshots (Real Puppeteer Captures from Chrome):**
  - `store-assets/screenshot-1-page-scan.png` (1280×800) — In-page link highlighting (green for good, red for broken, amber for blocked).
  - `store-assets/screenshot-2-popup-results.png` (380×560) — Summary counts and scrollable broken links list with HTTP status codes.
  - `store-assets/screenshot-3-broken-focus.png` (1280×800) — Interactive link location and pulsing focus element.
- **Privacy Policy Page:** `store-assets/privacy.html`

---

## 5. Version History

- **v1.0.0 (2026-10-13):**
  - Initial MVP release.
  - One-click page scanning with Manifest V3 service worker lifecycle resilience.
  - Safe in-page outline highlighting (no layout shift).
  - Accurate status categorization (good, broken, blocked, skipped).
  - Smart deduplication and concurrency limiter (max 5 parallel, per-domain rate limiting).
  - Focus and scroll-to-link interactive navigation.
  - 100% on-device operation, zero telemetry.
