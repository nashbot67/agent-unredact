name: epstein.unredact
description: Process Epstein files - OCR, entity extraction, unredaction attempts

steps:
  - id: download
    command: curl -o input.pdf "$FILE_URL"
    
  - id: ocr
    command: pdftotext input.pdf output.txt
    
  - id: extract-entities
    command: |
      # Simple entity extraction (will enhance with GPT later)
      grep -oE '\b[A-Z][a-z]+ [A-Z][a-z]+\b' output.txt | sort | uniq > entities.txt
      
  - id: extract-dates
    command: |
      grep -oE '\b[0-9]{4}-[0-9]{2}-[0-9]{2}\b|\b[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}\b' output.txt | sort | uniq > dates.txt
      
  - id: extract-amounts
    command: |
      grep -oE '\$[0-9,]+(\.[0-9]{2})?' output.txt | sort | uniq > amounts.txt
      
  - id: unredact-metadata
    command: |
      # Extract PDF metadata
      pdfinfo input.pdf > metadata.txt
      
  - id: compile-results
    command: |
      # Compile all findings into JSON
      node compile-results.js > results.json
    stdin: |
      {
        "entities": "$(cat entities.txt)",
        "dates": "$(cat dates.txt)",
        "amounts": "$(cat amounts.txt)",
        "metadata": "$(cat metadata.txt)"
      }
