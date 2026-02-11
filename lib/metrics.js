/**
 * Metrics Collection
 * Prometheus-compatible metrics for monitoring
 * 
 * TODO for contributors:
 * - Export to Prometheus endpoint
 * - Add histogram buckets for latency
 * - Add gauge for active agents
 * - Add counter for verification verdicts
 * - Integrate with Grafana dashboards
 */

class Metrics {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
  }

  incrementCounter(name, value = 1, labels = {}) {
    const key = this._labelKey(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  setGauge(name, value, labels = {}) {
    const key = this._labelKey(name, labels);
    this.gauges.set(key, value);
  }

  recordHistogram(name, value, labels = {}) {
    const key = this._labelKey(name, labels);
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }
    this.histograms.get(key).push(value);
  }

  _labelKey(name, labels) {
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  getStats() {
    const histStats = {};
    for (const [key, values] of this.histograms) {
      if (values.length === 0) continue;
      const sorted = values.sort((a, b) => a - b);
      histStats[key] = {
        min: sorted[0],
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
        max: sorted[sorted.length - 1],
        count: sorted.length,
        avg: sorted.reduce((a, b) => a + b, 0) / sorted.length
      };
    }

    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: histStats
    };
  }

  // Prometheus text format
  toPrometheus() {
    let output = '';

    for (const [key, value] of this.counters) {
      output += `# TYPE ${key} counter\n${key} ${value}\n`;
    }

    for (const [key, value] of this.gauges) {
      output += `# TYPE ${key} gauge\n${key} ${value}\n`;
    }

    return output;
  }
}

module.exports = new Metrics();
