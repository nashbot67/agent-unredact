/**
 * Metadata Extraction - PDF Forensics
 * 
 * Technique: Extract hidden metadata, text layers, and structural information
 * from PDFs that may contain remnants of redacted content.
 * 
 * Success Rate: ~15% (based on initial testing with similar documents)
 * Confidence: Medium (0.5-0.8) - depends on metadata quality
 * 
 * How it works:
 * 1. Parse PDF structure using pdf-parse or similar
 * 2. Extract all metadata fields
 * 3. Look for:
 *    - Author/Creator fields with names
 *    - Document properties
 *    - Hidden text layers
 *    - Annotation remnants
 *    - Font subsetting clues
 * 4. Compare metadata to redacted regions
 */

const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Extract metadata from PDF file
 * @param {string} pdfPath - Path to PDF file
 * @returns {Promise<Object>} Metadata object with findings
 */
async function extractMetadata(pdfPath) {
  const findings = [];
  
  try {
    // Use pdfinfo command-line tool
    const { stdout: pdfinfo } = await execPromise(`pdfinfo "${pdfPath}"`);
    
    // Parse pdfinfo output
    const metadata = {};
    pdfinfo.split('\\n').forEach(line => {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length) {
        metadata[key.trim()] = valueParts.join(':').trim();
      }
    });
    
    // Check for names in Author/Creator/Producer fields
    const nameFields = ['Author', 'Creator', 'Producer', 'Subject', 'Keywords'];
    for (const field of nameFields) {
      if (metadata[field]) {
        const value = metadata[field];
        
        // Look for person names (capitalize First Last pattern)
        const namePattern = /\\b[A-Z][a-z]+ [A-Z][a-z]+\\b/g;
        const matches = value.match(namePattern);
        
        if (matches) {
          matches.forEach(name => {
            findings.push({
              type: 'metadata',
              field,
              content: name,
              confidence: 0.6, // Medium - could be software author, etc.
              technique: 'metadata-extraction',
              context: `Found in PDF ${field} field`
            });
          });
        }
      }
    }
    
    // Extract hidden text layers using pdftotext with layout
    const { stdout: hiddenText } = await execPromise(
      `pdftotext -layout -nopgbrk "${pdfPath}" - | strings`
    );
    
    // Look for text that might be outside visible area
    // (simple heuristic: look for isolated names/words)
    const hiddenLines = hiddenText.split('\\n')
      .filter(line => line.trim().length > 0 && line.trim().length < 50);
    
    hiddenLines.forEach(line => {
      const namePattern = /\\b[A-Z][a-z]+ [A-Z][a-z]+\\b/g;
      const matches = line.match(namePattern);
      
      if (matches) {
        matches.forEach(name => {
          findings.push({
            type: 'hidden-text',
            content: name,
            confidence: 0.5, // Lower - could be header/footer artifact
            technique: 'metadata-extraction',
            context: `Found in hidden text layer: "${line.trim()}"`
          });
        });
      }
    });
    
    return {
      metadata,
      findings,
      stats: {
        fields_extracted: Object.keys(metadata).length,
        potential_findings: findings.length
      }
    };
    
  } catch (error) {
    console.error('Metadata extraction error:', error.message);
    return {
      metadata: {},
      findings: [],
      error: error.message
    };
  }
}

/**
 * Extract font subsetting clues
 * Redacted text sometimes leaves font clues
 */
async function analyzeFonts(pdfPath) {
  try {
    const { stdout } = await execPromise(`pdffonts "${pdfPath}"`);
    
    // Parse font information
    const fonts = [];
    const lines = stdout.split('\\n').slice(2); // Skip header
    
    lines.forEach(line => {
      const parts = line.trim().split(/\\s+/);
      if (parts.length >= 4) {
        fonts.push({
          name: parts[0],
          type: parts[1],
          encoding: parts[2],
          embedded: parts[3] === 'yes'
        });
      }
    });
    
    // Look for unusual font patterns that might indicate redaction
    const suspiciousFonts = fonts.filter(f => 
      f.name.includes('Redact') || 
      f.name.includes('Hidden') ||
      !f.embedded // Non-embedded fonts are suspicious
    );
    
    return {
      fonts,
      suspiciousFonts,
      stats: {
        total_fonts: fonts.length,
        suspicious_count: suspiciousFonts.length
      }
    };
    
  } catch (error) {
    console.error('Font analysis error:', error.message);
    return { fonts: [], suspiciousFonts: [], error: error.message };
  }
}

/**
 * Full metadata-based unredaction attempt
 */
async function attemptUnredaction(pdfPath, pageNumber = null) {
  console.log(`[Metadata Extraction] Analyzing ${pdfPath}...`);
  
  const results = {
    technique: 'metadata-extraction',
    timestamp: new Date().toISOString(),
    findings: [],
    stats: {}
  };
  
  // Extract metadata
  const metadata = await extractMetadata(pdfPath);
  results.findings.push(...metadata.findings);
  results.stats.metadata = metadata.stats;
  
  // Analyze fonts
  const fonts = await analyzeFonts(pdfPath);
  results.stats.fonts = fonts.stats;
  
  // If suspicious fonts found, flag for further investigation
  if (fonts.suspiciousFonts.length > 0) {
    results.findings.push({
      type: 'suspicious-font',
      content: fonts.suspiciousFonts.map(f => f.name).join(', '),
      confidence: 0.4,
      technique: 'metadata-extraction',
      context: 'Unusual font patterns detected - may indicate redaction artifacts'
    });
  }
  
  console.log(`[Metadata Extraction] Found ${results.findings.length} potential findings`);
  
  return results;
}

module.exports = {
  extractMetadata,
  analyzeFonts,
  attemptUnredaction
};

// CLI usage
if (require.main === module) {
  const pdfPath = process.argv[2];
  
  if (!pdfPath) {
    console.error('Usage: node metadata-extraction.js <pdf-file>');
    process.exit(1);
  }
  
  attemptUnredaction(pdfPath)
    .then(results => {
      console.log(JSON.stringify(results, null, 2));
    })
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}
