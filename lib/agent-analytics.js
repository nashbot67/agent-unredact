/**
 * Agent Analytics
 * Tracks agent performance metrics and reputation
 * 
 * Metrics tracked per agent:
 * - Tasks completed/failed
 * - Average processing time per page
 * - Finding accuracy (through verification feedback)
 * - Uptime and reliability
 * - Contribution to published findings
 * 
 * TODO for contributors:
 * - Add Bayesian reputation scoring
 * - Add agent grouping by skill/capability
 * - Add contribution rewards/incentives
 * - Add performance trends over time
 * - Add peer comparison analytics
 */

class AgentAnalytics {
  constructor(agents, tasks, results, verifications) {
    this.agents = agents;
    this.tasks = tasks;
    this.results = results;
    this.verifications = verifications;
  }

  /**
   * Get comprehensive analytics for an agent
   */
  getAgentStats(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    // Find all tasks claimed by this agent
    const agentTasks = Array.from(this.tasks.values())
      .filter(t => t.claimed_by === agentId);

    const completedTasks = agentTasks.filter(t => t.status === 'completed');
    const failedTasks = agentTasks.filter(t => t.status === 'failed' || (t.attempts >= (t.max_attempts || 3) && t.status === 'available'));

    // Find all results submitted by this agent
    const agentResults = Array.from(this.results.values())
      .filter(r => r.agent_id === agentId);

    const totalPages = agentResults.reduce((sum, r) => sum + (r.stats?.pages_processed || 0), 0);
    const totalFindings = agentResults.reduce((sum, r) => sum + (r.findings?.length || 0), 0);

    return {
      agent_id: agentId,
      registered_at: agent.registered_at,
      capabilities: agent.capabilities,
      performance: {
        tasks_completed: completedTasks.length,
        tasks_claimed: agentTasks.length,
        tasks_failed: failedTasks.length,
        success_rate: agentTasks.length > 0 
          ? (completedTasks.length / agentTasks.length * 100).toFixed(2) + '%'
          : 'N/A',
        pages_processed: totalPages,
        findings_submitted: totalFindings,
        avg_findings_per_task: agentResults.length > 0 
          ? (totalFindings / agentResults.length).toFixed(1)
          : 0
      },
      reputation: {
        score: agent.reputation_score || 0,
        status: agent.status || 'active'
      }
    };
  }

  /**
   * Get leaderboard sorted by metric
   */
  getLeaderboard(sortBy = 'tasks_completed', limit = 50) {
    const agents = Array.from(this.agents.values())
      .map(agent => this.getAgentStats(agent.agent_id))
      .filter(Boolean);

    // Sort by requested metric
    const metric = sortBy.split('.').reduce((obj, key) => obj?.[key], { performance: {} });
    
    if (sortBy.startsWith('performance.')) {
      const key = sortBy.substring(12);
      agents.sort((a, b) => {
        const aVal = parseInt(a.performance[key]) || 0;
        const bVal = parseInt(b.performance[key]) || 0;
        return bVal - aVal;
      });
    }

    return agents.slice(0, limit);
  }

  /**
   * Agent activity over time
   */
  getAgentTimeline(agentId, hours = 24) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    const cutoff = Date.now() - (hours * 60 * 60 * 1000);
    
    const agentResults = Array.from(this.results.values())
      .filter(r => r.agent_id === agentId && new Date(r.completed_at).getTime() > cutoff);

    return {
      agent_id: agentId,
      period_hours: hours,
      activity_count: agentResults.length,
      total_pages: agentResults.reduce((sum, r) => sum + (r.stats?.pages_processed || 0), 0),
      results: agentResults.map(r => ({
        task_id: r.task_id,
        completed_at: r.completed_at,
        pages_processed: r.stats?.pages_processed || 0,
        findings: r.findings?.length || 0
      }))
    };
  }
}

module.exports = AgentAnalytics;
