FROM node:22-alpine

WORKDIR /app

RUN corepack enable

COPY . .

RUN corepack pnpm install --frozen-lockfile

USER node

EXPOSE 3003

HEALTHCHECK --interval=10s --timeout=5s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:3003/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["./node_modules/.bin/tsx", "apps/github-poller/src/server.ts"]
