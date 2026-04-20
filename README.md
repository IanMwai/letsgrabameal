# Let's Grab a Meal

Let's Grab a Meal is a lightweight personal CRM for staying in touch with friends, family, and people you want to keep close. It helps you track who you know, how often you want to catch up, the last time you connected, and the interactions you want to remember.

The live app is available at [letsgrabameal.fly.dev](https://letsgrabameal.fly.dev).

## Features

- Contact tracking with birthdays, cadence goals, "how I know them" tags, and preferred contact methods.
- Preferred catch-up method tracking, including in-person plans, calls, video chats, and texting.
- Editable interaction history so you can correct or expand past meeting, call, and message entries.
- Daily email summaries for birthdays and overdue catch-ups, with a direct link back to the app.
- Password-protected dashboard backed by signed auth cookies.

## Tech Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS
- Backend: Node.js, Express, better-sqlite3
- Email: Resend
- AI summary: Google Gemini
- Scheduling: node-cron
- Hosting: Fly.io

## Project Structure

```text
client/   React frontend
server/   Express API and SQLite access
```

## Environment Variables

Copy the example file and fill in the values your environment needs:

```bash
cp server/.env.example server/.env
```

Example values:

```bash
APP_PASSWORD=your-dashboard-password
COOKIE_SECRET=replace-with-a-long-random-string
NOTIFICATION_EMAIL=you@example.com
RESEND_API_KEY=your-resend-api-key
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash
TIMEZONE=America/New_York
APP_URL=https://letsgrabameal.fly.dev
PORT=3001
```

Notes:

- `APP_PASSWORD` and `COOKIE_SECRET` are required for the server to boot.
- `RESEND_API_KEY` and `NOTIFICATION_EMAIL` are required for daily email delivery.
- `GEMINI_API_KEY` is optional. If it is missing, the digest still sends with a fallback summary.
- `APP_URL` controls the dashboard link included in email digests.

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

## Build

Create a production frontend build from the root:

```bash
npm run build
```

To serve the built frontend through the Node server:

```bash
npm run preview
```

## Deployment

This app is configured for Fly.io. From the repo root:

```bash
fly deploy
```

Make sure the Fly app has the same environment variables set as your local `server/.env`.

## Daily Digest Behavior

The scheduled digest runs every day at 9:00 AM in the configured timezone. Each email includes:

- A short summary of birthdays and overdue catch-ups
- Counts for the day
- Contact cards for the people who need attention
- A direct link back to the live dashboard so you can update interactions quickly

## License

MIT
