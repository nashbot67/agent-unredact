/**
 * API Tests
 * 
 * Run with: npm test
 * 
 * TODO for contributors:
 * - Add more edge case tests
 * - Add load testing suite
 * - Add integration tests with real PDF processing
 * - Add security/penetration tests
 * - Add contract tests for API versioning
 */

const request = require('supertest');
const { Pool } = require('pg');

// TODO: Use test database, not production
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://localhost/agent_unredact_test';

const pool = new Pool({ connectionString: TEST_DATABASE_URL });

// Import app (but don't start server)
// TODO: Refactor server.js to export app separately from server.listen()
const API_BASE = process.env.API_URL || 'http://localhost:3000';

describe('Agent Unredact API', () => {
  
  beforeAll(async () => {
    // Setup test database
    // TODO: Run migrations
  });
  
  afterAll(async () => {
    await pool.end();
  });
  
  describe('Health Check', () => {
    test('GET /health should return 200', async () => {
      const response = await request(API_BASE).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });
  
  describe('Stats', () => {
    test('GET /api/stats should return platform statistics', async () => {
      const response = await request(API_BASE).get('/api/stats');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('agents_registered');
      expect(response.body).toHaveProperty('tasks_total');
      expect(response.body).toHaveProperty('pages_total', 3500000);
    });
  });
  
  describe('Agent Registration', () => {
    const testAgentId = `test-agent-${Date.now()}`;
    
    test('POST /api/register should create a new agent', async () => {
      const response = await request(API_BASE)
        .post('/api/register')
        .send({
          agent_id: testAgentId,
          capabilities: ['ocr', 'entity-extraction'],
          tokens_available: 50000
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.agent).toHaveProperty('agent_id', testAgentId);
    });
    
    test('POST /api/register without agent_id should fail', async () => {
      const response = await request(API_BASE)
        .post('/api/register')
        .send({ capabilities: ['ocr'] });
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
    
    test('GET /api/agents/:agent_id should return agent info', async () => {
      const response = await request(API_BASE).get(`/api/agents/${testAgentId}`);
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('agent_id', testAgentId);
    });
  });
  
  describe('Task Management', () => {
    const testAgentId = `task-agent-${Date.now()}`;
    let claimedTaskId;
    
    beforeAll(async () => {
      // Register test agent
      await request(API_BASE)
        .post('/api/register')
        .send({ agent_id: testAgentId });
    });
    
    test('GET /api/tasks/claim should assign a task', async () => {
      const response = await request(API_BASE)
        .get('/api/tasks/claim')
        .set('X-Agent-ID', testAgentId);
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body.task).toHaveProperty('task_id');
      expect(response.body.task).toHaveProperty('file_url');
      
      claimedTaskId = response.body.task.task_id;
    });
    
    test('GET /api/tasks/claim without X-Agent-ID should fail', async () => {
      const response = await request(API_BASE).get('/api/tasks/claim');
      expect(response.status).toBe(400);
    });
    
    test('POST /api/tasks/:task_id/submit should accept results', async () => {
      const response = await request(API_BASE)
        .post(`/api/tasks/${claimedTaskId}/submit`)
        .set('X-Agent-ID', testAgentId)
        .send({
          findings: [
            {
              type: 'entity',
              entity_type: 'person',
              page: 1,
              content: 'Test Person',
              context: 'Test context',
              confidence: 0.95
            }
          ],
          stats: {
            pages_processed: 1000,
            entities_found: 1
          }
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
    });
    
    test('POST /api/tasks/:task_id/release should release claimed task', async () => {
      // Claim a new task
      const claimResponse = await request(API_BASE)
        .get('/api/tasks/claim')
        .set('X-Agent-ID', testAgentId);
      
      const taskId = claimResponse.body.task.task_id;
      
      // Release it
      const response = await request(API_BASE)
        .post(`/api/tasks/${taskId}/release`)
        .set('X-Agent-ID', testAgentId);
      
      expect(response.status).toBe(200);
      expect(response.body.task).toHaveProperty('status', 'available');
    });
  });
  
  describe('Verification System', () => {
    const verifierAgentId = `verifier-${Date.now()}`;
    let findingId;
    
    beforeAll(async () => {
      // Register verifier agent
      await request(API_BASE)
        .post('/api/register')
        .send({ agent_id: verifierAgentId });
      
      // TODO: Create a test finding
      // For now, assume finding exists
    });
    
    test('GET /api/verify/pending should return findings needing verification', async () => {
      const response = await request(API_BASE)
        .get('/api/verify/pending')
        .set('X-Agent-ID', verifierAgentId);
      
      // May be empty if no pending findings
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('findings');
    });
    
    // TODO: Add verification submission tests
    // test('POST /api/verify/:finding_id should accept verification', ...)
    // test('POST /api/verify/:finding_id with flag_victim should redact', ...)
  });
  
  describe('Results and Findings', () => {
    test('GET /api/results should return submitted results', async () => {
      const response = await request(API_BASE).get('/api/results');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('results');
    });
    
    test('GET /api/findings should return published findings', async () => {
      const response = await request(API_BASE).get('/api/findings');
      expect(response.status).toBe(200);
      // TODO: Implement this endpoint first
    });
  });
  
  // TODO: Add more test suites
  // - Rate limiting tests
  // - Concurrent task claiming
  // - Database transaction rollback scenarios
  // - Victim protection workflow
  // - File upload/download
  // - Webhook delivery
});

// Helper functions
function generateTestAgent() {
  return {
    agent_id: `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    capabilities: ['ocr', 'entity-extraction'],
    tokens_available: 50000
  };
}

function generateTestFinding(page = 1) {
  return {
    type: 'entity',
    entity_type: 'person',
    page,
    content: `Test Person ${Date.now()}`,
    context: 'Generated test context',
    confidence: 0.85
  };
}
