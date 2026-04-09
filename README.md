# Let's Grab a Meal

A personal CRM application to help you keep in touch with friends, family, and colleagues. Track your contacts, set catch-up frequencies (e.g., "every 30 days"), log your interactions, and receive automated email reminders for birthdays and overdue meetings.

## Features
- **Dashboard:** At-a-glance view of overdue connections and upcoming birthdays.
- **Contact Management:** Add contacts with custom tags and preferred communication methods.
- **Interaction History:** Log details of meetings, calls, and messages.
- **Daily Reminders:** Automated daily emails via Resend to remind you who to reach out to.
- **Secure Access:** Password-protected dashboard using signed cookies.

## Tech Stack
- **Frontend:** React (TypeScript), Vite, Tailwind CSS, Lucide Icons
- **Backend:** Node.js, Express, better-sqlite3
- **Email:** Resend API
- **Task Scheduling:** node-cron

## Setup Instructions

### 1. Environment Variables
Navigate to the `server` directory and copy the example environment file:
```bash
cd server
cp .env.example .env
```
Fill in the variables in `server/.env`:
- `RESEND_API_KEY`: Your API key from Resend (for emails).
- `GEMINI_API_KEY`: Your Google Gemini API key for the AI summary in the daily digest.
- `GEMINI_MODEL`: Optional. Defaults to `gemini-2.5-flash`.
- `APP_PASSWORD`: The password you will use to log into the web dashboard.
- `COOKIE_SECRET`: A random string used to sign auth cookies.
- `NOTIFICATION_EMAIL`: The email address where daily reminders will be sent.
- `PORT`: (Optional) Defaults to 3001.

### 2. Local Development
Make sure you have Node.js installed.

Install dependencies for both frontend and backend:
```bash
# In the root directory:
cd client && npm install
cd ../server && npm install
cd ..
```

Run the application using the included start script (runs both frontend and backend):
```bash
./start.sh
```
- **Frontend:** `http://localhost:5173`
- **Backend:** `http://localhost:3001`

### 3. Docker Deployment
A `Dockerfile` is included for easy containerization. It builds the React frontend and serves it via the Node.js backend.

```bash
docker build -t letsgrabameal .
docker run -p 3001:3001 -v $(pwd)/data:/app/data --env-file server/.env letsgrabameal
```
*Note: A volume is mapped to `/app/data` to persist your SQLite database (`database.db`).*

## License
MIT
