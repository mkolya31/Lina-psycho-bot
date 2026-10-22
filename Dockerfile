FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/data/participants.sqlite

WORKDIR /app

# Docker copies this directory's ownership to a newly created named volume.
RUN mkdir /data && chown node:node /data && chmod 700 /data

# No npm install: this application uses only Node.js built-in modules.
COPY --chown=node:node package.json LICENSE ./
COPY --chown=node:node src/ ./src/
COPY --chown=node:node scripts/ ./scripts/

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "scripts/healthcheck.js"]

CMD ["node", "src/index.js"]
