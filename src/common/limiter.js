/**
 * LinkSentry Concurrency Limiter & Rate Limiter
 *
 * Enforces:
 * 1. Global concurrency cap (e.g. max 5 simultaneous checks)
 * 2. Per-domain delay (respectful checking, no hammering a single server)
 */

export class ConcurrencyLimiter {
  /**
   * @param {Object} options
   * @param {number} [options.concurrency=5] - Maximum parallel in-flight tasks
   * @param {number} [options.perDomainDelayMs=50] - Minimum delay between requests to same domain
   */
  constructor({ concurrency = 5, perDomainDelayMs = 50 } = {}) {
    this.concurrency = Math.max(1, concurrency);
    this.perDomainDelayMs = Math.max(0, perDomainDelayMs);
    this.activeCount = 0;
    this.queue = [];
    this.lastRequestPerDomain = new Map();
  }

  /**
   * Schedules a task function bound to a target URL.
   * @template T
   * @param {string} url - Target URL being checked
   * @param {() => Promise<T>} taskFn - Async function performing the check
   * @returns {Promise<T>}
   */
  schedule(url, taskFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        url,
        taskFn,
        resolve,
        reject
      });
      this._drain();
    });
  }

  /**
   * Checks queue and starts tasks if capacity permits.
   * @private
   */
  _drain() {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      this.activeCount++;
      this._executeItem(item);
    }
  }

  /**
   * Executes a scheduled item with per-domain rate limiting.
   * @private
   * @param {Object} item
   */
  async _executeItem(item) {
    const { url, taskFn, resolve, reject } = item;

    let domain = 'unknown';
    try {
      domain = new URL(url).hostname.toLowerCase();
    } catch {
      domain = 'local';
    }

    const now = Date.now();
    const lastScheduled = this.lastRequestPerDomain.get(domain) || 0;
    const scheduledTime = Math.max(now, lastScheduled + this.perDomainDelayMs);
    this.lastRequestPerDomain.set(domain, scheduledTime);

    const waitTime = scheduledTime - now;
    if (waitTime > 0) {
      await new Promise(r => setTimeout(r, waitTime));
    }

    try {
      const result = await taskFn();
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this.activeCount--;
      this._drain();
    }
  }

  /**
   * Returns current active task count (useful for testing).
   */
  getActiveCount() {
    return this.activeCount;
  }

  /**
   * Returns current queued task count.
   */
  getQueueLength() {
    return this.queue.length;
  }
}
