/**
 * Security Utilities
 * Input validation, sanitization, and security headers
 * 
 * TODO for contributors:
 * - Add rate limiting per IP
 * - Add request signing/verification
 * - Add API key rotation
 * - Add audit logging
 * - Add anomaly detection
 */

const crypto = require('crypto');

// Input validation
const validators = {
  agentId: (val) => /^[a-z0-9\-_]{1,255}$/.test(val),
  taskId: (val) => /^epstein-batch-\d{4}$/.test(val),
  url: (val) => {
    try {
      new URL(val);
      return true;
    } catch {
      return false;
    }
  },
  confidenceScore: (val) => typeof val === 'number' && val >= 0 && val <= 1,
  verdict: (val) => ['confirm', 'dispute', 'reject', 'flag_victim'].includes(val)
};

// Sanitization
function sanitizeString(input, maxLength = 10000) {
  if (typeof input !== 'string') return '';
  return input.slice(0, maxLength).replace(/[<>\"']/g, '');
}

function sanitizeJSON(obj) {
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value;
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(v => typeof v === 'string' ? sanitizeString(v) : v);
    }
  }
  return sanitized;
}

// Hash sensitive data
function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Generate secure token
function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

module.exports = {
  validators,
  sanitizeString,
  sanitizeJSON,
  hashContent,
  generateToken
};
