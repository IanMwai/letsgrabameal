# Let's Grab a Meal

I need a nudge every so often to remember to reconnect with friends and family, as I sometimes lose track of how long it has been since we last talked. Something I always keep up with, though, is my email. Let's Grab a Meal tracks who I know, how often I want to catch up, the last time we connected, and the interactions I want to remember. A daily email then nudges me to reconnect with overdue contacts or send someone a birthday message.

The app is configured to run on Cloudflare Workers with D1.

## Features

- Contact tracking with birthdays, cadence goals, "how I know them" tags, and preferred contact methods.
- Preferred catch-up method tracking, including in-person plans, calls, video chats, and texting.
- Editable interaction history so you can correct or expand past meeting, call, and message entries.
- Daily email summaries for birthdays and overdue catch-ups, with a direct link back to the app.
- Private production access through Cloudflare Access.

## Tech Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS
- Production backend: Cloudflare Worker
- Local backend: Node.js, Express, better-sqlite3
- Production database: Cloudflare D1
- Email: Resend
- Scheduling: Cloudflare Workers Cron Triggers
- Hosting: Cloudflare Workers static assets

## Project Structure

```text
client/      React frontend
server/      Local-only Express API and SQLite database
worker/      Production Worker API, static assets, and scheduled digest
migrations/  D1 schema migrations
scripts/     SQLite-to-D1 export utility
```

## Environment Variables

Copy the example file and fill in the values your environment needs:

```bash
cp server/.env.example server/.env
```

Example values:

```bash
NOTIFICATION_EMAIL=you@example.com
RESEND_API_KEY=your-resend-api-key
EMAIL_FROM=Let's Grab a Meal <onboarding@resend.dev>
TIMEZONE=America/New_York
APP_URL=https://letsgrabameal.your-subdomain.workers.dev
PORT=3001
DATABASE_URL=./database.db
ENABLE_TEST_NOTIFY=false
```

Notes:

- `RESEND_API_KEY` and `NOTIFICATION_EMAIL` are required for daily email delivery.
- `APP_URL` controls the dashboard link included in email digests.
- `EMAIL_FROM` should be changed to a verified Resend sender when sending production
  mail.
- `DATABASE_URL` is resolved relative to `server/` and selects the local SQLite file.
- `ENABLE_TEST_NOTIFY` must be explicitly set to `true` to enable the local manual
  notification endpoint.

## Local Development

Install dependencies from the repo root:

```bash
npm install
```

Start the frontend and backend together:

```bash
npm run dev
```

Default local URLs:

- Frontend: `http://localhost:5173`
- Backend/API: `http://localhost:3001`

The local server binds to `127.0.0.1` by default and is intended only for development.
Do not expose it through a public tunnel.

### Local demo data

Use a separate ignored SQLite database for demos so personal data is never loaded:

```bash
# server/.env
DATABASE_URL=./demo.db
ENABLE_TEST_NOTIFY=true
```

Start the app normally and add made-up contacts through the UI. To return to personal
local data after recording, change `DATABASE_URL` back to `./database.db`. Both files
are ignored by Git.

To send a real test digest using the currently selected local database, configure the
Resend variables in `server/.env`, start the app, and run:

```bash
curl -X POST http://127.0.0.1:3001/api/test-notify
```

The endpoint returns `404` unless `ENABLE_TEST_NOTIFY=true`, and it is unavailable
when the local server is started with `NODE_ENV=production`.

## Build

Create a production frontend build from the root:

```bash
npm run build
```

To serve the built frontend through the Node server:

```bash
npm run preview
```

## Cloudflare Deployment

Cloudflare is the no-monthly-fee target for this app. The Worker serves the built
Vite frontend, the API routes, the scheduled digest, and D1-backed persistence.

For a fresh Cloudflare account, create a D1 database:

```bash
npx wrangler d1 create letsgrabameal
```

Copy the returned database ID into the `database_id` field in `wrangler.toml`. If the
configured `letsgrabameal` database already exists in your account, keep its current
ID instead of creating another database.

Apply the schema:

```bash
npm run cf:migrate:remote
```

Set secrets and runtime values:

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put NOTIFICATION_EMAIL
npx wrangler secret put APP_URL
npx wrangler secret put EMAIL_FROM
```

Deploy once to create or update the Worker. Until Access is configured, API requests
fail closed with no database access:

```bash
npm run cf:deploy
```

### Require login with Cloudflare Access

Production API routes fail closed until Cloudflare Access is configured. After the
first deployment:

1. In Cloudflare, open **Workers & Pages**, select `letsgrabameal`, then open
   **Settings > Domains & Routes**.
2. Enable Cloudflare Access for the `workers.dev` route.
3. Configure an Allow policy containing only your email address.
4. In **Zero Trust > Access controls > Applications**, open the application and copy
   its Application Audience (AUD) tag.
5. Note your team domain, such as `https://your-team.cloudflareaccess.com`.
6. Store both values on the Worker:

```bash
npx wrangler secret put TEAM_DOMAIN
npx wrangler secret put POLICY_AUD
```

Visitors are redirected to Cloudflare's login flow before the app loads. The Worker
also verifies the signed Access JWT, its issuer, and its audience before serving any
API request. Missing or invalid Access configuration denies database access.

Deploy again after setting the Access values:

```bash
npm run cf:deploy
```

The production manual notification route is an authenticated `POST`, not a public
link. While signed in, it can be triggered from the browser console with:

```js
fetch('/api/test-notify', { method: 'POST' }).then((response) => response.json())
```

## Data Migration

If you have an existing SQLite database file, export its rows into D1-compatible SQL:

```bash
node scripts/export-sqlite-to-d1.mjs server/database.db migrations/import-data.sql
npm run cf:import:remote
```

`migrations/import-data.sql` is ignored because an export can contain personal data.

## Security model

- D1 is reachable only through its Worker binding; browsers never receive database
  credentials.
- Cloudflare Access protects the deployed site and API, and the Worker independently
  validates Access JWTs.
- API request bodies are JSON-only, limited to 16 KiB, and validated before database
  writes.
- Mutating browser requests enforce same-origin access.
- API responses are not cached, internal errors are not returned to clients, and the
  Worker adds restrictive browser security headers.
- Resend credentials and Access configuration are stored as Worker secrets, not in
  source control.

## Daily Digest Behavior

The scheduled digest runs every day at 9:00 AM in the configured timezone. Each email includes:

- A minimal deterministic summary of birthdays and overdue catch-ups
- Counts for the day
- Contact rows with preferred methods and the latest interaction note as "Last touch"
- A direct link back to the live dashboard so you can update interactions quickly

## License

MIT
