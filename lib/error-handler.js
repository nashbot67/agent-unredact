/**
 * Error Handling Middleware
 * Centralized error handling for Express API
 * 
 * TODO for contributors:
 * - Add Sentry/Rollbar integration
 * - Add error categorization (client vs server)
 * - Add error rate tracking for alerting
 * - Add stack trace filtering for production
 */

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

// Common errors
const Errors = {
  BadRequest: (msg) => new AppError(msg || 'Bad request', 400, 'BAD_REQUEST'),
  Unauthorized: (msg) => new AppError(msg || 'Unauthorized', 401, 'UNAUTHORIZED'),
  Forbidden: (msg) => new AppError(msg || 'Forbidden', 403, 'FORBIDDEN'),
  NotFound: (msg) => new AppError(msg || 'Not found', 404, 'NOT_FOUND'),
  Conflict: (msg) => new AppError(msg || 'Conflict', 409, 'CONFLICT'),
  RateLimit: (msg) => new AppError(msg || 'Rate limit exceeded', 429, 'RATE_LIMIT'),
};

// 404 handler
function notFoundHandler(req, res, _next) {
  res.status(404).json({
    error: `Route not found: ${req.method} ${req.path}`,
    code: 'NOT_FOUND',
    status: 404,
    docs: 'https://github.com/nashbot67/agent-unredact/blob/main/docs/API.md'
  });
}

// Global error handler
function errorHandler(err, req, res, _next) {
  const statusCode = err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  // Log error
  if (statusCode >= 500) {
    console.error(`❌ [${req.method} ${req.path}] ${err.message}`);
    if (!isProduction) console.error(err.stack);
  }

  res.status(statusCode).json({
    error: err.message,
    code: err.code || 'INTERNAL_ERROR',
    status: statusCode,
    ...(isProduction ? {} : { stack: err.stack })
  });
}

module.exports = { AppError, Errors, notFoundHandler, errorHandler };
