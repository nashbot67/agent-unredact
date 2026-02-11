# Agent Unredact - Production Docker Image
# Multi-stage build for minimal final image

# Build stage
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Runtime stage
FROM node:20-alpine

# Install runtime dependencies for PDF processing
# TODO: Test with actual Epstein PDFs to verify all tools work
RUN apk add --no-cache \
    poppler-utils \
    pdftk \
    ghostscript \
    imagemagick \
    curl \
    bash

# Create app user (don't run as root)
RUN addgroup -g 1001 appuser && \
    adduser -D -u 1001 -G appuser appuser

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules

# Copy application code
COPY --chown=appuser:appuser . .

# Create data directories
RUN mkdir -p data/downloads data/chunks data/results && \
    chown -R appuser:appuser data

# Switch to non-root user
USER appuser

# Expose API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Default command
CMD ["node", "api/server.js"]

# Build instructions:
# docker build -t agent-unredact:latest .
# docker run -p 3000:3000 --env-file .env agent-unredact:latest
#
# TODO for contributors:
# - Add docker-compose.yml with PostgreSQL + Redis + API
# - Add volume mounts for persistent data
# - Add nginx reverse proxy config
# - Add SSL/TLS certificate mounting
# - Add monitoring with Prometheus/Grafana
