/**
 * Rate Limiting Middleware
 * In-memory rate limiter for MVP (swap to Redis for production)
 * 
 * TODO for contributors:
 * - Replace with Redis-backed rate limiter for horizontal scaling
 * - Add per-endpoint rate limits (different limits for claim vs read)
 * - Add burst allowance (token bucket algorithm)
 * - Add rate limit headers (X-RateLimit-Remaining, X-RateLimit-Reset)
 * - Add IP-based rate limiting for unauthenticated endpoints
 * - Add webhook for rate limit alerts
 */

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60 * 1000; // 1 minute default
    this.maxRequests = options.maxRequests || 100;
    this.store = new Map(); // agentId -> { count, resetAt }
    
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.resetAt <= now) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Express middleware
   */
  middleware() {
    return (req, res, next) => {
      const agentId = req.headers['x-agent-id'] || req.ip || 'anonymous';
      const now = Date.now();

      let entry = this.store.get(agentId);

      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + this.windowMs };
        this.store.set(agentId, entry);
      }

      entry.count++;

      // Set rate limit headers
      const remaining = Math.max(0, this.maxRequests - entry.count);
      const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);

      res.set('X-RateLimit-Limit', String(this.maxRequests));
      res.set('X-RateLimit-Remaining', String(remaining));
      res.set('X-RateLimit-Reset', String(resetSeconds));

      if (entry.count > this.maxRequests) {
        console.log(`⚠️  Rate limit exceeded: ${agentId} (${entry.count}/${this.maxRequests})`);
        return res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter: resetSeconds,
          limit: this.maxRequests,
          windowMs: this.windowMs
        });
      }

      next();
    };
  }

  /**
   * Get current usage for an agent
   */
  getUsage(agentId) {
    const entry = this.store.get(agentId);
    if (!entry) return { count: 0, remaining: this.maxRequests };
    return {
      count: entry.count,
      remaining: Math.max(0, this.maxRequests - entry.count),
      resetAt: new Date(entry.resetAt).toISOString()
    };
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

module.exports = RateLimiter;
