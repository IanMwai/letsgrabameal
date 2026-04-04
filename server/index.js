const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const db = require('./database');
require('dotenv').config();
const { Resend } = require('resend');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cron = require('node-cron');

// Check for required environment variables on startup
if (!process.env.APP_PASSWORD || !process.env.COOKIE_SECRET) {
  console.error('FATAL ERROR: APP_PASSWORD or COOKIE_SECRET environment variables are not set.');
  process.exit(1);
}

const resend = new Resend(process.env.RESEND_API_KEY || 'dummy_key');
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const APP_TIMEZONE = process.env.TIMEZONE || 'America/New_York';

const app = express();
const port = process.env.PORT || 3001;

// Public health check for Fly.io (Safe: returns no data)
app.get('/health', (req, res) => res.status(200).send('OK'));

const COOKIE_SECRET = process.env.COOKIE_SECRET;
const APP_PASSWORD = process.env.APP_PASSWORD;

const zonedDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getFormatterParts(formatter, date) {
  return formatter.formatToParts(date).reduce((parts, part) => {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
    return parts;
  }, {});
}

function parseStoredDate(value) {
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00`);
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(value.replace(' ', 'T') + 'Z');
  }

  return new Date(value);
}

function getZonedDateKey(value) {
  const date = value instanceof Date ? value : parseStoredDate(value);

  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  const { year, month, day } = getFormatterParts(zonedDateFormatter, date);
  return `${year}-${month}-${day}`;
}

function getTodayMonthDay() {
  const todayKey = getZonedDateKey(new Date());
  return todayKey ? todayKey.slice(5, 10) : null;
}

function getMonthDayFromBirthday(value) {
  if (!value) return null;

  const dateOnlyMatch = value.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    return `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}`;
  }

  const zonedDateKey = getZonedDateKey(value);
  return zonedDateKey ? zonedDateKey.slice(5, 10) : null;
}

function diffCalendarDays(currentDateKey, previousDateKey) {
  if (!currentDateKey || !previousDateKey) return 0;

  const currentUtc = new Date(`${currentDateKey}T00:00:00Z`);
  const previousUtc = new Date(`${previousDateKey}T00:00:00Z`);

  return Math.max(0, Math.floor((currentUtc - previousUtc) / (1000 * 60 * 60 * 24)));
}

function getContactsWithDaysSince() {
  const todayKey = getZonedDateKey(new Date());
  const contacts = db.prepare('SELECT * FROM contacts').all();

  return contacts
    .map((contact) => {
      const referenceDateKey = getZonedDateKey(contact.last_contact_date || contact.created_at);

      return {
        ...contact,
        days_since_contact: diffCalendarDays(todayKey, referenceDateKey),
      };
    })
    .sort(
      (a, b) =>
        a.frequency_days - a.days_since_contact - (b.frequency_days - b.days_since_contact)
    );
}

function getContactsWithBirthdaysToday(contacts) {
  const todayMonthDay = getTodayMonthDay();

  return contacts.filter((contact) => getMonthDayFromBirthday(contact.birthday) === todayMonthDay);
}

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
  const contacts = getContactsWithDaysSince();
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
  const contacts = getContactsWithDaysSince();
  const overdue = contacts.filter((contact) => contact.days_since_contact >= contact.frequency_days);
  const birthdays = getContactsWithBirthdaysToday(contacts);

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
  const contacts = getContactsWithDaysSince();
  const overdue = contacts.filter((contact) => contact.days_since_contact >= contact.frequency_days);
  const birthdays = getContactsWithBirthdaysToday(contacts);

  const enrichContact = (contact) => {
    const lastInteraction = db.prepare('SELECT * FROM interactions WHERE contact_id = ? ORDER BY date DESC LIMIT 1').get(contact.id);
    return { ...contact, lastInteraction };
  };

  return {
    overdue: overdue.map(enrichContact),
    birthdays: birthdays.map(enrichContact)
  };
}

async function generateAISummary(overdue, birthdays) {
  if (!genAI) return null;
  
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `You are a helpful personal assistant for "Meal Grabber", an app that helps Ian stay in touch with friends.
    Based on the following data for today, write a short, friendly, and conversational summary (2-3 sentences max).
    If there's nothing to do, be encouraging. If there are people to reach out to, mention one or two specifically.
    
    Data:
    - Overdue contacts: ${overdue.map(c => `${c.first_name} ${c.last_name} (last met ${Math.floor(c.days_since_contact)} days ago, notes: ${c.lastInteraction?.notes || 'none'})`).join(', ')}
    - Birthdays today: ${birthdays.map(c => `${c.first_name} ${c.last_name}`).join(', ')}
    
    Address the email to Ian.`;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    console.error('CRON: Gemini AI error:', err);
    return null;
  }
}

async function sendNotificationEmails() {
  const apiKey = process.env.RESEND_API_KEY;
  const notificationEmail = process.env.NOTIFICATION_EMAIL;

  if (!apiKey || apiKey === 'your_resend_api_key_here') {
    console.warn('CRON: Skipping email notification: RESEND_API_KEY is not configured.');
    return;
  }

  if (!notificationEmail || notificationEmail === 'your_email@example.com') {
    console.warn('CRON: Skipping email notification: NOTIFICATION_EMAIL is not configured or using default.');
    return;
  }

  const { overdue, birthdays } = await getNotificationData();
  const aiSummary = await generateAISummary(overdue, birthdays);

  console.log(`CRON: Found ${overdue.length} overdue contacts and ${birthdays.length} birthdays. Sending daily summary.`);

  let html = '<h2>Meal Grabber Daily Digest</h2>';
  
  if (aiSummary) {
    html += `<div style="background: #f4f4f4; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
      <p style="font-style: italic; margin: 0;">${aiSummary.replace(/\n/g, '<br>')}</p>
    </div>`;
  }

  if (birthdays.length > 0) {
    html += '<h3>🎂 Birthdays Today</h3><ul>';
    birthdays.forEach(c => {
      html += `<li><strong>${c.first_name} ${c.last_name}</strong>`;
      if (c.lastInteraction) {
        html += `<br/><em>Last interaction (${c.lastInteraction.date}): ${c.lastInteraction.notes}</em>`;
      }
      html += '</li>';
    });
    html += '</ul>';
  }

  if (overdue.length > 0) {
    html += '<h3>⏳ Overdue for a Meal</h3><ul>';
    overdue.forEach(c => {
      html += `<li><strong>${c.first_name} ${c.last_name}</strong><br/>`;
      html += `<em>Target: Every ${c.frequency_days} days. It's been ${Math.floor(c.days_since_contact)} days.</em><br/>`;
      if (c.lastInteraction) {
        html += `<em>Last convo: "${c.lastInteraction.notes}" on ${c.lastInteraction.date}</em>`;
      } else {
        html += `<em>No previous interactions recorded.</em>`;
      }
      html += '</li><br/>';
    });
    html += '</ul>';
  }

  if (overdue.length === 0 && birthdays.length === 0) {
    html += '<p>You\'re all caught up! No one is overdue for a meal and there are no birthdays today. Enjoy your day!</p>';
  }

  try {
    const { data, error } = await resend.emails.send({
      from: 'Meal Grabber <onboarding@resend.dev>',
      to: [notificationEmail],
      subject: `Meal Grabber: ${overdue.length + birthdays.length} Reminders for Today`,
      html: html,
    });

    if (error) {
      return console.error('CRON: Resend error:', error);
    }

    console.log('CRON: Email sent successfully:', data.id);
  } catch (err) {
    console.error('CRON: Error sending email:', err);
  }
}

cron.schedule('0 9 * * *', () => {
  console.log('CRON: Running daily notification check...');
  sendNotificationEmails();
}, {
  timezone: APP_TIMEZONE
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
