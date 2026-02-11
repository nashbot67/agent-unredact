#!/usr/bin/env node
/**
 * File chunking system
 * Downloads Epstein investigation PDFs and splits them into 1000-page batches
 * 
 * Usage:
 *   node scripts/chunk-files.js --download    # Download from justice.gov
 *   node scripts/chunk-files.js --chunk       # Chunk existing PDFs
 *   node scripts/chunk-files.js --all         # Download + chunk + upload
 * 
 * TODO for contributors:
 * - Add S3/R2 upload functionality
 * - Add progress tracking and resume capability
 * - Add parallel processing for faster chunking
 * - Add verification of downloaded files (checksums)
 * - Add support for incremental updates when new files are released
 * - Integrate with task database to auto-create tasks for new chunks
 * 
 * IMPORTANT: This is a stub. Actual DOJ file structure unknown.
 * Need to reverse-engineer the actual URLs and file structure.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const https = require('https');
const { execSync } = require('child_process');
require('dotenv').config();

const DATA_DIR = path.join(__dirname, '..', 'data');
const DOWNLOADS_DIR = path.join(DATA_DIR, 'downloads');
const CHUNKS_DIR = path.join(DATA_DIR, 'chunks');
const PAGES_PER_CHUNK = 1000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/agent_unredact'
});

// Ensure directories exist
[DATA_DIR, DOWNLOADS_DIR, CHUNKS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/**
 * Download file from URL
 * TODO: Add retry logic, progress bars, parallel downloads
 */
async function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    https.get(url, response => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(outputPath);
      });
    }).on('error', err => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

/**
 * Get PDF page count
 */
function getPdfPageCount(pdfPath) {
  try {
    // Using pdfinfo (part of poppler-utils)
    const output = execSync(`pdfinfo "${pdfPath}" | grep Pages | awk '{print $2}'`);
    return parseInt(output.toString().trim());
  } catch (error) {
    console.error(`Failed to get page count for ${pdfPath}:`, error.message);
    return null;
  }
}

/**
 * Split PDF into chunks
 * Uses pdftk or similar tool
 * TODO: Test with actual Epstein PDFs, handle encrypted/protected PDFs
 */
function chunkPdf(inputPath, outputDir, pagesPerChunk = 1000) {
  const totalPages = getPdfPageCount(inputPath);
  if (!totalPages) return [];
  
  const chunks = [];
  const basename = path.basename(inputPath, '.pdf');
  
  for (let start = 1; start <= totalPages; start += pagesPerChunk) {
    const end = Math.min(start + pagesPerChunk - 1, totalPages);
    const chunkName = `${basename}_${String(start).padStart(7, '0')}-${String(end).padStart(7, '0')}.pdf`;
    const chunkPath = path.join(outputDir, chunkName);
    
    try {
      // Using pdftk
      execSync(`pdftk "${inputPath}" cat ${start}-${end} output "${chunkPath}"`);
      chunks.push({
        path: chunkPath,
        startPage: start - 1, // 0-indexed
        endPage: end,
        pageCount: end - start + 1
      });
      console.log(`✂️  Created chunk: ${chunkName} (pages ${start}-${end})`);
    } catch (error) {
      console.error(`Failed to chunk pages ${start}-${end}:`, error.message);
    }
  }
  
  return chunks;
}

/**
 * Create task records for chunks
 * TODO: Add conflict handling, batch inserts, file_hash calculation
 */
async function createTasksForChunks(chunks) {
  console.log('\n📝 Creating tasks in database...');
  
  for (const chunk of chunks) {
    const taskId = `epstein-batch-${String(chunk.startPage).padStart(7, '0')}`;
    const fileUrl = `file://${chunk.path}`; // TODO: Replace with S3 URL after upload
    
    try {
      await pool.query(`
        INSERT INTO tasks (task_id, file_url, start_page, end_page, total_pages, priority)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (task_id) DO UPDATE SET
          file_url = EXCLUDED.file_url,
          total_pages = EXCLUDED.total_pages,
          updated_at = NOW()
      `, [taskId, fileUrl, chunk.startPage, chunk.endPage, chunk.pageCount, 1]);
      
      console.log(`✅ Created task: ${taskId}`);
    } catch (error) {
      console.error(`Failed to create task ${taskId}:`, error.message);
    }
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const shouldDownload = args.includes('--download') || args.includes('--all');
  const shouldChunk = args.includes('--chunk') || args.includes('--all');
  const shouldUpload = args.includes('--upload') || args.includes('--all');
  
  console.log('🦞 Agent Unredact File Chunking System\n');
  
  // TODO: Actual DOJ URLs - this is placeholder structure
  const epsteinFileSources = [
    {
      name: 'epstein-investigation-volume-1.pdf',
      url: 'https://www.justice.gov/epstein/file/epstein-volume-1.pdf',
      expectedPages: 1000000 // Approximate
    },
    {
      name: 'epstein-investigation-volume-2.pdf',
      url: 'https://www.justice.gov/epstein/file/epstein-volume-2.pdf',
      expectedPages: 1000000
    },
    {
      name: 'epstein-investigation-volume-3.pdf',
      url: 'https://www.justice.gov/epstein/file/epstein-volume-3.pdf',
      expectedPages: 1500000
    }
  ];
  
  if (shouldDownload) {
    console.log('📥 Downloading files...\n');
    console.log('⚠️  WARNING: Actual DOJ URLs unknown. This is placeholder code.');
    console.log('⚠️  TODO: Reverse-engineer actual file structure from justice.gov\n');
    
    // for (const source of epsteinFileSources) {
    //   const outputPath = path.join(DOWNLOADS_DIR, source.name);
    //   if (fs.existsSync(outputPath)) {
    //     console.log(`⏭️  Skipping ${source.name} (already exists)`);
    //     continue;
    //   }
    //   
    //   console.log(`📥 Downloading ${source.name}...`);
    //   try {
    //     await downloadFile(source.url, outputPath);
    //     console.log(`✅ Downloaded to ${outputPath}`);
    //   } catch (error) {
    //     console.error(`❌ Failed to download ${source.name}:`, error.message);
    //   }
    // }
  }
  
  if (shouldChunk) {
    console.log('\n✂️  Chunking PDFs...\n');
    
    const pdfFiles = fs.readdirSync(DOWNLOADS_DIR)
      .filter(f => f.endsWith('.pdf'))
      .map(f => path.join(DOWNLOADS_DIR, f));
    
    if (pdfFiles.length === 0) {
      console.log('⚠️  No PDF files found in downloads directory');
      console.log('   Place PDF files in:', DOWNLOADS_DIR);
      console.log('   Or run with --download flag\n');
    }
    
    const allChunks = [];
    for (const pdfFile of pdfFiles) {
      console.log(`\n📄 Processing ${path.basename(pdfFile)}...`);
      const chunks = chunkPdf(pdfFile, CHUNKS_DIR, PAGES_PER_CHUNK);
      allChunks.push(...chunks);
    }
    
    console.log(`\n✅ Created ${allChunks.length} chunks`);
    
    // Create database tasks
    await createTasksForChunks(allChunks);
  }
  
  if (shouldUpload) {
    console.log('\n☁️  Uploading to S3...\n');
    console.log('⚠️  TODO: Implement S3/R2 upload');
    console.log('   Need to add AWS SDK and configure bucket');
  }
  
  if (!shouldDownload && !shouldChunk && !shouldUpload) {
    console.log('Usage:');
    console.log('  node scripts/chunk-files.js --download    # Download from justice.gov');
    console.log('  node scripts/chunk-files.js --chunk       # Chunk existing PDFs');
    console.log('  node scripts/chunk-files.js --upload      # Upload chunks to S3');
    console.log('  node scripts/chunk-files.js --all         # Do everything');
    console.log('\nRequirements:');
    console.log('  - pdfinfo (poppler-utils): brew install poppler');
    console.log('  - pdftk: brew install pdftk-java');
  }
  
  await pool.end();
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
