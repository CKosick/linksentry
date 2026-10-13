#!/usr/bin/env node
/**
 * LinkSentry Extension Packager for Chrome Web Store
 *
 * Produces a verified, cross-platform standard PKZip archive: dist/linksentry-v1.0.0.zip.
 * 
 * Process:
 * 1. Runs unit test suite (pure logic, concurrency, skip rules, dedupe)
 * 2. Runs static network code audit
 * 3. Runs automated real browser load test (Puppeteer + Chrome against fixture)
 * 4. Bundles extension files using AdmZip (excluding node_modules, tests, logs)
 * 5. Verifies genuine PKZip header magic signature (0x50 0x4B 0x03 0x04)
 * 6. Reports verified zip size and entry count
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import AdmZip from 'adm-zip';

const ROOT = resolve(process.cwd());
const DIST = join(ROOT, 'dist');
const ZIP_FILE = join(DIST, 'linksentry-v1.0.0.zip');

const INCLUDED_ENTRIES = [
  { path: 'manifest.json', type: 'file' },
  { path: 'README.md', type: 'file' },
  { path: 'LICENSE', type: 'file' },
  { path: 'icons', type: 'dir' },
  { path: 'src', type: 'dir' }
];

console.log('🧪 Step 1: Running unit test suite...');
try {
  execSync('npm test', { stdio: 'inherit', cwd: ROOT });
} catch (err) {
  console.error('\n❌ Packaging aborted: Unit tests failed.');
  process.exit(1);
}

console.log('\n🔒 Step 2: Running static network & privacy audit...');
try {
  execSync('npm run audit:network', { stdio: 'inherit', cwd: ROOT });
} catch (err) {
  console.error('\n❌ Packaging aborted: Network audit failed.');
  process.exit(1);
}

console.log('\n🌐 Step 3: Running automated real browser load test in Chrome...');
try {
  execSync('npm run test:browser', { stdio: 'inherit', cwd: ROOT });
} catch (err) {
  console.error('\n❌ Packaging aborted: Browser load test failed.');
  process.exit(1);
}

console.log('\n📦 Step 4: Packaging extension for Chrome Web Store distribution...');
if (!existsSync(DIST)) {
  mkdirSync(DIST, { recursive: true });
}

if (existsSync(ZIP_FILE)) {
  try {
    unlinkSync(ZIP_FILE);
  } catch {}
}

const zip = new AdmZip();

for (const entry of INCLUDED_ENTRIES) {
  const fullPath = join(ROOT, entry.path);
  if (!existsSync(fullPath)) {
    console.error(`❌ Packaging error: Required entry "${entry.path}" not found.`);
    process.exit(1);
  }

  if (entry.type === 'file') {
    zip.addLocalFile(fullPath);
  } else if (entry.type === 'dir') {
    zip.addLocalFolder(fullPath, entry.path);
  }
}

// Write archive to disk
zip.writeZip(ZIP_FILE);

// Step 5: Rigorous verification of PKZip output
console.log('\n🔍 Step 5: Verifying zip archive integrity and PK signature...');
if (!existsSync(ZIP_FILE)) {
  console.error('❌ Verification failed: Output zip file does not exist on disk.');
  process.exit(1);
}

const zipBuffer = readFileSync(ZIP_FILE);
if (zipBuffer.length < 4) {
  console.error('❌ Verification failed: Archive file is empty or truncated.');
  process.exit(1);
}

const isPkZip =
  zipBuffer[0] === 0x50 &&
  zipBuffer[1] === 0x4b &&
  zipBuffer[2] === 0x03 &&
  zipBuffer[3] === 0x04;

if (!isPkZip) {
  console.error('❌ Verification failed: Missing valid PK zip header signature (PK\\x03\\x04).');
  process.exit(1);
}

// Read back archive entries using AdmZip
const verifyZip = new AdmZip(ZIP_FILE);
const entries = verifyZip.getEntries();
const entryNames = entries.map(e => e.entryName);

// Ensure manifest.json is present at zip root
if (!entryNames.includes('manifest.json')) {
  console.error('❌ Verification failed: manifest.json missing from zip root.');
  process.exit(1);
}

// Ensure no test, dev, or node_modules files leaked
const illegalEntries = entryNames.filter(name =>
  name.startsWith('node_modules/') ||
  name.startsWith('.git/') ||
  name.startsWith('test/') ||
  name.includes('.env')
);

if (illegalEntries.length > 0) {
  console.error(`❌ Verification failed: Archive contains non-shipped files: ${illegalEntries.join(', ')}`);
  process.exit(1);
}

const stats = statSync(ZIP_FILE);
const sizeKb = (stats.size / 1024).toFixed(2);

console.log('\n🎉 Success! Verified genuine PKZip package generated:');
console.log(`   Archive:    dist/linksentry-v1.0.0.zip`);
console.log(`   Magic Byte: PK\\x03\\x04 (0x504B0304) [VERIFIED]`);
console.log(`   File Size:  ${sizeKb} KB (${stats.size} bytes)`);
console.log(`   Entries:    ${entries.length} items`);
console.log('\nPackage Entries:');
for (const entry of entries) {
  console.log(`   - ${entry.entryName} (${entry.header.size} bytes)`);
}
console.log('\n🚀 LinkSentry v1.0.0 package ready for submission queue.\n');
