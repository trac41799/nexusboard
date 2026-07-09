# syntax=docker/dockerfile:1

# ---- Builder stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies (including dev deps needed to build)
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Copy source and build the server
COPY tsconfig*.json ./
COPY src ./src
RUN npx prisma generate
RUN npm run build:server

# ---- Runtime stage ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies only
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev

# Reuse the Prisma client generated during the build stage
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy the compiled server output
COPY --from=builder /app/dist ./dist

# Runtime upload directory (resolved relative to dist/ by src/config.ts)
RUN mkdir -p /app/uploads

EXPOSE 3000
CMD ["node", "dist/server.js"]
