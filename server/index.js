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
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const APP_TIMEZONE = process.env.TIMEZONE || 'America/New_York';

const app = express();
const port = process.env.PORT || 3001;

// Public health check for Fly.io (Safe: returns no data)
app.get('/health', (req, res) => res.status(200).send('OK'));

const COOKIE_SECRET = process.env.COOKIE_SECRET;
const APP_PASSWORD = process.env.APP_PASSWORD;

if (!process.env.GEMINI_API_KEY) {
  console.warn('Startup warning: GEMINI_API_KEY is not configured. Daily digest emails will be sent without an AI summary.');
}

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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatContactName(contact) {
  return [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
}

function formatInteractionDate(value) {
  const parsed = parseStoredDate(value);
  if (!parsed || Number.isNaN(parsed.getTime())) return null;

  return new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

function formatDigestDate() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildFallbackSummary(overdue, birthdays) {
  if (overdue.length === 0 && birthdays.length === 0) {
    return "You’re all caught up today. No overdue catch-ups and no birthdays on deck, so you can relax until the next check-in.";
  }

  const parts = [];

  if (birthdays.length > 0) {
    const birthdayNames = birthdays.slice(0, 2).map((contact) => contact.first_name).join(' and ');
    parts.push(
      birthdays.length === 1
        ? `${birthdayNames} has a birthday today`
        : `${birthdayNames}${birthdays.length > 2 ? ' and others have' : ' have'} birthdays today`
    );
  }

  if (overdue.length > 0) {
    const overdueNames = overdue.slice(0, 2).map((contact) => contact.first_name).join(' and ');
    parts.push(
      overdue.length === 1
        ? `${overdueNames} is ready for a catch-up`
        : `${overdueNames}${overdue.length > 2 ? ' and others are' : ' are'} due for a meal`
    );
  }

  return `${parts.join(', and ')}. A small nudge today could keep the momentum going.`;
}

function normalizeIntroSummary(summaryText) {
  if (!summaryText) return null;

  return summaryText
    .trim()
    .replace(/^hi ian[,!.\s-]*/i, '')
    .replace(/^here'?s your relationship pulse for (today|[a-z]+,\s+[a-z]+\s+\d{1,2})[,!.\s-]*/i, '')
    .trim();
}

function buildInfoPill(label, value) {
  return `
    <span style="display:inline-block; padding:6px 10px; margin:0 8px 8px 0; border-radius:999px; background:#273449; border:1px solid #334155; color:#cbd5e1; font-size:12px; line-height:16px;">
      <strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}
    </span>
  `;
}

function buildContactCard(contact, options = {}) {
  const {
    accentColor = '#D97706',
    eyebrow = '',
    detailLine = '',
  } = options;

  const interactionDate = contact.lastInteraction?.date ? formatInteractionDate(contact.lastInteraction.date) : null;
  const interactionNotes = contact.lastInteraction?.notes ? escapeHtml(contact.lastInteraction.notes) : null;
  const preferencePills = [
    contact.preferred_contact_method ? buildInfoPill('Reach out via', contact.preferred_contact_method) : '',
    contact.preferred_meeting_method ? buildInfoPill('Best plan', contact.preferred_meeting_method) : '',
    contact.tags ? buildInfoPill('Tags', contact.tags) : '',
  ].join('');

  return `
    <tr>
      <td style="padding:0 0 14px 0;">
        <div style="border:1px solid #334155; border-radius:18px; background:#162033; padding:18px 18px 16px 18px; box-shadow:0 10px 24px rgba(2, 6, 23, 0.18);">
          ${eyebrow ? `<div style="font-size:12px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:${accentColor}; margin-bottom:8px;">${escapeHtml(eyebrow)}</div>` : ''}
          <div style="font-size:22px; line-height:28px; font-weight:700; color:#f8fafc; margin-bottom:8px;">${escapeHtml(formatContactName(contact))}</div>
          ${detailLine ? `<div style="font-size:15px; line-height:22px; color:#cbd5e1; margin-bottom:12px;">${detailLine}</div>` : ''}
          ${preferencePills ? `<div style="margin-bottom:${interactionNotes || interactionDate ? '12px' : '0'};">${preferencePills}</div>` : ''}
          ${
            interactionNotes || interactionDate
              ? `<div style="padding:14px; border-radius:14px; background:#0f172a; border:1px solid #334155; color:#cbd5e1;">
                  <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:#94a3b8; font-weight:700; margin-bottom:6px;">Last interaction${interactionDate ? ` • ${escapeHtml(interactionDate)}` : ''}</div>
                  <div style="font-size:15px; line-height:22px; font-style:italic; color:#e2e8f0;">${interactionNotes || 'No notes saved for the latest interaction.'}</div>
                </div>`
              : `<div style="padding:14px; border-radius:14px; background:#0f172a; border:1px solid #334155; color:#94a3b8; font-size:14px; line-height:20px;">No previous interactions recorded yet.</div>`
          }
        </div>
      </td>
    </tr>
  `;
}

function buildDigestEmail({ overdue, birthdays, summaryText }) {
  const totalReminders = overdue.length + birthdays.length;
  const introSummary = normalizeIntroSummary(summaryText) || buildFallbackSummary(overdue, birthdays);
  const summaryCards = [
    { label: 'Total reminders', value: totalReminders, tone: '#c4b5fd', bg: '#312e81' },
    { label: 'Birthdays', value: birthdays.length, tone: '#f9a8d4', bg: '#4a1d3b' },
    { label: 'Meals to plan', value: overdue.length, tone: '#fcd34d', bg: '#4a3114' },
  ];

  const birthdayCards = birthdays.map((contact) =>
    buildContactCard(contact, {
      accentColor: '#DB2777',
      eyebrow: 'Birthday today',
      detailLine: 'A quick text, call, or plan could go a long way today.',
    })
  ).join('');

  const overdueCards = overdue.map((contact) =>
    buildContactCard(contact, {
      accentColor: '#D97706',
      eyebrow: contact.days_since_contact > contact.frequency_days ? 'Past due' : 'Due today',
      detailLine: `Target cadence: every ${escapeHtml(contact.frequency_days)} days. It has been ${escapeHtml(Math.floor(contact.days_since_contact))} day${Math.floor(contact.days_since_contact) === 1 ? '' : 's'} since your last logged interaction.`,
    })
  ).join('');

  const emptyState = overdue.length === 0 && birthdays.length === 0
    ? `
      <tr>
        <td style="padding-top:8px;">
          <div style="border-radius:20px; background:#162033; border:1px solid #334155; padding:22px; box-shadow:0 10px 24px rgba(2, 6, 23, 0.18);">
            <div style="font-size:20px; line-height:28px; font-weight:700; color:#f8fafc; margin-bottom:8px;">A quiet day is a good sign.</div>
            <div style="font-size:15px; line-height:24px; color:#cbd5e1;">
              No birthdays and no overdue meals today. You’ve got space to be intentional instead of reactive.
            </div>
          </div>
        </td>
      </tr>
    `
    : '';

  return `
    <!DOCTYPE html>
    <html lang="en">
      <body style="margin:0; padding:0; background:#0f172a; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#f8fafc;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f172a; padding:24px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px; background:#1e293b; border:1px solid #334155; border-radius:28px; overflow:hidden; box-shadow:0 20px 50px rgba(2, 6, 23, 0.32);">
                <tr>
                  <td style="padding:32px 32px 24px 32px; background:linear-gradient(135deg, #1f2937 0%, #172033 50%, #111827 100%); border-bottom:1px solid #334155;">
                    <div style="font-size:13px; line-height:18px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#94a3b8; margin-bottom:12px;">Meal Grabber Daily Digest</div>
                    <div style="font-size:34px; line-height:40px; font-weight:800; color:#f8fafc; margin-bottom:10px;">Hi Ian, here’s your relationship pulse for ${escapeHtml(formatDigestDate())}.</div>
                    <div style="font-size:16px; line-height:26px; color:#cbd5e1; max-width:560px;">${escapeHtml(introSummary)}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 24px 8px 24px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        ${summaryCards.map((card) => `
                          <td style="padding:0 8px 16px 8px; width:33.33%;">
                            <div style="background:${card.bg}; border:1px solid rgba(255,255,255,0.06); border-radius:20px; padding:18px 16px; text-align:left;">
                              <div style="font-size:13px; line-height:18px; color:${card.tone}; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:8px;">${escapeHtml(card.label)}</div>
                              <div style="font-size:32px; line-height:36px; color:#f8fafc; font-weight:800;">${escapeHtml(card.value)}</div>
                            </div>
                          </td>
                        `).join('')}
                      </tr>
                    </table>
                  </td>
                </tr>
                ${
                  birthdays.length > 0
                    ? `<tr>
                        <td style="padding:8px 32px 8px 32px;">
                          <div style="font-size:24px; line-height:30px; font-weight:800; color:#f8fafc; margin-bottom:6px;">Birthdays today</div>
                          <div style="font-size:15px; line-height:24px; color:#cbd5e1; margin-bottom:16px;">${pluralize(birthdays.length, 'person')} worth celebrating today.</div>
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${birthdayCards}</table>
                        </td>
                      </tr>`
                    : ''
                }
                ${
                  overdue.length > 0
                    ? `<tr>
                        <td style="padding:8px 32px 8px 32px;">
                          <div style="font-size:24px; line-height:30px; font-weight:800; color:#f8fafc; margin-bottom:6px;">Catch-ups to plan</div>
                          <div style="font-size:15px; line-height:24px; color:#cbd5e1; margin-bottom:16px;">${pluralize(overdue.length, 'meal')} could use a little momentum.</div>
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${overdueCards}</table>
                        </td>
                      </tr>`
                    : ''
                }
                ${emptyState}
                <tr>
                  <td style="padding:16px 32px 32px 32px;">
                    <div style="padding-top:18px; border-top:1px solid #334155; font-size:13px; line-height:22px; color:#94a3b8;">
                      Meal Grabber is meant to make staying in touch feel lighter, not heavier. Small consistency beats perfect planning.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
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
  if (!genAI) {
    return {
      text: null,
      error: 'GEMINI_API_KEY is not configured.',
    };
  }
  
  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const prompt = `You are a helpful personal assistant for "Meal Grabber", an app that helps Ian stay in touch with friends.
    Based on the following data for today, write a short, warm, emotionally intelligent summary for an email intro (2-3 sentences max).
    Make it feel personal and encouraging, not robotic. If there are people to reach out to, mention one or two specifically.
    Avoid bullet points, avoid greetings/sign-offs, and avoid repeating raw dates or exact timestamps.
    Do not start with "Hi Ian" and do not repeat the heading "here’s your relationship pulse".
    
    Data:
    - Overdue contacts: ${overdue.map(c => `${c.first_name} ${c.last_name} (last met ${Math.floor(c.days_since_contact)} days ago, notes: ${c.lastInteraction?.notes || 'none'})`).join(', ')}
    - Birthdays today: ${birthdays.map(c => `${c.first_name} ${c.last_name}`).join(', ')}
    
    The summary will appear under the heading "Hi Ian, here’s your relationship pulse for today."`;

    const result = await model.generateContent(prompt);
    return {
      text: result.response.text(),
      error: null,
    };
  } catch (err) {
    console.error('CRON: Gemini AI error:', err);
    return {
      text: null,
      error: err?.message || 'Unknown Gemini error.',
    };
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
  const aiSummaryResult = await generateAISummary(overdue, birthdays);
  const aiSummary = aiSummaryResult.text;

  console.log(`CRON: Found ${overdue.length} overdue contacts and ${birthdays.length} birthdays. Sending daily summary.`);
  if (aiSummaryResult.error) {
    console.warn(`CRON: AI summary unavailable: ${aiSummaryResult.error}`);
  }

  const html = buildDigestEmail({
    overdue,
    birthdays,
    summaryText: aiSummary,
  });

  try {
    const { data, error } = await resend.emails.send({
      from: 'Meal Grabber <onboarding@resend.dev>',
      to: [notificationEmail],
      subject: `Meal Grabber: ${overdue.length + birthdays.length} Reminders for Today`,
      html: html,
    });

    if (error) {
      console.error('CRON: Resend error:', error);
      return {
        sent: false,
        resendError: error,
        aiSummaryIncluded: Boolean(aiSummary),
        aiSummaryError: aiSummaryResult.error,
        overdueCount: overdue.length,
        birthdayCount: birthdays.length,
      };
    }

    console.log('CRON: Email sent successfully:', data.id);
    return {
      sent: true,
      emailId: data.id,
      aiSummaryIncluded: Boolean(aiSummary),
      aiSummaryError: aiSummaryResult.error,
      overdueCount: overdue.length,
      birthdayCount: birthdays.length,
    };
  } catch (err) {
    console.error('CRON: Error sending email:', err);
    return {
      sent: false,
      sendError: err?.message || 'Unknown email send error.',
      aiSummaryIncluded: Boolean(aiSummary),
      aiSummaryError: aiSummaryResult.error,
      overdueCount: overdue.length,
      birthdayCount: birthdays.length,
    };
  }
}

cron.schedule('0 9 * * *', () => {
  console.log('CRON: Running daily notification check...');
  sendNotificationEmails();
}, {
  timezone: APP_TIMEZONE
});

app.get('/api/test-notify', async (req, res) => {
  const result = await sendNotificationEmails();
  res.json({
    message: 'Notification check triggered.',
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    ...result,
  });
});

// Serve static files for hosting
app.use(express.static(path.join(__dirname, '../client/dist')));
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});
