/**
 * Verification System
 * Multi-agent peer review for findings
 * 
 * TODO for contributors:
 * - Add machine learning for automated verification
 * - Add reputation-weighted voting
 * - Add dispute resolution workflow
 * - Add real-time verification notifications via WebSocket
 * - Integrate with ETHICS.md victim protection protocols
 */

const { Pool } = require('pg');

class VerificationSystem {
  constructor(dbPool) {
    this.pool = dbPool;
    
    // Verification thresholds
    this.THRESHOLDS = {
      HIGH_CONFIDENCE: 0.9,    // Auto-publish if 3 confirms
      MEDIUM_CONFIDENCE: 0.5,  // Need 5 confirms
      LOW_CONFIDENCE: 0.3,     // Need human review
      MIN_VERIFIERS: 3,        // Minimum independent verifiers
      VICTIM_FLAG_THRESHOLD: 1 // Single flag = immediate action
    };
  }
  
  /**
   * Submit a verification for a finding
   * 
   * @param {number} findingId - Finding to verify
   * @param {string} verifierAgentId - Agent submitting verification
   * @param {string} verdict - 'confirm', 'dispute', 'reject', 'flag_victim'
   * @param {number} confidence - 0.0 to 1.0
   * @param {string} notes - Optional explanation
   * 
   * TODO: Add conflict of interest checking (can't verify your own findings)
   * TODO: Add rate limiting per agent
   * TODO: Add verification quality scoring
   */
  async submitVerification(findingId, verifierAgentId, verdict, confidence, notes = null) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get the finding
      const findingResult = await client.query(
        'SELECT * FROM findings WHERE id = $1',
        [findingId]
      );
      
      if (findingResult.rows.length === 0) {
        throw new Error('Finding not found');
      }
      
      const finding = findingResult.rows[0];
      
      // Prevent self-verification
      if (finding.agent_id === verifierAgentId) {
        throw new Error('Cannot verify your own finding');
      }
      
      // Check if already verified by this agent
      const existingVerification = await client.query(
        'SELECT id FROM verifications WHERE finding_id = $1 AND verifier_agent_id = $2',
        [findingId, verifierAgentId]
      );
      
      if (existingVerification.rows.length > 0) {
        throw new Error('Already verified by this agent');
      }
      
      // Insert verification
      await client.query(`
        INSERT INTO verifications (finding_id, verifier_agent_id, verdict, confidence, notes)
        VALUES ($1, $2, $3, $4, $5)
      `, [findingId, verifierAgentId, verdict, confidence, notes]);
      
      // Handle victim flag immediately
      if (verdict === 'flag_victim') {
        await this.handleVictimFlag(client, finding, verifierAgentId);
        await client.query('COMMIT');
        return { action: 'victim_flagged', status: 'redacted' };
      }
      
      // Update finding with new verification
      const verifications = await client.query(`
        SELECT verdict, COUNT(*) as count, AVG(confidence) as avg_confidence
        FROM verifications
        WHERE finding_id = $1
        GROUP BY verdict
      `, [findingId]);
      
      const confirms = verifications.rows.find(v => v.verdict === 'confirm');
      const disputes = verifications.rows.find(v => v.verdict === 'dispute');
      const rejects = verifications.rows.find(v => v.verdict === 'reject');
      
      const confirmCount = confirms ? parseInt(confirms.count) : 0;
      const disputeCount = disputes ? parseInt(disputes.count) : 0;
      const rejectCount = rejects ? parseInt(rejects.count) : 0;
      const avgConfidence = confirms ? parseFloat(confirms.avg_confidence) : 0;
      
      // Update finding verified_by array
      const verifiedBy = await client.query(
        'SELECT verifier_agent_id, verdict FROM verifications WHERE finding_id = $1',
        [findingId]
      );
      
      await client.query(`
        UPDATE findings
        SET verified_by = $1,
            verification_count = $2,
            updated_at = NOW()
        WHERE id = $3
      `, [
        JSON.stringify(verifiedBy.rows),
        verifiedBy.rows.length,
        findingId
      ]);
      
      // Determine if finding should be published
      let newStatus = finding.status;
      let shouldPublish = false;
      
      if (rejectCount >= this.THRESHOLDS.MIN_VERIFIERS) {
        // Rejected by majority
        newStatus = 'disputed';
      } else if (confirmCount >= this.THRESHOLDS.MIN_VERIFIERS) {
        if (finding.confidence >= this.THRESHOLDS.HIGH_CONFIDENCE) {
          // High confidence + 3 confirms = publish
          newStatus = 'published';
          shouldPublish = true;
        } else if (finding.confidence >= this.THRESHOLDS.MEDIUM_CONFIDENCE && confirmCount >= 5) {
          // Medium confidence + 5 confirms = publish
          newStatus = 'published';
          shouldPublish = true;
        } else if (confirmCount >= 5) {
          // 5 confirms regardless
          newStatus = 'verified';
        }
      }
      
      // Update status
      if (newStatus !== finding.status) {
        await client.query(`
          UPDATE findings
          SET status = $1,
              published_at = $2,
              updated_at = NOW()
          WHERE id = $3
        `, [newStatus, shouldPublish ? new Date() : null, findingId]);
      }
      
      await client.query('COMMIT');
      
      return {
        findingId,
        verificationCount: verifiedBy.rows.length,
        confirms: confirmCount,
        disputes: disputeCount,
        rejects: rejectCount,
        status: newStatus,
        published: shouldPublish
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Handle victim flag - immediate redaction and logging
   * 
   * TODO: Add notification to moderators
   * TODO: Add automated content hash checking for similar content
   * TODO: Implement appeal process for false positives
   */
  async handleVictimFlag(client, finding, flaggedBy) {
    // Redact the finding immediately
    await client.query(`
      UPDATE findings
      SET status = 'redacted',
          is_victim = TRUE,
          content = '[REDACTED - VICTIM PROTECTION]',
          context = '[REDACTED - VICTIM PROTECTION]',
          updated_at = NOW()
      WHERE id = $1
    `, [finding.id]);
    
    // Log the action
    const contentHash = require('crypto')
      .createHash('sha256')
      .update(finding.content)
      .digest('hex');
    
    await client.query(`
      INSERT INTO victim_protection_log
      (finding_id, content_hash, detected_by, detection_method, action_taken, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      finding.id,
      contentHash,
      flaggedBy,
      'agent_flag',
      'redacted',
      'Flagged during verification process'
    ]);
    
    console.log(`🛡️  VICTIM PROTECTION: Finding ${finding.id} redacted by ${flaggedBy}`);
  }
  
  /**
   * Get verification status for a finding
   */
  async getVerificationStatus(findingId) {
    const result = await this.pool.query(`
      SELECT 
        f.*,
        json_agg(json_build_object(
          'agent_id', v.verifier_agent_id,
          'verdict', v.verdict,
          'confidence', v.confidence,
          'created_at', v.created_at
        )) as verifications
      FROM findings f
      LEFT JOIN verifications v ON f.id = v.finding_id
      WHERE f.id = $1
      GROUP BY f.id
    `, [findingId]);
    
    return result.rows[0] || null;
  }
  
  /**
   * Get findings pending verification
   * 
   * TODO: Add priority sorting (high confidence first)
   * TODO: Add filtering by finding type
   */
  async getPendingVerifications(limit = 50) {
    const result = await this.pool.query(`
      SELECT 
        f.*,
        f.verification_count,
        COALESCE(
          (SELECT COUNT(*) FROM verifications v WHERE v.finding_id = f.id AND v.verdict = 'confirm'),
          0
        ) as confirm_count
      FROM findings f
      WHERE f.status = 'pending'
        AND f.is_victim = FALSE
      ORDER BY f.confidence DESC, f.created_at ASC
      LIMIT $1
    `, [limit]);
    
    return result.rows;
  }
}

module.exports = VerificationSystem;
