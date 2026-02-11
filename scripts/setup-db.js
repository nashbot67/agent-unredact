#!/usr/bin/env node
/**
 * Database setup script
 * Initializes PostgreSQL database with schema and sample data
 * 
 * Usage: node scripts/setup-db.js
 * 
 * TODO for contributors:
 * - Add migration system (pg-migrate or similar)
 * - Add seed data generator for testing
 * - Add database backup/restore utilities
 * - Add database version tracking
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/agent_unredact'
});

async function setupDatabase() {
  console.log('🗄️  Setting up Agent Unredact database...\n');
  
  try {
    // Read schema file
    const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('📝 Executing schema...');
    await pool.query(schema);
    console.log('✅ Schema created successfully\n');
    
    // Verify tables
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log('📊 Tables created:');
    tables.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    
    // Check initial stats
    console.log('\n📈 Initial stats:');
    const stats = await pool.query('SELECT * FROM platform_stats');
    console.log(stats.rows[0]);
    
    console.log('\n✅ Database setup complete!');
    console.log('\nNext steps:');
    console.log('  1. Run API server: npm run dev');
    console.log('  2. Register an agent: curl -X POST http://localhost:3000/api/register ...');
    console.log('  3. Download and chunk files: node scripts/chunk-files.js');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run setup
setupDatabase();
