const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const db = require('./database');
require('dotenv').config();
const { Resend } = require('resend');
const cron = require('node-cron');

// Check for required environment variables on startup
if (!process.env.APP_PASSWORD || !process.env.COOKIE_SECRET) {
  console.error('FATAL ERROR: APP_PASSWORD or COOKIE_SECRET environment variables are not set.');
  process.exit(1);
}

const resend = new Resend(process.env.RESEND_API_KEY || 'dummy_key');

const app = express();
const port = process.env.PORT || 3001;

// Public health check for Fly.io (Safe: returns no data)
app.get('/health', (req, res) => res.status(200).send('OK'));

const COOKIE_SECRET = process.env.COOKIE_SECRET;
const APP_PASSWORD = process.env.APP_PASSWORD;

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? true : 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(cookieParser(COOKIE_SECRET));

// Auth Middleware
const authMiddleware = (req, res, next) => {
  // Allow login route, health check, and public assets
  if (req.path === '/api/login' || req.path === '/health' || req.path.startsWith('/assets/')) {
    return next();
  }

  const authCookie = req.signedCookies.auth;
  if (authCookie === 'true') {
    return next();
  }

  // If it's an API request, return 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Serve the frontend for all other requests
  next();
};

app.use(authMiddleware);

// Login Endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === APP_PASSWORD) {
    res.cookie('auth', 'true', { 
      signed: true, 
      httpOnly: true, 
      maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
    });
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Invalid password' });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('auth');
  res.json({ success: true });
});

app.get('/api/auth-check', (req, res) => {
  const authCookie = req.signedCookies.auth;
  res.json({ authenticated: authCookie === 'true' });
});

// Contacts Endpoints
app.get('/api/contacts', (req, res) => {
  const contacts = db.prepare(`
    SELECT *, 
    (julianday('now') - julianday(COALESCE(last_contact_date, created_at))) as days_since_contact 
    FROM contacts 
    ORDER BY (frequency_days - (julianday('now') - julianday(COALESCE(last_contact_date, created_at)))) ASC
  `).all();
  res.json(contacts);
});

app.post('/api/contacts', (req, res) => {
  const { first_name, last_name, birthday, frequency_days, tags, preferred_contact_method, preferred_meeting_method } = req.body;
  const info = db.prepare(`
    INSERT INTO contacts (first_name, last_name, birthday, frequency_days, tags, preferred_contact_method, preferred_meeting_method) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    first_name, 
    last_name || '', 
    birthday || null,
    frequency_days || 30, 
    Array.isArray(tags) ? tags.join(',') : (tags || ''), 
    preferred_contact_method || 'Texting', 
    preferred_meeting_method || 'In-person'
  );
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/contacts/:id', (req, res) => {
  const { first_name, last_name, birthday, frequency_days, tags, preferred_contact_method, preferred_meeting_method } = req.body;
  db.prepare(`
    UPDATE contacts SET 
      first_name = ?, 
      last_name = ?, 
      birthday = ?, 
      frequency_days = ?, 
      tags = ?, 
      preferred_contact_method = ?, 
      preferred_meeting_method = ?
    WHERE id = ?
  `).run(
    first_name, 
    last_name || '', 
    birthday || null,
    frequency_days || 30, 
    Array.isArray(tags) ? tags.join(',') : (tags || ''), 
    preferred_contact_method || 'Texting', 
    preferred_meeting_method || 'In-person',
    req.params.id
  );
  res.status(200).send();
});

app.get('/api/notify-check', (req, res) => {
  const overdue = db.prepare(`
    SELECT *, 
    (julianday('now') - julianday(COALESCE(last_contact_date, created_at))) as days_since_contact 
    FROM contacts 
    WHERE (julianday('now') - julianday(COALESCE(last_contact_date, created_at))) >= frequency_days
  `).all();
  
  const today = new Date().toISOString().slice(5, 10); // MM-DD
  const birthdays = db.prepare(`
    SELECT * FROM contacts 
    WHERE strftime('%m-%d', birthday) = ?
  `).all(today);

  res.json({ overdue, birthdays });
});

app.get('/api/contacts/:id', (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  const interactions = db.prepare('SELECT * FROM interactions WHERE contact_id = ? ORDER BY date DESC').all(req.params.id);
  res.json({ ...contact, interactions });
});

app.delete('/api/contacts/:id', (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

// Interactions Endpoints
app.post('/api/interactions', (req, res) => {
  const { contact_id, type, date, notes } = req.body;
  
  const insertInteraction = db.transaction(() => {
    db.prepare('INSERT INTO interactions (contact_id, type, date, notes) VALUES (?, ?, ?, ?)').run(contact_id, type, date, notes);
    db.prepare('UPDATE contacts SET last_contact_date = ? WHERE id = ?').run(date, contact_id);
  });

  insertInteraction();
  res.status(201).send();
});

// Notification Logic
async function getNotificationData() {
  const overdue = db.prepare(`
    SELECT *, 
    (julianday('now') - julianday(COALESCE(last_contact_date, created_at))) as days_since_contact 
    FROM contacts 
    WHERE (julianday('now') - julianday(COALESCE(last_contact_date, created_at))) >= frequency_days
  `).all();
  
  const today = new Date().toISOString().slice(5, 10); // MM-DD
  const birthdays = db.prepare(`
    SELECT * FROM contacts 
    WHERE strftime('%m-%d', birthday) = ?
  `).all(today);

  const enrichContact = (contact) => {
    const lastInteraction = db.prepare('SELECT * FROM interactions WHERE contact_id = ? ORDER BY date DESC LIMIT 1').get(contact.id);
    return { ...contact, lastInteraction };
  };

  return {
    overdue: overdue.map(enrichContact),
    birthdays: birthdays.map(enrichContact)
  };
}

async function sendNotificationEmails() {
  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === 'your_resend_api_key_here') {
    console.log('Skipping email notification: No API key found.');
    return;
  }

  const { overdue, birthdays } = await getNotificationData();

  if (overdue.length === 0 && birthdays.length === 0) {
    console.log('No notifications to send today.');
    return;
  }

  let html = '<h2>Meal Grabber Reminders</h2>';

  if (birthdays.length > 0) {
    html += '<h3>🎂 Birthdays Today</h3><ul>';
    birthdays.forEach(c => {
      html += `<li><strong>${c.first_name} ${c.last_name}</strong>`;
      if (c.lastInteraction) {
        html += `<br/><em>Last convo: ${c.lastInteraction.notes} (${c.lastInteraction.date})</em>`;
      }
      html += '</li>';
    });
    html += '</ul>';
  }

  if (overdue.length > 0) {
    html += '<h3>⏳ Overdue for a Meal</h3><ul>';
    overdue.forEach(c => {
      html += `<li><strong>${c.first_name} ${c.last_name}</strong> (Due every ${c.frequency_days} days, last met ${Math.floor(c.days_since_contact)} days ago)`;
      if (c.lastInteraction) {
        html += `<br/><em>Last convo: ${c.lastInteraction.notes} (${c.lastInteraction.date})</em>`;
      }
      html += '</li>';
    });
    html += '</ul>';
  }

  try {
    const { data, error } = await resend.emails.send({
      from: 'Meal Grabber <onboarding@resend.dev>',
      to: [process.env.NOTIFICATION_EMAIL || 'your_email@example.com'],
      subject: `Meal Grabber: ${overdue.length + birthdays.length} Reminders for Today`,
      html: html,
    });

    if (error) {
      return console.error({ error });
    }

    console.log({ data });
  } catch (err) {
    console.error('Error sending email:', err);
  }
}

cron.schedule('0 9 * * *', () => {
  console.log('Running daily notification check...');
  sendNotificationEmails();
});

app.get('/api/test-notify', async (req, res) => {
  await sendNotificationEmails();
  res.send('Notification check triggered. Check server console.');
});

// Serve static files for hosting
app.use(express.static(path.join(__dirname, '../client/dist')));
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});
