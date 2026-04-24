# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

- **video-grabber** (web, `/`): "GRABBY" — dark hacker-themed React+Vite UI for downloading YouTube and Bilibili videos and playlists. Lets users paste a link, see all available formats/qualities, and click to download.
- **api-server** (api): Express 5 backend exposing `POST /api/extract` (probes URL via yt-dlp, returns `kind: video|playlist` with format list) and `GET /api/download` (streams the chosen format via yt-dlp).

## System dependencies

- `yt-dlp` — installed via Nix; used by api-server for URL probe and download streaming.
- `ffmpeg` — required by yt-dlp when merging separate video+audio streams.

## Backend notes (video-grabber)

- `artifacts/api-server/src/lib/ytdlp.ts` — wraps yt-dlp:
  - `probeUrl` (flat-playlist probe) and `probeVideo` (single video re-probe).
  - `spawnDownload` — direct stdout streaming for single-format downloads; merge path (download to temp dir, then stream file) when formatId contains `+` or merge is requested. Cleans up temp dir afterwards.
- `artifacts/api-server/src/routes/media.ts` — extract + download endpoints:
  - URL allow-list restricts to youtube.com / youtu.be / bilibili.com / b23.tv (and subdomains).
  - `injectMergedFormats` synthesizes "video_audio" entries by pairing each unique-height video-only stream with the best audio-only stream (formatId becomes `<videoId>+<audioId>`). Output container is mp4 when both inputs are mp4/m4a, else mkv. This is essential because YouTube usually only provides DASH/HLS-split streams.
  - `humanizeYtdlpError` translates common yt-dlp errors into user-facing messages.

## Frontend notes (video-grabber)

- Generated hook `useExtractMedia` from `@workspace/api-client-react`.
- Download is initiated via plain `<a href download>` to `/api/download?url=...&formatId=...&filename=...` so the browser handles it natively.
- Three tabs: Video + Audio (combined/merged), Video Only, Audio Only.
- Playlist view shows entries with expandable per-video format lists.
