/**
 * Stale Task Reaper
 * Releases tasks that have been claimed but not completed within timeout
 * Prevents tasks from being stuck when agents crash or go offline
 * 
 * TODO for contributors:
 * - Add configurable timeout per task priority
 * - Add agent notification before release
 * - Add exponential backoff for repeatedly stale tasks
 * - Track agent reliability score based on stale releases
 * - Add metrics for stale task rate
 */

const logger = require('./logger');

class StaleTaskReaper {
  constructor(tasks, agents, options = {}) {
    this.tasks = tasks; // Map reference
    this.agents = agents; // Map reference
    this.staleTimeoutMs = options.staleTimeoutMs || 60 * 60 * 1000; // 1 hour default
    this.checkIntervalMs = options.checkIntervalMs || 5 * 60 * 1000; // 5 minutes
    this.interval = null;
  }

  start() {
    logger.info('stale_reaper_started', {
      timeout_ms: this.staleTimeoutMs,
      check_interval_ms: this.checkIntervalMs
    });

    this.interval = setInterval(() => this.reap(), this.checkIntervalMs);
    return this;
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  reap() {
    const now = Date.now();
    let released = 0;

    for (const [taskId, task] of this.tasks) {
      if (task.status !== 'claimed' || !task.claimed_at) continue;

      const claimedAt = new Date(task.claimed_at).getTime();
      const elapsed = now - claimedAt;

      if (elapsed > this.staleTimeoutMs) {
        const previousAgent = task.claimed_by;
        
        task.status = 'available';
        task.claimed_by = null;
        task.claimed_at = null;

        // Track agent failure
        if (previousAgent) {
          const agent = this.agents.get(previousAgent);
          if (agent) {
            agent.tasks_failed = (agent.tasks_failed || 0) + 1;
          }
        }

        released++;
        logger.info('stale_task_released', {
          task_id: taskId,
          previous_agent: previousAgent,
          elapsed_ms: elapsed,
          attempts: task.attempts
        });

        // If too many attempts, deprioritize
        if (task.attempts >= (task.max_attempts || 3)) {
          task.priority = Math.max(1, task.priority - 2);
          logger.warn('task_deprioritized', {
            task_id: taskId,
            new_priority: task.priority,
            attempts: task.attempts
          });
        }
      }
    }

    if (released > 0) {
      logger.info('stale_reap_complete', { released });
    }

    return released;
  }
}

module.exports = StaleTaskReaper;
