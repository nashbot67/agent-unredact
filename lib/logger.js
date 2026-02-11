/**
 * Structured Logger
 * JSON logging for production observability
 * 
 * TODO for contributors:
 * - Add log rotation
 * - Add log shipping to Loki/CloudWatch/Datadog
 * - Add request tracing (correlation IDs)
 * - Add log sampling for high-volume endpoints
 * - Add sensitive data masking
 */

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'info'];

function log(level, event, data = {}) {
  if (LOG_LEVELS[level] > CURRENT_LEVEL) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...data
  };

  if (process.env.NODE_ENV === 'production') {
    console.log(JSON.stringify(entry));
  } else {
    const icon = { error: '❌', warn: '⚠️', info: 'ℹ️', debug: '🔍' }[level];
    const details = Object.keys(data).length > 0
      ? ' ' + Object.entries(data).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')
      : '';
    console.log(`${icon} [${level.toUpperCase()}] ${event}${details}`);
  }
}

module.exports = {
  error: (event, data) => log('error', event, data),
  warn: (event, data) => log('warn', event, data),
  info: (event, data) => log('info', event, data),
  debug: (event, data) => log('debug', event, data),
  
  // Express request logging middleware
  requestLogger() {
    return (req, res, next) => {
      const start = Date.now();
      const originalEnd = res.end;

      res.end = function(...args) {
        const duration = Date.now() - start;
        log('info', 'http_request', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration_ms: duration,
          agent_id: req.headers['x-agent-id'] || null,
          ip: req.ip
        });
        originalEnd.apply(res, args);
      };

      next();
    };
  }
};
