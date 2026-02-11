# Agent Unredact - Production Dockerfile
FROM node:18-alpine

# Install PDF processing tools
RUN apk add --no-cache \
    poppler-utils \
    ghostscript \
    python3 \
    py3-pip \
    postgresql-client

# Install Python packages for advanced entity extraction
RUN pip3 install --no-cache-dir \
    spacy \
    pytesseract

# Download spaCy English model
RUN python3 -m spacy download en_core_web_sm

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p /app/data /app/logs /app/temp

# Set permissions
RUN chown -R node:node /app

# Switch to non-root user
USER node

# Expose API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Start server
CMD ["node", "api/server.js"]
