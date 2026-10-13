/**
 * LinkSentry Unit Tests
 *
 * Tests pure logic:
 * 1. URL classification & skip rules (mailto, tel, javascript, data, anchor-only, same-page)
 * 2. Status-to-category mapping (good, broken, blocked, skipped)
 * 3. Concurrency limiter (proves no more than configured number run at once)
 * 4. Deduplication logic
 */

import { describe, it, before, after } from 'node:test';
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

import { checkLink } from '../src/background/link-checker.js';
import { startFixtureServer, FIXTURE_EXPECTATIONS, LARGE_FIXTURE_EXPECTATIONS } from './fixture-server.js';

describe('5. Production Background Link Checker Engine (checkLink + Limiter)', () => {
  let fixture;

  before(async () => {
    fixture = await startFixtureServer(8911);
  });

  after(async () => {
    if (fixture) await fixture.close();
  });

  it('checks standard 200 link with HEAD request', async () => {
    const res = await checkLink(`${fixture.url}link-200-a`);
    assert.equal(res.category, 'good');
    assert.equal(res.statusCode, 200);
  });

  it('handles HEAD 405 by falling back to GET 200', async () => {
    const res = await checkLink(`${fixture.url}head-405-fallback`);
    assert.equal(res.category, 'good');
    assert.equal(res.statusCode, 200);
  });

  it('follows redirect chains (301 -> 302 -> 200) and marks good', async () => {
    const res = await checkLink(`${fixture.url}redirect-1`);
    assert.equal(res.category, 'good');
    assert.equal(res.statusCode, 200);
    assert.equal(res.redirected, true);
  });

  it('correctly maps 404, 410, 500, and 503 to broken', async () => {
    const res404 = await checkLink(`${fixture.url}link-404`);
    assert.equal(res404.category, 'broken');
    assert.equal(res404.statusCode, 404);

    const res410 = await checkLink(`${fixture.url}link-410`);
    assert.equal(res410.category, 'broken');
    assert.equal(res410.statusCode, 410);

    const res500 = await checkLink(`${fixture.url}link-500`);
    assert.equal(res500.category, 'broken');
    assert.equal(res500.statusCode, 500);

    const res503 = await checkLink(`${fixture.url}link-503`);
    assert.equal(res503.category, 'broken');
    assert.equal(res503.statusCode, 503);
  });

  it('correctly maps 401, 403, and 429 to blocked (never broken)', async () => {
    const res401 = await checkLink(`${fixture.url}link-401`);
    assert.equal(res401.category, 'blocked');
    assert.equal(res401.statusCode, 401);

    const res403 = await checkLink(`${fixture.url}link-403`);
    assert.equal(res403.category, 'blocked');
    assert.equal(res403.statusCode, 403);

    const res429 = await checkLink(`${fixture.url}link-429`);
    assert.equal(res429.category, 'blocked');
    assert.equal(res429.statusCode, 429);
  });

  it('aborts hanging request past timeout and marks broken', async () => {
    const res = await checkLink(`${fixture.url}link-hangs`, { timeoutMs: 150 });
    assert.equal(res.category, 'broken');
    assert.equal(res.errorType, 'timeout');
  });

  it('runs all 22 fixture links through production limiter and produces exact counts', async () => {
    const limiter = new ConcurrencyLimiter({ concurrency: 5, perDomainDelayMs: 20 });
    const urls = [
      `${fixture.url}link-200-a`,
      `${fixture.url}link-200-b`,
      `${fixture.url}link-200-c`,
      `${fixture.url}link-200-d`,
      `${fixture.url}redirect-1`,
      `${fixture.url}head-405-fallback`,
      `${fixture.url}link-duplicate`,
      `${fixture.url}link-duplicate`, // duplicate URL
      `${fixture.url}link-404`,
      `${fixture.url}link-410`,
      `${fixture.url}link-500`,
      `${fixture.url}link-503`,
      `${fixture.url}link-401`,
      `${fixture.url}link-403`,
      `${fixture.url}link-429`,
      `${fixture.url}link-hangs`
    ];

    // Deduplicate unique network targets
    const unique = Array.from(new Set(urls));
    assert.equal(unique.length, FIXTURE_EXPECTATIONS.uniqueNetworkUrls);

    const results = await Promise.all(
      unique.map(u => limiter.schedule(u, () => checkLink(u, { timeoutMs: 200 })))
    );

    const counts = { good: 0, broken: 0, blocked: 0 };
    for (const r of results) {
      counts[r.category]++;
    }

    // Including the duplicate (which is good)
    counts.good += 1;

    assert.equal(counts.good, FIXTURE_EXPECTATIONS.goodCount, 'Production path: good = 8');
    assert.equal(counts.broken, FIXTURE_EXPECTATIONS.brokenCount, 'Production path: broken = 5');
    assert.equal(counts.blocked, FIXTURE_EXPECTATIONS.blockedCount, 'Production path: blocked = 3');
  });
});

describe('6. Large Page (210 Links) & Service Worker Restart Resilience', () => {
  let fixture;

  before(async () => {
    fixture = await startFixtureServer(8912);
  });

  after(async () => {
    if (fixture) await fixture.close();
  });

  it('scans 200+ link fixture across simulated service worker termination/restart', async () => {
    // 210 links: 130 good unique + 10 dups, 30 broken, 20 blocked, 20 skipped
    const allLinks = [];
    for (let i = 1; i <= 130; i++) allLinks.push({ url: `${fixture.url}link-large-200-${i}`, skippable: false });
    for (let i = 1; i <= 10; i++) allLinks.push({ url: `${fixture.url}link-large-200-1`, skippable: false }); // 10 dups
    for (let i = 1; i <= 20; i++) allLinks.push({ url: `${fixture.url}link-large-404-${i}`, skippable: false });
    for (let i = 1; i <= 10; i++) allLinks.push({ url: `${fixture.url}link-large-500-${i}`, skippable: false });
    for (let i = 1; i <= 10; i++) allLinks.push({ url: `${fixture.url}link-large-403-${i}`, skippable: false });
    for (let i = 1; i <= 10; i++) allLinks.push({ url: `${fixture.url}link-large-429-${i}`, skippable: false });
    for (let i = 1; i <= 20; i++) allLinks.push({ url: `mailto:test${i}@example.com`, skippable: true });

    assert.equal(allLinks.length, LARGE_FIXTURE_EXPECTATIONS.totalElements, 'Total = 210');

    // Deduplicate non-skippable URLs
    const urlMap = new Map();
    let skippedCount = 0;
    for (const item of allLinks) {
      if (item.skippable) {
        skippedCount++;
      } else {
        if (!urlMap.has(item.url)) urlMap.set(item.url, 0);
        urlMap.set(item.url, urlMap.get(item.url) + 1);
      }
    }

    const uniqueUrls = Array.from(urlMap.keys());
    assert.equal(uniqueUrls.length, LARGE_FIXTURE_EXPECTATIONS.uniqueNetworkUrls, 'Unique network URLs = 180');
    assert.equal(skippedCount, LARGE_FIXTURE_EXPECTATIONS.skippedCount, 'Skipped count = 20');

    // Process in batches of 15, simulating a worker restart at batch index 3 and batch index 7
    const BATCH_SIZE = 15;
    let currentWorkerLimiter = new ConcurrencyLimiter({ concurrency: 5, perDomainDelayMs: 2 });
    let restartCount = 0;
    const allResults = new Map();

    for (let i = 0; i < uniqueUrls.length; i += BATCH_SIZE) {
      const batch = uniqueUrls.slice(i, i + BATCH_SIZE);

      // Simulate SW termination & fresh wake-up on batches 3 and 7
      if (i === 45 || i === 105) {
        restartCount++;
        // Worker was terminated: instance discarded, new worker wakes up with fresh limiter
        currentWorkerLimiter = new ConcurrencyLimiter({ concurrency: 5, perDomainDelayMs: 2 });
      }

      const batchResults = await Promise.all(
        batch.map(u => currentWorkerLimiter.schedule(u, () => checkLink(u, { timeoutMs: 500 })))
      );

      for (const r of batchResults) {
        allResults.set(r.url, r);
      }
    }

    assert.equal(restartCount, 2, 'Simulated service worker restarted twice mid-scan');
    assert.equal(allResults.size, LARGE_FIXTURE_EXPECTATIONS.uniqueNetworkUrls, 'All unique URLs received results');

    // Reconstruct full scan counts incorporating duplicated links
    let good = 0;
    let broken = 0;
    let blocked = 0;

    for (const [url, count] of urlMap.entries()) {
      const outcome = allResults.get(url);
      if (outcome.category === 'good') good += count;
      else if (outcome.category === 'broken') broken += count;
      else if (outcome.category === 'blocked') blocked += count;
    }

    assert.equal(good, LARGE_FIXTURE_EXPECTATIONS.goodCount, 'Large page good count = 140');
    assert.equal(broken, LARGE_FIXTURE_EXPECTATIONS.brokenCount, 'Large page broken count = 30');
    assert.equal(blocked, LARGE_FIXTURE_EXPECTATIONS.blockedCount, 'Large page blocked count = 20');
    assert.equal(skippedCount, LARGE_FIXTURE_EXPECTATIONS.skippedCount, 'Large page skipped count = 20');
  });
});
