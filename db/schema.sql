-- Agent Unredact Database Schema
-- PostgreSQL 14+

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
  id SERIAL PRIMARY KEY,
  agent_id VARCHAR(255) UNIQUE NOT NULL,
  owner VARCHAR(255),
  capabilities JSONB DEFAULT '[]',
  tokens_available INTEGER DEFAULT 0,
  processing_rate VARCHAR(100),
  registered_at TIMESTAMP DEFAULT NOW(),
  last_seen_at TIMESTAMP DEFAULT NOW(),
  tasks_claimed INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  tasks_failed INTEGER DEFAULT 0,
  reputation_score DECIMAL(5,2) DEFAULT 0.0,
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned'))
);

CREATE INDEX idx_agents_agent_id ON agents(agent_id);
CREATE INDEX idx_agents_status ON agents(status);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  task_id VARCHAR(255) UNIQUE NOT NULL,
  file_url TEXT NOT NULL,
  file_hash VARCHAR(64),
  start_page INTEGER NOT NULL,
  end_page INTEGER NOT NULL,
  total_pages INTEGER NOT NULL,
  status VARCHAR(50) DEFAULT 'available' CHECK (status IN ('available', 'claimed', 'processing', 'completed', 'verified', 'failed')),
  priority INTEGER DEFAULT 1 CHECK (priority BETWEEN 1 AND 10),
  claimed_by VARCHAR(255),
  claimed_at TIMESTAMP,
  completed_at TIMESTAMP,
  verified_at TIMESTAMP,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tasks_task_id ON tasks(task_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority DESC);
CREATE INDEX idx_tasks_claimed_by ON tasks(claimed_by);

-- Results table
CREATE TABLE IF NOT EXISTS results (
  id SERIAL PRIMARY KEY,
  task_id VARCHAR(255) NOT NULL REFERENCES tasks(task_id),
  agent_id VARCHAR(255) NOT NULL,
  completed_at TIMESTAMP DEFAULT NOW(),
  findings JSONB DEFAULT '[]',
  stats JSONB DEFAULT '{}',
  verified_by JSONB DEFAULT '[]',
  verification_status VARCHAR(50) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'disputed', 'rejected')),
  confidence_score DECIMAL(5,2),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_results_task_id ON results(task_id);
CREATE INDEX idx_results_agent_id ON results(agent_id);
CREATE INDEX idx_results_verification_status ON results(verification_status);

-- Findings table (extracted entities and unredactions)
CREATE TABLE IF NOT EXISTS findings (
  id SERIAL PRIMARY KEY,
  result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  task_id VARCHAR(255) NOT NULL,
  agent_id VARCHAR(255) NOT NULL,
  finding_type VARCHAR(50) CHECK (finding_type IN ('entity', 'unredaction', 'relationship', 'date', 'location')),
  entity_type VARCHAR(50), -- person, organization, location, date, email, phone
  page_number INTEGER,
  content TEXT NOT NULL,
  context TEXT,
  confidence DECIMAL(5,2) CHECK (confidence BETWEEN 0 AND 1),
  technique VARCHAR(100), -- for unredactions: metadata-extraction, font-analysis, context-inference
  verified_by JSONB DEFAULT '[]',
  verification_count INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'disputed', 'redacted', 'published')),
  is_victim BOOLEAN DEFAULT FALSE,
  is_public_figure BOOLEAN DEFAULT NULL,
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_findings_result_id ON findings(result_id);
CREATE INDEX idx_findings_task_id ON findings(task_id);
CREATE INDEX idx_findings_finding_type ON findings(finding_type);
CREATE INDEX idx_findings_entity_type ON findings(entity_type);
CREATE INDEX idx_findings_status ON findings(status);
CREATE INDEX idx_findings_is_victim ON findings(is_victim);
CREATE INDEX idx_findings_confidence ON findings(confidence DESC);

-- Verifications table (peer review)
CREATE TABLE IF NOT EXISTS verifications (
  id SERIAL PRIMARY KEY,
  finding_id INTEGER NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  verifier_agent_id VARCHAR(255) NOT NULL,
  verdict VARCHAR(50) CHECK (verdict IN ('confirm', 'dispute', 'reject', 'flag_victim')),
  confidence DECIMAL(5,2) CHECK (confidence BETWEEN 0 AND 1),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_verifications_finding_id ON verifications(finding_id);
CREATE INDEX idx_verifications_verifier_agent_id ON verifications(verifier_agent_id);
CREATE INDEX idx_verifications_verdict ON verifications(verdict);

-- Victim protection log (audit trail for safety)
CREATE TABLE IF NOT EXISTS victim_protection_log (
  id SERIAL PRIMARY KEY,
  finding_id INTEGER REFERENCES findings(id),
  content_hash VARCHAR(64) NOT NULL,
  detected_by VARCHAR(255) NOT NULL,
  detection_method VARCHAR(100),
  action_taken VARCHAR(100) CHECK (action_taken IN ('redacted', 'flagged', 'escalated', 'cleared')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_victim_log_content_hash ON victim_protection_log(content_hash);
CREATE INDEX idx_victim_log_action ON victim_protection_log(action_taken);

-- Platform stats (materialized view for performance)
CREATE MATERIALIZED VIEW IF NOT EXISTS platform_stats AS
SELECT
  (SELECT COUNT(*) FROM agents WHERE status = 'active') AS agents_active,
  (SELECT COUNT(*) FROM tasks) AS tasks_total,
  (SELECT COUNT(*) FROM tasks WHERE status = 'available') AS tasks_available,
  (SELECT COUNT(*) FROM tasks WHERE status = 'claimed') AS tasks_claimed,
  (SELECT COUNT(*) FROM tasks WHERE status = 'completed') AS tasks_completed,
  (SELECT COUNT(*) FROM tasks WHERE status = 'verified') AS tasks_verified,
  (SELECT COUNT(*) FROM results) AS results_submitted,
  (SELECT COUNT(*) FROM findings WHERE status = 'published') AS findings_published,
  (SELECT SUM(total_pages) FROM tasks WHERE status = 'completed') AS pages_processed,
  3500000 AS pages_total,
  ROUND((SELECT SUM(total_pages) FROM tasks WHERE status = 'completed')::numeric / 3500000 * 100, 2) AS progress_percent
;

CREATE UNIQUE INDEX idx_platform_stats ON platform_stats ((1));

-- Function to refresh stats
CREATE OR REPLACE FUNCTION refresh_platform_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY platform_stats;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update task timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER results_updated_at BEFORE UPDATE ON results
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER findings_updated_at BEFORE UPDATE ON findings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Function to auto-release stale tasks (claimed >1 hour ago, not completed)
CREATE OR REPLACE FUNCTION release_stale_tasks()
RETURNS INTEGER AS $$
DECLARE
  released_count INTEGER;
BEGIN
  WITH stale AS (
    UPDATE tasks
    SET status = 'available',
        claimed_by = NULL,
        claimed_at = NULL
    WHERE status = 'claimed'
      AND claimed_at < NOW() - INTERVAL '1 hour'
    RETURNING id
  )
  SELECT COUNT(*) INTO released_count FROM stale;
  RETURN released_count;
END;
$$ LANGUAGE plpgsql;

-- TODO: Set up pg_cron or external cron to call release_stale_tasks() every 15 minutes
-- Example: SELECT cron.schedule('release-stale-tasks', '*/15 * * * *', 'SELECT release_stale_tasks()');

-- Sample data for testing
INSERT INTO tasks (task_id, file_url, start_page, end_page, total_pages, priority, file_hash)
VALUES
  ('epstein-batch-0000', 'https://www.justice.gov/epstein/file/0/download', 0, 1000, 1000, 5, 'abc123'),
  ('epstein-batch-0001', 'https://www.justice.gov/epstein/file/1000/download', 1000, 2000, 1000, 5, 'def456'),
  ('epstein-batch-0002', 'https://www.justice.gov/epstein/file/2000/download', 2000, 3000, 1000, 5, 'ghi789')
ON CONFLICT (task_id) DO NOTHING;

-- Grants (adjust as needed for your deployment)
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO agent_unredact_api;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO agent_unredact_api;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO agent_unredact_api;
