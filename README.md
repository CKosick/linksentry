# LinkSentry

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success.svg)](manifest.json)
[![Tests](https://img.shields.io/badge/Tests-Passing-brightgreen.svg)](test/)

> **A fast, privacy-focused, one-click broken link checker for Google Chrome.**  
> The maintained Manifest V3 successor to *Check My Links*.

---

## Overview

For years, *Check My Links* was the category-defining extension for link hygiene. Following its discontinuation in 2019 and removal during the Manifest V2 deprecation, creators and site owners have lacked a clean, maintained in-browser replacement.

**LinkSentry** fills that gap as a native Manifest V3 link checker engineered for speed, safety, and strict user privacy.

### Honest Positioning
Professional technical SEO agencies often rely on dedicated enterprise crawlers like Screaming Frog or Ahrefs. **LinkSentry is built for the volume market:** bloggers, content marketers, writers, QA testers, and site owners who want instant, reliable feedback on a single live page without heavy software setups or cloud queues.

---

## Core Features

- **One-Click Page Scan:** Audits all links on the current page in seconds.
- **In-Page Highlighting:** 
  - 🟢 **Good:** Final 2xx/3xx response after redirects.
  - 🔴 **Broken:** 404, 410, 5xx server errors, DNS failures, or timeouts.
  - 🟠 **Blocked:** 401, 403, 429 server refusals reported separately so you never misdiagnose server firewalls as broken links.
  - ⚪ **Skipped:** Non-HTTP schemes (`mailto:`, `tel:`, `javascript:`, `data:`) and same-page anchors are untouched.
- **Safe DOM Work:** Highlights use non-intrusive CSS `outline` and `box-shadow` that will never cause layout shifts or break page design. Clicking **Clear Highlights** fully restores the original DOM.
- **Locate & Focus:** Click any broken or blocked link in the popup list to smoothly scroll to it and highlight it with an animated focus pulse.
- **Smart Deduplication:** Identical URLs on the same page are fetched only once over the wire, but every corresponding element is highlighted on the page.
- **Respectful Rate Limiting:** Default concurrency cap of 5, per-domain request spacing, HEAD-first checks with automatic GET fallback (on 405/501), and strict per-link timeouts.
- **Manifest V3 Lifecycle Resilient:** Coordinates work in manageable chunks so service worker restarts never kill active scans.
- **100% On-Device Privacy:** Zero telemetry, zero analytics, zero external servers. Outbound requests are only made to the links you choose to test.

---

## Repository Structure

```
linksentry/
├── manifest.json              # Manifest V3 extension configuration
├── icons/                     # Original 16, 48, and 128 PNG icons
├── src/
│   ├── background/
│   │   ├── service-worker.js  # Concurrency, batching, badge counter
│   │   └── link-checker.js    # HEAD/GET fallback & timeout engine
│   ├── content/
│   │   ├── content-script.js  # Link discovery, DOM highlighter, test bridges
│   │   └── highlighter.css    # Non-layout-shifting outline styles
│   ├── popup/
│   │   ├── popup.html         # Summary counts & broken link listing
│   │   ├── popup.css          # Modern dark/light theme styling
│   │   └── popup.js           # Safe textContent DOM rendering
│   └── common/
│       ├── classifier.js      # URL classification & skip rules
│       ├── categories.js      # Status-to-category mapping
│       ├── limiter.js         # Concurrency limiter & per-domain delay
│       ├── config.js          # Pro feature flags seam & default settings
│       └── sanitize.js        # Safe DOM manipulation & escape helpers
├── test/
│   ├── fixture-server.js      # Deterministic local test server (22 links)
│   ├── unit.test.js           # Logic, classification, categories, limiter tests
│   └── browser.test.js        # Puppeteer automated Chrome acceptance test
├── scripts/
│   ├── generate-icons.js      # Pure Node PNG icon generator
│   ├── network-audit-verify.js# Static security & network scanner
│   └── package.js             # Zip packager with PK signature verification
├── store-assets/              # Store screenshots & privacy policy
├── CHROMEWEBSTORE.md          # Complete store listing metadata & justifications
└── package.json
```

---

## Testing & Verification

LinkSentry includes a complete deterministic test harness:

1. **Unit Tests:** Covers URL classification, skip rules, category mapping, concurrency limiter limits, and URL deduplication:
   ```bash
   npm test
   ```

2. **Network Security Audit:** Scans all shipped source files to ensure zero telemetry, zero `XMLHttpRequest`, zero `WebSocket`, and zero unauthorized endpoints:
   ```bash
   npm run audit:network
   ```

3. **Automated Real Browser Load Test:** Puppeteer drives the user's local Chrome binary with the extension loaded unpacked against a 22-link test fixture. Asserts exact popup counts, highlight counts, zero console errors, zero exceptions, and validates that all requests strictly targeted the fixture:
   ```bash
   npm run test:browser
   ```

4. **Package Build & PK Verification:**
   Executes unit tests, network audit, and browser load test, then packages the extension into `dist/linksentry-v1.0.0.zip` using `adm-zip`, and validates the `PK\x03\x04` zip magic signature:
   ```bash
   npm run package
   ```

---

## License

MIT License. Copyright (c) 2026 Cliff Kosick.
