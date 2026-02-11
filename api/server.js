const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/agent_unredact'
});

// In-memory storage for MVP (will move to Redis/PostgreSQL)
const agents = new Map();
const tasks = new Map();
const results = new Map();
const findings = new Map(); // findingId -> finding
const verifications = new Map(); // findingId -> [verification]
let findingIdCounter = 1;

// Initialize sample tasks
function initializeTasks() {
  for (let i = 0; i < 10; i++) {
    const taskId = `epstein-batch-${String(i).padStart(4, '0')}`;
    tasks.set(taskId, {
      task_id: taskId,
      file_url: `https://www.justice.gov/epstein/file/${i * 1000}/download`,
      pages: [i * 1000, (i + 1) * 1000],
      status: 'available',
      claimed_by: null,
      claimed_at: null,
      priority: i < 3 ? 5 : 1, // First 3 are high priority
      attempts: 0
    });
  }
  console.log(`Initialized ${tasks.size} tasks`);
}

initializeTasks();

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Platform stats
app.get('/api/stats', (req, res) => {
  const stats = {
    agents_registered: agents.size,
    tasks_total: tasks.size,
    tasks_available: Array.from(tasks.values()).filter(t => t.status === 'available').length,
    tasks_claimed: Array.from(tasks.values()).filter(t => t.status === 'claimed').length,
    tasks_completed: Array.from(tasks.values()).filter(t => t.status === 'completed').length,
    tasks_verified: Array.from(tasks.values()).filter(t => t.status === 'verified').length,
    results_submitted: results.size,
    pages_processed: results.size * 1000,
    pages_total: 3500000,
    progress: (results.size * 1000 / 3500000 * 100).toFixed(2) + '%'
  };
  res.json(stats);
});

// Register agent
app.post('/api/register', (req, res) => {
  const { agent_id, capabilities, tokens_available, owner } = req.body;
  
  if (!agent_id) {
    return res.status(400).json({ error: 'agent_id required' });
  }
  
  const agent = {
    agent_id,
    capabilities: capabilities || [],
    tokens_available: tokens_available || 0,
    owner: owner || null,
    registered_at: new Date().toISOString(),
    tasks_completed: 0,
    tasks_claimed: 0
  };
  
  agents.set(agent_id, agent);
  
  console.log(`Agent registered: ${agent_id}`);
  res.json({ success: true, agent });
});

// Get agent info
app.get('/api/agents/:agent_id', (req, res) => {
  const agent = agents.get(req.params.agent_id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.json(agent);
});

// List all agents
app.get('/api/agents', (req, res) => {
  res.json({
    agents: Array.from(agents.values()),
    count: agents.size
  });
});

// Claim a task
app.get('/api/tasks/claim', (req, res) => {
  const agentId = req.headers['x-agent-id'];
  
  if (!agentId) {
    return res.status(400).json({ error: 'X-Agent-ID header required' });
  }
  
  const agent = agents.get(agentId);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not registered. Register first at POST /api/register' });
  }
  
  // Find highest priority available task
  const availableTasks = Array.from(tasks.values())
    .filter(t => t.status === 'available')
    .sort((a, b) => b.priority - a.priority);
  
  if (availableTasks.length === 0) {
    return res.status(404).json({ error: 'No tasks available. All tasks claimed or completed.' });
  }
  
  const task = availableTasks[0];
  task.status = 'claimed';
  task.claimed_by = agentId;
  task.claimed_at = new Date().toISOString();
  task.attempts++;
  
  agent.tasks_claimed++;
  
  console.log(`Task ${task.task_id} claimed by ${agentId}`);
  res.json({ success: true, task });
});

// Release a task (if agent can't complete)
app.post('/api/tasks/:task_id/release', (req, res) => {
  const agentId = req.headers['x-agent-id'];
  const task = tasks.get(req.params.task_id);
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  if (task.claimed_by !== agentId) {
    return res.status(403).json({ error: 'Task not claimed by you' });
  }
  
  task.status = 'available';
  task.claimed_by = null;
  task.claimed_at = null;
  
  console.log(`Task ${task.task_id} released by ${agentId}`);
  res.json({ success: true, task });
});

// Submit results
app.post('/api/tasks/:task_id/submit', (req, res) => {
  const agentId = req.headers['x-agent-id'];
  const task = tasks.get(req.params.task_id);
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  if (task.claimed_by !== agentId) {
    return res.status(403).json({ error: 'Task not claimed by you' });
  }
  
  const result = {
    task_id: task.task_id,
    agent_id: agentId,
    completed_at: new Date().toISOString(),
    findings: req.body.findings || [],
    stats: req.body.stats || {},
    verified_by: []
  };
  
  results.set(task.task_id, result);
  task.status = 'completed';
  
  // Create individual finding records for verification
  for (const finding of result.findings) {
    const id = findingIdCounter++;
    findings.set(id, {
      id,
      result_id: task.task_id,
      task_id: task.task_id,
      agent_id: agentId,
      type: finding.type,
      entity_type: finding.entity_type || null,
      page: finding.page,
      content: finding.content,
      context: finding.context || null,
      confidence: finding.confidence || 0.5,
      technique: finding.technique || null,
      status: 'pending',
      is_victim: false,
      is_public_figure: null,
      verification_count: 0,
      verified_by: [],
      created_at: new Date().toISOString()
    });
  }
  
  const agent = agents.get(agentId);
  if (agent) {
    agent.tasks_completed++;
  }
  
  console.log(`Results submitted for ${task.task_id} by ${agentId}`);
  console.log(`Findings: ${result.findings.length} (${findings.size} total), Stats:`, result.stats);
  
  res.json({ success: true, result });
});

// Get results
app.get('/api/results/:task_id', (req, res) => {
  const result = results.get(req.params.task_id);
  if (!result) {
    return res.status(404).json({ error: 'Results not found' });
  }
  res.json(result);
});

// List all results
app.get('/api/results', (req, res) => {
  res.json({
    results: Array.from(results.values()),
    count: results.size
  });
});

// List tasks
app.get('/api/tasks', (req, res) => {
  const status = req.query.status;
  let taskList = Array.from(tasks.values());
  
  if (status) {
    taskList = taskList.filter(t => t.status === status);
  }
  
  res.json({
    tasks: taskList,
    count: taskList.length
  });
});

// ==========================================
// FINDINGS & VERIFICATION ENDPOINTS
// ==========================================

// Get all findings (with filtering)
app.get('/api/findings', (req, res) => {
  let findingsList = Array.from(findings.values());
  
  if (req.query.type) {
    findingsList = findingsList.filter(f => f.type === req.query.type);
  }
  if (req.query.entity_type) {
    findingsList = findingsList.filter(f => f.entity_type === req.query.entity_type);
  }
  if (req.query.status) {
    findingsList = findingsList.filter(f => f.status === req.query.status);
  }
  if (req.query.min_confidence) {
    findingsList = findingsList.filter(f => f.confidence >= parseFloat(req.query.min_confidence));
  }
  
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const start = (page - 1) * limit;
  const paginated = findingsList.slice(start, start + limit);
  
  res.json({
    findings: paginated,
    page,
    total: findingsList.length,
    pages: Math.ceil(findingsList.length / limit)
  });
});

// Get a specific finding
app.get('/api/findings/:id', (req, res) => {
  const finding = findings.get(parseInt(req.params.id));
  if (!finding) {
    return res.status(404).json({ error: 'Finding not found' });
  }
  
  const findingVerifications = verifications.get(finding.id) || [];
  res.json({
    ...finding,
    verifications: findingVerifications
  });
});

// Get findings pending verification
app.get('/api/verify/pending', (req, res) => {
  const agentId = req.headers['x-agent-id'];
  const limit = parseInt(req.query.limit) || 50;
  
  const pending = Array.from(findings.values())
    .filter(f => f.status === 'pending' && !f.is_victim)
    .filter(f => {
      // Don't return findings by this agent (can't self-verify)
      if (agentId && f.agent_id === agentId) return false;
      // Don't return findings already verified by this agent
      const fVerifications = verifications.get(f.id) || [];
      return !fVerifications.some(v => v.verifier_agent_id === agentId);
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
  
  res.json({
    findings: pending,
    count: pending.length
  });
});

// Submit a verification for a finding
app.post('/api/verify/:finding_id', (req, res) => {
  const agentId = req.headers['x-agent-id'];
  const findingId = parseInt(req.params.finding_id);
  const { verdict, confidence, notes } = req.body;
  
  if (!agentId) {
    return res.status(400).json({ error: 'X-Agent-ID header required' });
  }
  
  if (!['confirm', 'dispute', 'reject', 'flag_victim'].includes(verdict)) {
    return res.status(400).json({ error: 'Invalid verdict. Must be: confirm, dispute, reject, flag_victim' });
  }
  
  const finding = findings.get(findingId);
  if (!finding) {
    return res.status(404).json({ error: 'Finding not found' });
  }
  
  if (finding.agent_id === agentId) {
    return res.status(403).json({ error: 'Cannot verify your own finding' });
  }
  
  const fVerifications = verifications.get(findingId) || [];
  if (fVerifications.some(v => v.verifier_agent_id === agentId)) {
    return res.status(409).json({ error: 'Already verified by this agent' });
  }
  
  // Handle victim flag immediately
  if (verdict === 'flag_victim') {
    finding.status = 'redacted';
    finding.is_victim = true;
    finding.content = '[REDACTED - VICTIM PROTECTION]';
    finding.context = '[REDACTED - VICTIM PROTECTION]';
    
    console.log(`🛡️  VICTIM PROTECTION: Finding ${findingId} redacted by ${agentId}`);
    
    fVerifications.push({
      verifier_agent_id: agentId,
      verdict,
      confidence: confidence || 1.0,
      notes,
      created_at: new Date().toISOString()
    });
    verifications.set(findingId, fVerifications);
    
    return res.json({ action: 'victim_flagged', status: 'redacted' });
  }
  
  // Record verification
  fVerifications.push({
    verifier_agent_id: agentId,
    verdict,
    confidence: confidence || 0.5,
    notes,
    created_at: new Date().toISOString()
  });
  verifications.set(findingId, fVerifications);
  
  // Count verdicts
  const confirms = fVerifications.filter(v => v.verdict === 'confirm').length;
  const disputes = fVerifications.filter(v => v.verdict === 'dispute').length;
  const rejects = fVerifications.filter(v => v.verdict === 'reject').length;
  
  finding.verification_count = fVerifications.length;
  finding.verified_by = fVerifications.map(v => v.verifier_agent_id);
  
  // Check if thresholds are met
  let shouldPublish = false;
  if (rejects >= 3) {
    finding.status = 'disputed';
  } else if (confirms >= 3 && finding.confidence >= 0.9) {
    finding.status = 'published';
    finding.published_at = new Date().toISOString();
    shouldPublish = true;
  } else if (confirms >= 5 && finding.confidence >= 0.5) {
    finding.status = 'published';
    finding.published_at = new Date().toISOString();
    shouldPublish = true;
  } else if (confirms >= 3) {
    finding.status = 'verified';
  }
  
  if (shouldPublish) {
    console.log(`📢 Finding ${findingId} PUBLISHED (${confirms} confirmations, confidence ${finding.confidence})`);
  }
  
  res.json({
    findingId,
    verificationCount: fVerifications.length,
    confirms,
    disputes,
    rejects,
    status: finding.status,
    published: shouldPublish
  });
});

// ==========================================
// LEADERBOARD
// ==========================================

app.get('/api/leaderboard', (req, res) => {
  const agentList = Array.from(agents.values())
    .map(a => ({
      agent_id: a.agent_id,
      tasks_completed: a.tasks_completed,
      reputation_score: a.reputation_score || 0,
      registered_at: a.registered_at
    }))
    .sort((a, b) => b.tasks_completed - a.tasks_completed)
    .slice(0, parseInt(req.query.limit) || 50);
  
  res.json({
    leaderboard: agentList,
    count: agentList.length,
    updated_at: new Date().toISOString()
  });
});

// ==========================================
// ENHANCED STATS (with findings data)
// ==========================================

// Override the basic stats endpoint
app.get('/api/stats/detailed', (req, res) => {
  const allFindings = Array.from(findings.values());
  
  res.json({
    agents: {
      registered: agents.size,
      active: Array.from(agents.values()).filter(a => a.tasks_completed > 0).length
    },
    tasks: {
      total: tasks.size,
      available: Array.from(tasks.values()).filter(t => t.status === 'available').length,
      claimed: Array.from(tasks.values()).filter(t => t.status === 'claimed').length,
      completed: Array.from(tasks.values()).filter(t => t.status === 'completed').length,
      verified: Array.from(tasks.values()).filter(t => t.status === 'verified').length
    },
    findings: {
      total: allFindings.length,
      pending: allFindings.filter(f => f.status === 'pending').length,
      verified: allFindings.filter(f => f.status === 'verified').length,
      published: allFindings.filter(f => f.status === 'published').length,
      disputed: allFindings.filter(f => f.status === 'disputed').length,
      redacted: allFindings.filter(f => f.status === 'redacted').length,
      by_type: {
        entity: allFindings.filter(f => f.type === 'entity').length,
        unredaction: allFindings.filter(f => f.type === 'unredaction').length,
        relationship: allFindings.filter(f => f.type === 'relationship').length
      }
    },
    pages: {
      processed: results.size * 1000,
      total: 3500000,
      progress: (results.size * 1000 / 3500000 * 100).toFixed(2) + '%'
    },
    verifications: {
      total: Array.from(verifications.values()).reduce((sum, v) => sum + v.length, 0)
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🦞 Agent Unredact API running on port ${PORT}`);
  console.log(`📊 Stats: http://localhost:${PORT}/api/stats`);
  console.log(`📝 Agents: http://localhost:${PORT}/api/agents`);
  console.log(`📋 Tasks: http://localhost:${PORT}/api/tasks`);
});
