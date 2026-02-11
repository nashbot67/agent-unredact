/**
 * Batch Status Tracker
 * Tracks progress through the 3.5M page corpus
 * 
 * Metrics:
 * - Total pages available/claimed/completed/verified
 * - Progress percentage and ETA
 * - Distribution by priority
 * - Hotspots (frequently failed batches)
 * 
 * TODO for contributors:
 * - Add predictive ETA based on agent velocity
 * - Add batch health scoring (success rate)
 * - Add geographic distribution tracking
 * - Add topic/document type tracking
 */

class BatchStatus {
  constructor(tasks, agents) {
    this.tasks = tasks;
    this.agents = agents;
  }

  getProgress() {
    const totalTasks = this.tasks.size;
    const taskList = Array.from(this.tasks.values());

    const available = taskList.filter(t => t.status === 'available').length;
    const claimed = taskList.filter(t => t.status === 'claimed').length;
    const completed = taskList.filter(t => t.status === 'completed').length;
    const verified = taskList.filter(t => t.status === 'verified').length;

    const totalPages = taskList.reduce((sum, t) => sum + (t.total_pages || 1000), 0);
    const pagesCompleted = completed * 1000;

    const progressPercent = totalPages > 0 ? (pagesCompleted / totalPages * 100) : 0;
    const activeAgents = Array.from(this.agents.values())
      .filter(a => a.tasks_completed > 0).length;

    return {
      tasks: {
        total: totalTasks,
        available,
        claimed,
        completed,
        verified,
        failed: taskList.filter(t => t.status === 'failed').length
      },
      pages: {
        total: totalPages,
        completed: pagesCompleted,
        progress_percent: progressPercent.toFixed(2),
        remaining: totalPages - pagesCompleted
      },
      agents: {
        registered: this.agents.size,
        active: activeAgents
      },
      eta: this._estimateETA(completed, activeAgents),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Estimate time to completion
   * Assumes linear progress based on current rate
   */
  _estimateETA(completedBatches, activeAgents) {
    if (activeAgents === 0 || completedBatches === 0) {
      return 'Unknown';
    }

    const totalBatches = 3500;
    const remainingBatches = totalBatches - completedBatches;
    const avgBatchesPerAgentPerDay = 5; // TODO: Calculate from actual data

    const daysRemaining = remainingBatches / (activeAgents * avgBatchesPerAgentPerDay);
    const eta = new Date(Date.now() + daysRemaining * 24 * 60 * 60 * 1000);

    return {
      days_remaining: Math.ceil(daysRemaining),
      estimated_completion: eta.toISOString(),
      assumption: 'Linear progress, avg 5 batches/agent/day'
    };
  }

  /**
   * Find problematic batches (failed repeatedly)
   */
  getProblemBatches(threshold = 2) {
    const problems = Array.from(this.tasks.values())
      .filter(t => t.attempts >= threshold)
      .sort((a, b) => b.attempts - a.attempts)
      .slice(0, 20);

    return problems.map(t => ({
      task_id: t.task_id,
      attempts: t.attempts,
      status: t.status,
      last_claimed_by: t.claimed_by
    }));
  }

  /**
   * Distribution of tasks by priority
   */
  getPriorityDistribution() {
    const dist = {};
    
    for (const task of this.tasks.values()) {
      const p = task.priority || 5;
      if (!dist[p]) dist[p] = { available: 0, claimed: 0, completed: 0 };
      
      const status = task.status;
      if (status === 'available') dist[p].available++;
      else if (status === 'claimed') dist[p].claimed++;
      else if (status === 'completed') dist[p].completed++;
    }

    return dist;
  }
}

module.exports = BatchStatus;
