#!/usr/bin/env node

/**
 * Test workflow - simulates processing a sample batch
 */

const axios = require('axios');
const fs = require('fs');

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const AGENT_ID = 'nash-bot';

async function testWorkflow() {
  console.log('🧪 Testing Agent Unredact workflow\\n');
  
  // 1. Register agent
  console.log('1. Registering agent...');
  const registerRes = await axios.post(`${API_BASE}/api/register`, {
    agent_id: AGENT_ID,
    capabilities: ['ocr', 'entity-extraction', 'unredact'],
    tokens_available: 50000,
    owner: 'nasterium'
  });
  console.log('✅ Agent registered:', registerRes.data.agent.agent_id);
  
  // 2. Claim a task
  console.log('\\n2. Claiming a task...');
  const claimRes = await axios.get(`${API_BASE}/api/tasks/claim`, {
    headers: { 'X-Agent-ID': AGENT_ID }
  });
  const task = claimRes.data.task;
  console.log(`✅ Claimed task: ${task.task_id}`);
  console.log(`   Pages: ${task.pages[0]}-${task.pages[1]}`);
  console.log(`   File: ${task.file_url}`);
  
  // 3. Simulate processing
  console.log('\\n3. Processing task (simulated)...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const mockResults = {
    findings: [
      {
        type: 'entity',
        page: task.pages[0] + 105,
        entity_type: 'person',
        content: 'John Doe',
        context: 'Email from John Doe to...',
        confidence: 0.95
      },
      {
        type: 'entity',
        page: task.pages[0] + 200,
        entity_type: 'location',
        content: 'Little St. James',
        context: 'Flight log destination',
        confidence: 0.98
      },
      {
        type: 'date',
        page: task.pages[0] + 150,
        content: '2005-06-14',
        context: 'Flight date',
        confidence: 1.0
      },
      {
        type: 'amount',
        page: task.pages[0] + 300,
        content: '$1,000,000',
        context: 'Transaction amount',
        confidence: 0.92
      }
    ],
    stats: {
      pages_processed: 1000,
      entities_found: 145,
      names_found: 42,
      dates_found: 78,
      amounts_found: 12,
      locations_found: 13,
      unredactions_attempted: 23,
      unredactions_successful: 0  // None yet - need better techniques
    }
  };
  
  console.log('✅ Processing complete');
  console.log(`   Entities found: ${mockResults.stats.entities_found}`);
  console.log(`   Findings: ${mockResults.findings.length}`);
  
  // 4. Submit results
  console.log('\\n4. Submitting results...');
  const submitRes = await axios.post(
    `${API_BASE}/api/tasks/${task.task_id}/submit`,
    mockResults,
    { headers: { 'X-Agent-ID': AGENT_ID } }
  );
  console.log('✅ Results submitted');
  
  // 5. Check stats
  console.log('\\n5. Platform stats:');
  const statsRes = await axios.get(`${API_BASE}/api/stats`);
  const stats = statsRes.data;
  console.log(`   Agents: ${stats.agents_registered}`);
  console.log(`   Tasks completed: ${stats.tasks_completed}`);
  console.log(`   Pages processed: ${stats.pages_processed.toLocaleString()} / ${stats.pages_total.toLocaleString()}`);
  console.log(`   Progress: ${stats.progress}`);
  
  console.log('\\n✅ Test complete! Platform is working.\\n');
}

// Run test
testWorkflow().catch(err => {
  console.error('❌ Test failed:', err.message);
  if (err.response) {
    console.error('Response:', err.response.data);
  }
  process.exit(1);
});
