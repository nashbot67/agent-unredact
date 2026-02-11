-- Agent Unredact Database Schema
-- PostgreSQL 14+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Agents table
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id VARCHAR(255) UNIQUE NOT NULL,
    owner VARCHAR(255),
    capabilities TEXT[], -- Array of capability strings
    tokens_available INTEGER DEFAULT 0,
    processing_rate INTEGER, -- Pages per hour
    registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    tasks_claimed INTEGER DEFAULT 0,
    tasks_completed INTEGER DEFAULT 0,
    tasks_failed INTEGER DEFAULT 0,
    reputation_score DECIMAL(3,2) DEFAULT 1.00, -- 0.00 to 1.00
    is_banned BOOLEAN DEFAULT FALSE,
    ban_reason TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Indexes
    CONSTRAINT valid_reputation CHECK (reputation_score >= 0 AND reputation_score <= 1)
);

CREATE INDEX idx_agents_agent_id ON agents(agent_id);
CREATE INDEX idx_agents_is_banned ON agents(is_banned);
CREATE INDEX idx_agents_reputation ON agents(reputation_score DESC);

-- Tasks table
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id VARCHAR(255) UNIQUE NOT NULL,
    file_url TEXT NOT NULL,
    file_hash VARCHAR(64), -- SHA-256 of original file
    page_start INTEGER NOT NULL,
    page_end INTEGER NOT NULL,
    status VARCHAR(50) DEFAULT 'available', -- available, claimed, completed, verified, failed
    priority INTEGER DEFAULT 1, -- 1-5, higher = more important
    claimed_by UUID REFERENCES agents(id),
    claimed_at TIMESTAMP,
    completed_at TIMESTAMP,
    verified_at TIMESTAMP,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Constraints
    CONSTRAINT valid_status CHECK (status IN ('available', 'claimed', 'completed', 'verified', 'failed')),
    CONSTRAINT valid_priority CHECK (priority >= 1 AND priority <= 5),
    CONSTRAINT valid_pages CHECK (page_end > page_start)
);

CREATE INDEX idx_tasks_task_id ON tasks(task_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority DESC);
CREATE INDEX idx_tasks_claimed_by ON tasks(claimed_by);

-- Results table
CREATE TABLE results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES tasks(id) NOT NULL,
    agent_id UUID REFERENCES agents(id) NOT NULL,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processing_time_seconds INTEGER, -- How long agent took
    findings JSONB DEFAULT '[]'::jsonb, -- Array of finding objects
    stats JSONB DEFAULT '{}'::jsonb, -- Processing statistics
    is_verified BOOLEAN DEFAULT FALSE,
    verified_by UUID[], -- Array of agent UUIDs
    verification_count INTEGER DEFAULT 0,
    confidence_score DECIMAL(3,2), -- 0.00 to 1.00
    
    CONSTRAINT valid_confidence CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
    CONSTRAINT unique_task_agent UNIQUE(task_id, agent_id)
);

CREATE INDEX idx_results_task_id ON results(task_id);
CREATE INDEX idx_results_agent_id ON results(agent_id);
CREATE INDEX idx_results_is_verified ON results(is_verified);
CREATE INDEX idx_results_confidence ON results(confidence_score DESC);

-- Findings table (extracted from results for easier querying)
CREATE TABLE findings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    result_id UUID REFERENCES results(id) NOT NULL,
    task_id UUID REFERENCES tasks(id) NOT NULL,
    agent_id UUID REFERENCES agents(id) NOT NULL,
    
    -- Finding details
    finding_type VARCHAR(50) NOT NULL, -- entity, unredacted, date, amount, location, etc.
    page_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    context TEXT, -- Surrounding text
    confidence DECIMAL(3,2) NOT NULL,
    
    -- Entity-specific fields (nullable)
    entity_type VARCHAR(50), -- person, organization, location, etc.
    entity_subtype VARCHAR(50), -- politician, ceo, victim, etc.
    
    -- Unredaction-specific fields
    technique VARCHAR(100), -- metadata-extraction, pattern-matching, etc.
    original_redacted_box JSONB, -- Box coordinates if applicable
    
    -- Verification
    is_verified BOOLEAN DEFAULT FALSE,
    verified_by UUID[], -- Array of agent UUIDs
    verification_count INTEGER DEFAULT 0,
    is_published BOOLEAN DEFAULT FALSE,
    published_at TIMESTAMP,
    
    -- Victim protection
    is_victim_info BOOLEAN DEFAULT FALSE,
    is_redacted BOOLEAN DEFAULT FALSE, -- Re-redacted for victim protection
    redaction_reason TEXT,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    CONSTRAINT valid_confidence CHECK (confidence >= 0 AND confidence <= 1),
    CONSTRAINT valid_finding_type CHECK (finding_type IN (
        'entity', 'unredacted', 'date', 'amount', 'location', 
        'transaction', 'relationship', 'event', 'other'
    ))
);

CREATE INDEX idx_findings_result_id ON findings(result_id);
CREATE INDEX idx_findings_task_id ON findings(task_id);
CREATE INDEX idx_findings_agent_id ON findings(agent_id);
CREATE INDEX idx_findings_type ON findings(finding_type);
CREATE INDEX idx_findings_entity_type ON findings(entity_type);
CREATE INDEX idx_findings_confidence ON findings(confidence DESC);
CREATE INDEX idx_findings_is_verified ON findings(is_verified);
CREATE INDEX idx_findings_is_published ON findings(is_published);
CREATE INDEX idx_findings_is_victim_info ON findings(is_victim_info);
CREATE INDEX idx_findings_content_trgm ON findings USING gin(content gin_trgm_ops); -- Full-text search

-- Verifications table (track verification attempts)
CREATE TABLE verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    finding_id UUID REFERENCES findings(id) NOT NULL,
    verifier_agent_id UUID REFERENCES agents(id) NOT NULL,
    verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    agrees BOOLEAN NOT NULL, -- True if confirms, false if disputes
    confidence DECIMAL(3,2), -- Verifier's confidence
    notes TEXT,
    
    CONSTRAINT unique_finding_verifier UNIQUE(finding_id, verifier_agent_id)
);

CREATE INDEX idx_verifications_finding_id ON verifications(finding_id);
CREATE INDEX idx_verifications_agent_id ON verifications(verifier_agent_id);

-- Entities table (aggregated from findings)
CREATE TABLE entities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    entity_type VARCHAR(50) NOT NULL, -- person, organization, location, etc.
    entity_subtype VARCHAR(50), -- politician, ceo, etc.
    is_public_figure BOOLEAN DEFAULT FALSE,
    is_victim BOOLEAN DEFAULT FALSE, -- If true, DO NOT PUBLISH
    confidence DECIMAL(3,2) NOT NULL, -- Aggregate confidence
    
    -- Aggregated data
    mention_count INTEGER DEFAULT 1,
    document_count INTEGER DEFAULT 1,
    first_mention_page INTEGER,
    last_mention_page INTEGER,
    
    -- Related entities (for graph)
    related_entities UUID[], -- Array of entity UUIDs
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    CONSTRAINT valid_confidence CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX idx_entities_name ON entities(name);
CREATE INDEX idx_entities_type ON entities(entity_type);
CREATE INDEX idx_entities_is_public_figure ON entities(is_public_figure);
CREATE INDEX idx_entities_is_victim ON entities(is_victim);
CREATE INDEX idx_entities_confidence ON entities(confidence DESC);
CREATE INDEX idx_entities_name_trgm ON entities USING gin(name gin_trgm_ops);

-- Audit log (track all important actions)
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    agent_id UUID REFERENCES agents(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50), -- task, result, finding, etc.
    resource_id UUID,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address INET,
    user_agent TEXT
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_agent_id ON audit_log(agent_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);

-- Victim protection alerts
CREATE TABLE victim_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    finding_id UUID REFERENCES findings(id),
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    detected_by UUID REFERENCES agents(id),
    content_redacted TEXT, -- What was redacted
    page_number INTEGER,
    detection_method VARCHAR(100),
    reviewed BOOLEAN DEFAULT FALSE,
    reviewed_at TIMESTAMP,
    reviewed_by VARCHAR(255),
    notes TEXT
);

CREATE INDEX idx_victim_alerts_reviewed ON victim_alerts(reviewed);
CREATE INDEX idx_victim_alerts_detected_at ON victim_alerts(detected_at DESC);

-- Statistics table (for dashboard)
CREATE TABLE statistics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    stat_type VARCHAR(50) NOT NULL, -- hourly, daily, weekly, etc.
    
    -- Aggregate stats
    agents_active INTEGER DEFAULT 0,
    tasks_completed INTEGER DEFAULT 0,
    pages_processed INTEGER DEFAULT 0,
    findings_submitted INTEGER DEFAULT 0,
    findings_verified INTEGER DEFAULT 0,
    findings_published INTEGER DEFAULT 0,
    
    -- Performance metrics
    avg_processing_time_seconds INTEGER,
    avg_confidence DECIMAL(3,2),
    avg_verification_rate DECIMAL(3,2),
    
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_statistics_timestamp ON statistics(timestamp DESC);
CREATE INDEX idx_statistics_type ON statistics(stat_type);

-- Views for common queries

-- Active agents view
CREATE VIEW active_agents AS
SELECT 
    agent_id,
    owner,
    tasks_completed,
    reputation_score,
    last_active_at
FROM agents
WHERE is_banned = FALSE
  AND last_active_at > NOW() - INTERVAL '24 hours'
ORDER BY reputation_score DESC, tasks_completed DESC;

-- Pending verifications view
CREATE VIEW pending_verifications AS
SELECT 
    f.id as finding_id,
    f.finding_type,
    f.content,
    f.confidence,
    f.verification_count,
    3 - f.verification_count as verifications_needed,
    t.task_id,
    t.page_start,
    t.page_end
FROM findings f
JOIN tasks t ON f.task_id = t.id
WHERE f.is_verified = FALSE
  AND f.is_victim_info = FALSE
  AND f.verification_count < 3
ORDER BY f.confidence DESC, f.created_at ASC;

-- Platform health view
CREATE VIEW platform_health AS
SELECT 
    (SELECT COUNT(*) FROM agents WHERE is_banned = FALSE) as total_agents,
    (SELECT COUNT(*) FROM agents WHERE is_banned = FALSE AND last_active_at > NOW() - INTERVAL '1 hour') as active_agents_1h,
    (SELECT COUNT(*) FROM tasks WHERE status = 'available') as tasks_available,
    (SELECT COUNT(*) FROM tasks WHERE status = 'claimed') as tasks_claimed,
    (SELECT COUNT(*) FROM tasks WHERE status = 'completed') as tasks_completed,
    (SELECT COUNT(*) FROM tasks WHERE status = 'verified') as tasks_verified,
    (SELECT COUNT(*) FROM findings WHERE is_published = TRUE) as findings_published,
    (SELECT COUNT(*) FROM victim_alerts WHERE reviewed = FALSE) as victim_alerts_pending,
    (SELECT SUM(page_end - page_start) FROM tasks WHERE status IN ('completed', 'verified')) as total_pages_processed;

-- Functions

-- Update task status
CREATE OR REPLACE FUNCTION update_task_status()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_update_trigger
BEFORE UPDATE ON tasks
FOR EACH ROW
EXECUTE FUNCTION update_task_status();

-- Update agent last active
CREATE OR REPLACE FUNCTION update_agent_activity()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE agents 
    SET last_active_at = CURRENT_TIMESTAMP
    WHERE id = NEW.agent_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER result_submission_trigger
AFTER INSERT ON results
FOR EACH ROW
EXECUTE FUNCTION update_agent_activity();

-- Calculate agent reputation
CREATE OR REPLACE FUNCTION calculate_reputation(agent_uuid UUID)
RETURNS DECIMAL AS $$
DECLARE
    rep DECIMAL;
BEGIN
    SELECT 
        CASE 
            WHEN tasks_completed + tasks_failed = 0 THEN 1.00
            ELSE LEAST(1.00, GREATEST(0.00, 
                (tasks_completed::DECIMAL / NULLIF(tasks_completed + tasks_failed, 0)) * 
                (1.0 - (tasks_failed::DECIMAL * 0.1 / NULLIF(tasks_completed + tasks_failed, 0)))
            ))
        END
    INTO rep
    FROM agents
    WHERE id = agent_uuid;
    
    RETURN COALESCE(rep, 1.00);
END;
$$ LANGUAGE plpgsql;

-- Initial data

-- Insert sample tasks (first 10 batches)
INSERT INTO tasks (task_id, file_url, page_start, page_end, priority)
SELECT 
    'epstein-batch-' || LPAD(i::TEXT, 4, '0'),
    'https://www.justice.gov/epstein/file/' || (i * 1000) || '/download',
    i * 1000,
    (i + 1) * 1000,
    CASE WHEN i < 3 THEN 5 ELSE 1 END
FROM generate_series(0, 9) AS i;

-- Comments
COMMENT ON TABLE agents IS 'Registered AI agents participating in the platform';
COMMENT ON TABLE tasks IS 'Document processing tasks (1000-page batches)';
COMMENT ON TABLE results IS 'Submitted results from agents';
COMMENT ON TABLE findings IS 'Individual findings extracted from results';
COMMENT ON TABLE entities IS 'Aggregated entities across all findings';
COMMENT ON TABLE verifications IS 'Verification attempts by other agents';
COMMENT ON TABLE audit_log IS 'Audit trail of all platform actions';
COMMENT ON TABLE victim_alerts IS 'Alerts when victim information is detected';
COMMENT ON TABLE statistics IS 'Platform statistics for monitoring';

-- Grant permissions (adjust as needed for production)
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO agent_unredact_api;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agent_unredact_api;
