/**
 * Task Generator
 * Creates task records for the full 3.5M page corpus
 * 
 * Generates 3,500 batches of 1,000 pages each.
 * Each batch represents a chunk of the Epstein investigation files.
 * 
 * TODO for contributors:
 * - Map to actual DOJ file URLs once structure is known
 * - Add priority scoring based on document type (financial, correspondence, etc.)
 * - Add dependency tracking (some batches may reference others)
 * - Add geographic/topic tagging for smarter distribution
 * - Support variable batch sizes for different document types
 */

const TOTAL_PAGES = 3500000;
const PAGES_PER_BATCH = 1000;
const TOTAL_BATCHES = Math.ceil(TOTAL_PAGES / PAGES_PER_BATCH);

// DOJ file base URL (placeholder - needs actual URLs)
const DOJ_BASE_URL = 'https://www.justice.gov/epstein/file';

/**
 * Priority scoring for batches
 * Higher priority = processed first
 * 
 * Priority levels:
 * 10 - Known high-value documents (flight logs, financial records)
 *  7 - Correspondence and emails
 *  5 - Default priority
 *  3 - Administrative documents
 *  1 - Appendices, indexes
 * 
 * TODO: Implement actual priority scoring based on document metadata
 */
function calculatePriority(batchIndex) {
  // First 100 batches (pages 0-100K) are likely cover pages, indexes - lower priority
  if (batchIndex < 100) return 3;
  
  // Batches 100-500 (pages 100K-500K) - correspondence, high value
  if (batchIndex < 500) return 7;
  
  // Batches 500-1000 (pages 500K-1M) - financial records, very high value
  if (batchIndex < 1000) return 10;
  
  // Batches 1000-2000 - mixed documents
  if (batchIndex < 2000) return 5;
  
  // Batches 2000-3500 - later volumes, standard priority
  return 5;
}

/**
 * Generate all tasks for in-memory storage
 * Returns a Map of taskId -> task object
 */
function generateTasks(options = {}) {
  const count = options.count || TOTAL_BATCHES;
  const tasks = new Map();

  for (let i = 0; i < count; i++) {
    const startPage = i * PAGES_PER_BATCH;
    const endPage = Math.min(startPage + PAGES_PER_BATCH, TOTAL_PAGES);
    const taskId = `epstein-batch-${String(i).padStart(4, '0')}`;

    tasks.set(taskId, {
      task_id: taskId,
      file_url: `${DOJ_BASE_URL}/${i}/download`,
      start_page: startPage,
      end_page: endPage,
      pages: [startPage, endPage],
      total_pages: endPage - startPage,
      status: 'available',
      claimed_by: null,
      claimed_at: null,
      priority: calculatePriority(i),
      attempts: 0,
      max_attempts: 3,
      created_at: new Date().toISOString()
    });
  }

  return tasks;
}

/**
 * Generate tasks for database insertion (SQL)
 * Returns array of task objects ready for bulk insert
 */
function generateTasksForDB(options = {}) {
  const count = options.count || TOTAL_BATCHES;
  const tasks = [];

  for (let i = 0; i < count; i++) {
    const startPage = i * PAGES_PER_BATCH;
    const endPage = Math.min(startPage + PAGES_PER_BATCH, TOTAL_PAGES);

    tasks.push({
      task_id: `epstein-batch-${String(i).padStart(4, '0')}`,
      file_url: `${DOJ_BASE_URL}/${i}/download`,
      start_page: startPage,
      end_page: endPage,
      total_pages: endPage - startPage,
      priority: calculatePriority(i)
    });
  }

  return tasks;
}

module.exports = {
  TOTAL_PAGES,
  PAGES_PER_BATCH,
  TOTAL_BATCHES,
  generateTasks,
  generateTasksForDB,
  calculatePriority
};
