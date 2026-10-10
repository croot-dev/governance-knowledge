FROM node:22-bookworm-slim AS base
# poppler-utils: PDF page count, text layer and page rendering for OCR.
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# .env is excluded from the image; an empty one keeps tsx --env-file-if-exists quiet.
# Real values come from compose environment, which an env file never overrides.
RUN touch .env
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build
EXPOSE 3000
CMD ["pnpm", "start"]
