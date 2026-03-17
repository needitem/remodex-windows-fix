// FILE: fixed-window-rate-limiter.js
// Purpose: Small in-memory limiter for relay HTTP/WebSocket edge protection.
// Layer: Relay utility
// Exports: FixedWindowRateLimiter
// Depends on: none

class FixedWindowRateLimiter {
  constructor(windowMs = 60_000, maxRequests = 60) {
    this.windowMs = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000;
    this.maxRequests = Number.isFinite(maxRequests) && maxRequests > 0 ? maxRequests : 60;
    this.buckets = new Map();
    this.nextPruneAt = 0;
  }

  allow(key) {
    const now = Date.now();
    const normalizedKey = typeof key === "string" && key.trim() ? key.trim() : "unknown";

    if (!this.nextPruneAt || now >= this.nextPruneAt) {
      this.nextPruneAt = now + this.windowMs;
      for (const [bucketKey, bucket] of this.buckets) {
        if (now >= bucket.expiresAt) {
          this.buckets.delete(bucketKey);
        }
      }
    }

    const existingBucket = this.buckets.get(normalizedKey);
    if (existingBucket && now < existingBucket.expiresAt) {
      if (existingBucket.count >= this.maxRequests) {
        return false;
      }
      existingBucket.count += 1;
      return true;
    }

    this.buckets.set(normalizedKey, {
      count: 1,
      expiresAt: now + this.windowMs,
    });
    return true;
  }
}

module.exports = {
  FixedWindowRateLimiter,
};
