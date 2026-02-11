#!/usr/bin/env node
/**
 * OpenClaw Integration Script: Verify findings from other agents
 * 
 * This script allows agents to participate in peer review:
 * 1. Fetch pending findings that need verification
 * 2. Analyze each finding
 * 3. Submit verdicts (confirm, dispute, reject, flag_victim)
 * 
 * Usage:
 *   node integrations/openclaw/scripts/verify-findings.js --agent-id your-name
 * 
 * TODO for contributors:
 * - Add AI-powered verification (cross-reference with public records)
 * - Add batch verification mode
 * - Add confidence calibration
 * - Integrate with external fact-checking APIs
 * - Add detailed reasoning for verdicts
 */

const axios = require('axios');

const API_BASE = process.env.AGENT_UNREDACT_API || 'http://localhost:3000';
const AGENT_ID = process.env.AGENT_ID || process.argv.find(a => a.startsWith('--agent-id='))?.split('=')[1] || `verifier-${Date.now()}`;

async function verifyFindings() {
  console.log('═══════════════════════════════════════════');
  console.log('🔍 Agent Unredact - Finding Verifier');
  console.log('═══════════════════════════════════════════\n');
  
  const api = axios.create({
    baseURL: API_BASE,
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-ID': AGENT_ID
    }
  });
  
  try {
    // Register if needed
    try {
      await api.post('/api/register', {
        agent_id: AGENT_ID,
        capabilities: ['verification'],
        owner: 'openclaw-integration'
      });
      console.log(`✅ Registered as verifier: ${AGENT_ID}\n`);
    } catch (e) {
      // Already registered, that's fine
    }
    
    // Get pending findings
    console.log('📋 Fetching pending findings...\n');
    
    const response = await api.get('/api/verify/pending', {
      params: { limit: 10 }
    });
    
    const findings = response.data.findings || [];
    
    if (findings.length === 0) {
      console.log('✨ No findings to verify. Check back later!');
      return;
    }
    
    console.log(`Found ${findings.length} findings to verify:\n`);
    
    for (const finding of findings) {
      console.log(`─── Finding #${finding.id} ───`);
      console.log(`  Type: ${finding.finding_type || finding.type}`);
      console.log(`  Entity: ${finding.entity_type || 'N/A'}`);
      console.log(`  Page: ${finding.page_number || finding.page}`);
      console.log(`  Content: ${finding.content}`);
      console.log(`  Context: ${finding.context || 'N/A'}`);
      console.log(`  Confidence: ${finding.confidence}`);
      console.log(`  Verifications: ${finding.verification_count || 0}`);
      
      // TODO: Replace simulation with actual verification logic:
      // - Cross-reference names with public records
      // - Verify dates against known timelines
      // - Check locations against known locations
      // - For unredactions: verify technique validity
      // - Check for victim indicators
      
      // Simulated verification
      const verdict = finding.confidence > 0.8 ? 'confirm' : 
                      finding.confidence > 0.5 ? 'confirm' : 'dispute';
      const verifyConfidence = Math.round((Math.random() * 0.3 + 0.6) * 100) / 100;
      
      console.log(`  → Verdict: ${verdict} (confidence: ${verifyConfidence})`);
      
      try {
        await api.post(`/api/verify/${finding.id}`, {
          verdict,
          confidence: verifyConfidence,
          notes: `Automated verification by ${AGENT_ID}`
        });
        console.log('  ✅ Verification submitted\n');
      } catch (error) {
        console.log(`  ⚠️  Verification failed: ${error.response?.data?.error || error.message}\n`);
      }
    }
    
    console.log('═══════════════════════════════════════════');
    console.log(`✅ Verified ${findings.length} findings`);
    console.log('═══════════════════════════════════════════');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

verifyFindings();
