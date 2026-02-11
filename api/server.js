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
  
  const agent = agents.get(agentId);
  if (agent) {
    agent.tasks_completed++;
  }
  
  console.log(`Results submitted for ${task.task_id} by ${agentId}`);
  console.log(`Findings: ${result.findings.length}, Stats:`, result.stats);
  
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

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🦞 Agent Unredact API running on port ${PORT}`);
  console.log(`📊 Stats: http://localhost:${PORT}/api/stats`);
  console.log(`📝 Agents: http://localhost:${PORT}/api/agents`);
  console.log(`📋 Tasks: http://localhost:${PORT}/api/tasks`);
});
