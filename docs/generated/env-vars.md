# Environment Variables

> This file is the authoritative reference for all environment variables used in TomeKeep.
> Do not introduce new variables without updating this document.

## Desktop App (`packages/desktop`)

| Name | Required | Default | Description | Security Sensitive |
|------|----------|---------|-------------|--------------------|
| `VITE_DEV_SERVER_URL` | no | — | Set automatically by `vite-plugin-electron` during `pnpm dev` to point the Electron main process at the Vite dev server URL. Do not set manually. | no |
| `TOMEKEEP_API_URL` | no | `https://tomekeep.pages.dev/api` | Override the cloud sync API base URL. Useful for pointing at a local or staging instance. | no |
| `TOMEKEEP_USERNAME` | no | — | Used only by the one-shot `scripts/migrate-to-cloud.ts` migration script. Not used by the app at runtime. | yes |
| `TOMEKEEP_PASSWORD` | no | — | Used only by the one-shot `scripts/migrate-to-cloud.ts` migration script. Not used by the app at runtime. | yes |
| `TOMEKEEP_DB_PATH` | no | — | Override the local database file path for the migration script. | no |
| `TOMEKEEP_COVERS_DIR` | no | — | Override the local covers directory path for the migration script. | no |

## Web / Cloudflare Workers (`packages/web`)

These variables are set as **Cloudflare Worker secrets** via `wrangler secret put <NAME>` and
are never stored in source code or committed files.

| Name | Required | Default | Description | Security Sensitive |
|------|----------|---------|-------------|--------------------|
| `JWT_SECRET` | **yes** | — | HMAC-SHA256 secret used to sign and verify JWT authentication tokens. Must be a long random string. Rotate immediately if compromised. | **yes** |
| `ADMIN_SETUP_TOKEN` | no | — | One-time token to bootstrap the first admin user via `POST /api/auth/admin-setup`. The endpoint self-disables after first use. | **yes** |
| `CF_PAGES` | no | — | Set automatically by Cloudflare Pages on production deployments. Used to toggle `Secure` flag on auth cookies and other production-only behavior. Do not set manually. | no |

## Setting Secrets for Local Development

For `packages/web` local development with Wrangler, create `packages/web/.dev.vars`
(already gitignored) with the following content:

```
JWT_SECRET=<random-string-at-least-32-chars>
ADMIN_SETUP_TOKEN=<random-string>
```

For production, use:

```sh
wrangler secret put JWT_SECRET
wrangler secret put ADMIN_SETUP_TOKEN
```
