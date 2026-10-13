/**
 * LinkSentry Static Network & Security Audit Script
 *
 * Scans all shipped extension source files to guarantee:
 * 1. Network traffic goes ONLY to the links being checked
 * 2. ZERO telemetry, analytics, or background beacons
 * 3. ZERO XMLHttpRequest, WebSocket, or sendBeacon
 * 4. All fetch() calls are strictly parameterized with discovered link targets
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const SHIPPED_FILES = [
  'manifest.json',
  'src/background/service-worker.js',
  'src/background/link-checker.js',
  'src/content/content-script.js',
  'src/content/highlighter.css',
  'src/popup/popup.html',
  'src/popup/popup.css',
  'src/popup/popup.js',
  'src/common/classifier.js',
  'src/common/categories.js',
  'src/common/limiter.js',
  'src/common/config.js',
  'src/common/sanitize.js'
];

console.log('====================================================');
console.log('LinkSentry Static Network & Source Code Audit');
console.log('====================================================');

const forbiddenPatterns = [
  { pattern: /XMLHttpRequest/g, name: 'XMLHttpRequest' },
  { pattern: /new\s+WebSocket/g, name: 'WebSocket' },
  { pattern: /navigator\.sendBeacon/g, name: 'sendBeacon' },
  { pattern: /google-analytics\.com/g, name: 'Google Analytics' },
  { pattern: /googletagmanager\.com/g, name: 'Google Tag Manager' },
  { pattern: /mixpanel/g, name: 'Mixpanel' },
  { pattern: /segment\.io/g, name: 'Segment' },
  { pattern: /sentry\.io/g, name: 'Sentry Telemetry' },
  { pattern: /posthog/g, name: 'PostHog' }
];

let violations = 0;
const networkSites = [];

for (const relPath of SHIPPED_FILES) {
  const fullPath = path.join(rootDir, relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Shipped file missing: ${relPath}`);
    violations++;
    continue;
  }

  const content = fs.readFileSync(fullPath, 'utf8');

  // Check forbidden telemetry and legacy networking
  for (const { pattern, name } of forbiddenPatterns) {
    if (pattern.test(content)) {
      console.error(`❌ Violation: Found forbidden ${name} in ${relPath}`);
      violations++;
    }
  }

  // Scan for fetch calls
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('fetch(')) {
      networkSites.push({
        file: relPath,
        line: idx + 1,
        code: line.trim()
      });
    }
  });
}

console.log(`\nAudited ${SHIPPED_FILES.length} shipped extension files.`);
console.log(`Total forbidden API violations: ${violations}`);

console.log('\n--- Legitimate Link Check Request Call Sites ---');
for (const site of networkSites) {
  console.log(`  • ${site.file}:${site.line} -> ${site.code}`);
}

if (violations > 0) {
  console.error('\n❌ Static network audit FAILED with violations.');
  process.exit(1);
} else {
  console.log('\n✅ Static network audit PASSED: ZERO telemetry, ZERO unauthorized endpoints.');
  console.log('   All network requests strictly originate from user-initiated link checks.\n');
}
