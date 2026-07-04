interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Returns true when the key has exceeded maxRequests within windowMs.
 * Tracks a single expiration timestamp per key, so the window is fixed from
 * the first request rather than a true sliding window. Good enough for
 * per-route abuse protection on a single Node instance.
 */
export function isRateLimited(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }

  bucket.count++
  return bucket.count > maxRequests
}

/** Clears the bucket for a key. Useful in tests. */
export function resetRateLimit(key: string): void {
  buckets.delete(key)
}
