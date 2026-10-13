/**
 * LinkSentry Configuration & Feature Flags
 * 
 * Free MVP: Pro features architected behind feature flags, all set to false.
 */

export const FEATURES = Object.freeze({
  siteWideCrawl: false,
  csvExport: false,
  scheduledRechecks: false
});

export const DEFAULT_CONFIG = Object.freeze({
  concurrency: 5,
  timeoutMs: 8000,
  perDomainDelayMs: 50,
  colors: {
    good: '#10b981',      // Emerald green
    broken: '#ef4444',    // Bright red
    blocked: '#f59e0b'    // Amber / warning
  }
});
