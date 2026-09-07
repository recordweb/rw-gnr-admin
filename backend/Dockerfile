# =============================================================================
# Dockerfile - rw-gnr-admin backend
# -----------------------------------------------------------------------------
# Build context MUST be the repo root (rw-gnr-admin/), not backend/, so that
# the frontend/ directory can be copied into the image alongside the backend.
# Example (from repo root):
#   docker build -f backend/Dockerfile -t rw-gnr-admin .
# =============================================================================

FROM node:20-slim AS base
WORKDIR /app

# Install backend dependencies first (better layer caching).
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install --omit=dev

# Copy backend source and static frontend.
COPY backend/src ./backend/src
COPY frontend ./frontend

ENV NODE_ENV=production
ENV FRONTEND_DIR=/app/frontend
ENV PORT=3000

EXPOSE 3000

WORKDIR /app/backend
CMD ["node", "src/server.js"]
