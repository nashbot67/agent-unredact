/**
 * Health Check System
 * Comprehensive system status monitoring
 * 
 * TODO for contributors:
 * - Add external dependency checks (S3, Redis, etc.)
 * - Add data consistency checks
 * - Add performance baselines and alerts
 * - Integrate with monitoring systems (DataDog, New Relic)
 * - Add distributed tracing support
 */

const logger = require('../lib/logger');

class HealthChecker {
  constructor(options = {}) {
    this.startTime = Date.now();
    this.checks = new Map();
  }

  /**
   * Register a health check
   */
  registerCheck(name, checkFn) {
    this.checks.set(name, checkFn);
  }

  /**
   * Run all checks and return status
   */
  async runAllChecks() {
    const results = {};
    const startTime = Date.now();

    for (const [name, checkFn] of this.checks) {
      try {
        const start = Date.now();
        const result = await Promise.race([
          checkFn(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Check timeout')), 5000)
          )
        ]);
        results[name] = {
          status: 'ok',
          duration_ms: Date.now() - start,
          ...result
        };
      } catch (error) {
        results[name] = {
          status: 'error',
          error: error.message,
          duration_ms: Date.now() - startTime
        };
      }
    }

    const allOk = Object.values(results).every(r => r.status === 'ok');
    return {
      status: allOk ? 'healthy' : 'degraded',
      checks: results,
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Quick health check (fast path)
   */
  getBasicHealth() {
    return {
      status: 'ok',
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = HealthChecker;
