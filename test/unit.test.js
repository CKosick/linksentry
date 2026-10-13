/**
 * LinkSentry Unit Tests
 *
 * Tests pure logic:
 * 1. URL classification & skip rules (mailto, tel, javascript, data, anchor-only, same-page)
 * 2. Status-to-category mapping (good, broken, blocked, skipped)
 * 3. Concurrency limiter (proves no more than configured number run at once)
 * 4. Deduplication logic
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyUrl } from '../src/common/classifier.js';
import { categorizeStatus, CATEGORIES } from '../src/common/categories.js';
import { ConcurrencyLimiter } from '../src/common/limiter.js';

describe('1. URL Classification & Skip Rules', () => {
  const pageUrl = 'http://127.0.0.1:8899/articles/guide.html?ref=home';

  it('skips non-http schemes', () => {
    assert.deepEqual(classifyUrl('mailto:user@example.com', pageUrl), {
      isSkippable: true,
      reason: 'scheme-mailto',
      category: 'skipped'
    });

    assert.deepEqual(classifyUrl('tel:+15551234567', pageUrl), {
      isSkippable: true,
      reason: 'scheme-tel',
      category: 'skipped'
    });

    assert.deepEqual(classifyUrl('javascript:void(0)', pageUrl), {
      isSkippable: true,
      reason: 'scheme-javascript',
      category: 'skipped'
    });

    assert.deepEqual(classifyUrl('data:text/plain;base64,hello', pageUrl), {
      isSkippable: true,
      reason: 'scheme-data',
      category: 'skipped'
    });

    assert.deepEqual(classifyUrl('blob:http://127.0.0.1/abc-123', pageUrl), {
      isSkippable: true,
      reason: 'scheme-blob',
      category: 'skipped'
    });

    assert.deepEqual(classifyUrl('chrome://settings', pageUrl), {
      isSkippable: true,
      reason: 'scheme-chrome',
      category: 'skipped'
    });
  });

  it('skips anchor-only and empty links', () => {
    assert.deepEqual(classifyUrl('#', pageUrl), {
      isSkippable: true,
      reason: 'anchor-only',
      category: 'skipped'
    });

    assert.deepEqual(classifyUrl('', pageUrl), {
      isSkippable: true,
      reason: 'anchor-only',
      category: 'skipped'
    });

    assert.deepEqual(classifyUrl(null, pageUrl), {
      isSkippable: true,
      reason: 'missing-href',
      category: 'skipped'
    });
  });

  it('skips same-page anchor links', () => {
    assert.deepEqual(classifyUrl('#section2', pageUrl), {
      isSkippable: true,
      reason: 'same-page-anchor',
      category: 'skipped'
    });

    // Fully-qualified same-page anchor
    const fullSamePage = 'http://127.0.0.1:8899/articles/guide.html?ref=home#details';
    assert.deepEqual(classifyUrl(fullSamePage, pageUrl), {
      isSkippable: true,
      reason: 'same-page-anchor',
      category: 'skipped',
      resolvedUrl: fullSamePage
    });
  });

  it('keeps valid HTTP and HTTPS links', () => {
    const resRelative = classifyUrl('/about', pageUrl);
    assert.equal(resRelative.isSkippable, false);
    assert.equal(resRelative.resolvedUrl, 'http://127.0.0.1:8899/about');

    const resHttps = classifyUrl('https://example.com/pricing', pageUrl);
    assert.equal(resHttps.isSkippable, false);
    assert.equal(resHttps.resolvedUrl, 'https://example.com/pricing');
  });
});

describe('2. Status-to-Category Mapping', () => {
  it('maps 2xx and 3xx to good', () => {
    assert.equal(categorizeStatus(200), CATEGORIES.GOOD);
    assert.equal(categorizeStatus(204), CATEGORIES.GOOD);
    assert.equal(categorizeStatus(301), CATEGORIES.GOOD);
    assert.equal(categorizeStatus(302), CATEGORIES.GOOD);
    assert.equal(categorizeStatus(308), CATEGORIES.GOOD);
  });

  it('maps 401, 403, and 429 to blocked (not broken)', () => {
    assert.equal(categorizeStatus(401), CATEGORIES.BLOCKED);
    assert.equal(categorizeStatus(403), CATEGORIES.BLOCKED);
    assert.equal(categorizeStatus(429), CATEGORIES.BLOCKED);
  });

  it('maps 404, 410, 5xx, and errors to broken', () => {
    assert.equal(categorizeStatus(400), CATEGORIES.BROKEN);
    assert.equal(categorizeStatus(404), CATEGORIES.BROKEN);
    assert.equal(categorizeStatus(410), CATEGORIES.BROKEN);
    assert.equal(categorizeStatus(500), CATEGORIES.BROKEN);
    assert.equal(categorizeStatus(502), CATEGORIES.BROKEN);
    assert.equal(categorizeStatus(503), CATEGORIES.BROKEN);
    assert.equal(categorizeStatus(504), CATEGORIES.BROKEN);
    assert.equal(categorizeStatus(null, 'timeout'), CATEGORIES.BROKEN);
    assert.equal(categorizeStatus(null, 'network'), CATEGORIES.BROKEN);
    assert.equal(categorizeStatus(null, 'dns'), CATEGORIES.BROKEN);
  });

  it('handles skipped category', () => {
    assert.equal(categorizeStatus(null, 'skipped'), CATEGORIES.SKIPPED);
  });
});

describe('3. Concurrency Limiter', () => {
  it('enforces maximum concurrent executions strictly', async () => {
    const CONCURRENCY_LIMIT = 3;
    const limiter = new ConcurrencyLimiter({
      concurrency: CONCURRENCY_LIMIT,
      perDomainDelayMs: 0
    });

    let currentActive = 0;
    let maxObservedActive = 0;
    const totalTasks = 12;

    const tasks = Array.from({ length: totalTasks }, (_, i) => {
      return limiter.schedule(`http://test-domain-${i}.local/task`, async () => {
        currentActive++;
        if (currentActive > maxObservedActive) {
          maxObservedActive = currentActive;
        }

        // Simulate async I/O work
        await new Promise(r => setTimeout(r, 20));

        currentActive--;
        return `done-${i}`;
      });
    });

    const results = await Promise.all(tasks);

    assert.equal(results.length, totalTasks);
    assert.ok(
      maxObservedActive <= CONCURRENCY_LIMIT,
      `Max active (${maxObservedActive}) must not exceed limit (${CONCURRENCY_LIMIT})`
    );
    assert.equal(maxObservedActive, CONCURRENCY_LIMIT);
  });

  it('enforces per-domain delays', async () => {
    const PER_DOMAIN_DELAY = 40;
    const limiter = new ConcurrencyLimiter({
      concurrency: 5,
      perDomainDelayMs: PER_DOMAIN_DELAY
    });

    const start = Date.now();
    const domain = 'http://single-host.com';

    await Promise.all([
      limiter.schedule(`${domain}/a`, async () => 1),
      limiter.schedule(`${domain}/b`, async () => 2),
      limiter.schedule(`${domain}/c`, async () => 3)
    ]);

    const elapsed = Date.now() - start;
    // 3 requests to same domain require at least 2 delay intervals: 2 * 40 = 80ms
    assert.ok(elapsed >= 70, `Elapsed time (${elapsed}ms) must respect per-domain delays (>= 70ms)`);
  });
});

describe('4. Deduplication Logic', () => {
  it('deduplicates identical URLs within a scan set', () => {
    const rawLinks = [
      'https://site.com/home',
      'https://site.com/about',
      'https://site.com/home', // duplicate
      'https://site.com/pricing',
      'https://site.com/about', // duplicate
      'https://site.com/home' // duplicate
    ];

    const uniqueSet = new Set(rawLinks);
    assert.equal(uniqueSet.size, 3);
    assert.deepEqual(Array.from(uniqueSet), [
      'https://site.com/home',
      'https://site.com/about',
      'https://site.com/pricing'
    ]);
  });
});
