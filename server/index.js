const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const APP_TIMEZONE = process.env.TIMEZONE || 'America/New_York';
const APP_URL = process.env.APP_URL || 'https://letsgrabameal.iantoyota.workers.dev';

const app = express();
const port = process.env.PORT || 3001;
const host = process.env.HOST || '127.0.0.1';

// Public health check for local/dev process managers
app.get('/health', (req, res) => res.status(200).send('OK'));

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
      const latestInteraction = db
        .prepare('SELECT * FROM interactions WHERE contact_id = ? ORDER BY date DESC LIMIT 1')
        .get(contact.id);

      return {
        ...contact,
        days_since_contact: diffCalendarDays(todayKey, referenceDateKey),
        latestInteraction: latestInteraction || null,
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

function normalizeRelationshipTags(payload = {}) {
  const value = payload.how_i_know_them ?? payload.tags;
  return Array.isArray(value) ? value.join(',') : (value || '');
}

function normalizePreferredContactMethod(payload = {}) {
  return payload.preferred_contact_method || 'Texting';
}

function normalizeCatchUpMethod(payload = {}) {
  return payload.preferred_catch_up_method || payload.preferred_meeting_method || 'In-person';
}

function syncContactLastInteraction(contactId) {
  const latestInteraction = db
    .prepare('SELECT date FROM interactions WHERE contact_id = ? ORDER BY date DESC LIMIT 1')
    .get(contactId);

  db.prepare('UPDATE contacts SET last_contact_date = ? WHERE id = ?').run(
    latestInteraction?.date || null,
    contactId
  );
}

function buildDigestSummary(overdue, birthdays) {
  if (overdue.length === 0 && birthdays.length === 0) {
    return 'No birthdays or overdue catch-ups today.';
  }

  const parts = [];
  if (birthdays.length > 0) parts.push(pluralize(birthdays.length, 'birthday', 'birthdays'));
  if (overdue.length > 0) parts.push(pluralize(overdue.length, 'catch-up', 'catch-ups'));
  return parts.join(' · ');
}

function buildDigestIntro(overdue, birthdays) {
  if (overdue.length === 0 && birthdays.length === 0) {
    return 'Hey Ian, you are up to date on check-ins today. Nothing needs your attention right now.';
  }

  return 'Hi Ian, take a little time to check in with the people below. A quick note or small plan is enough.';
}

function buildLastTouch(contact) {
  const notes = contact.lastInteraction?.notes?.trim();
  if (notes) return notes;

  if (contact.lastInteraction?.type) {
    return `${contact.lastInteraction.type} logged without notes.`;
  }

  return 'No interaction notes yet.';
}

function buildContactRow(contact, options = {}) {
  const { label = '', detail = '' } = options;

  return `
    <tr>
      <td style="padding:16px 0; border-top:1px solid #d9e4eb;">
        ${label ? `<div style="font-size:12px; line-height:18px; font-weight:800; color:#6f9f86; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px;">${escapeHtml(label)}</div>` : ''}
        <div style="font-size:20px; line-height:26px; font-weight:800; color:#243044; margin-bottom:4px;">${escapeHtml(formatContactName(contact))}</div>
        ${detail ? `<div style="font-size:14px; line-height:22px; color:#748094; margin-bottom:10px;">${detail}</div>` : ''}
        <div style="font-size:13px; line-height:20px; font-weight:800; color:#748094; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:4px;">Last touch</div>
        <div style="font-size:15px; line-height:24px; color:#526074;">${escapeHtml(buildLastTouch(contact))}</div>
      </td>
    </tr>
  `;
}

function buildDigestEmail({ overdue, birthdays }) {
  const totalReminders = overdue.length + birthdays.length;
  const headerPadding = totalReminders === 0 ? '28px 28px 18px 28px' : '28px 28px 10px 28px';
  const ctaPadding = totalReminders === 0 ? '8px 28px 28px 28px' : '24px 28px 28px 28px';
  const birthdayRows = birthdays.map((contact) =>
    buildContactRow(contact, {
      label: 'Birthday today',
      detail: 'Today',
    })
  ).join('');

  const overdueRows = overdue.map((contact) =>
    buildContactRow(contact, {
      label: contact.days_since_contact > contact.frequency_days ? 'Past due' : 'Due today',
      detail: `${Math.floor(contact.days_since_contact)} day${Math.floor(contact.days_since_contact) === 1 ? '' : 's'} since last interaction · every ${contact.frequency_days} days`,
    })
  ).join('');

  return `
    <!doctype html>
    <html lang="en">
      <body style="margin:0; padding:0; background:#edf3f7; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color:#243044;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf3f7; padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px; background:#f8fbfd; border:1px solid #d9e4eb; border-radius:18px;">
                <tr>
                  <td style="padding:${headerPadding};">
                    <div style="font-size:13px; line-height:18px; font-weight:800; color:#748094; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:10px;">Let's Grab a Meal</div>
                    <div style="font-size:30px; line-height:36px; font-weight:850; color:#243044; margin-bottom:8px;">Daily check-in</div>
                    <div style="font-size:16px; line-height:25px; color:#526074; margin-bottom:12px;">${escapeHtml(buildDigestIntro(overdue, birthdays))}</div>
                    <div style="font-size:14px; line-height:22px; color:#748094;">${escapeHtml(formatDigestDate())} · ${escapeHtml(buildDigestSummary(overdue, birthdays))}</div>
                  </td>
                </tr>
                ${birthdays.length > 0 ? `
                  <tr>
                    <td style="padding:26px 28px 0 28px;">
                      <div style="font-size:18px; line-height:24px; font-weight:850; color:#243044;">Birthdays</div>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${birthdayRows}</table>
                    </td>
                  </tr>
                ` : ''}
                ${overdue.length > 0 ? `
                  <tr>
                    <td style="padding:26px 28px 0 28px;">
                      <div style="font-size:18px; line-height:24px; font-weight:850; color:#243044;">Catch-ups</div>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${overdueRows}</table>
                    </td>
                  </tr>
                ` : ''}
                <tr>
                  <td style="padding:${ctaPadding};">
                    <a href="${escapeHtml(APP_URL)}" style="display:inline-block; padding:11px 14px; border-radius:10px; background:#5f8d75; color:#ffffff; font-size:14px; line-height:20px; font-weight:800; text-decoration:none;">Open app</a>
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

if (process.env.NODE_ENV !== 'production') {
  app.use(cors({
    origin: 'http://localhost:5173',
  }));
}
app.use(express.json({ limit: '16kb' }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Contacts Endpoints
app.get('/api/contacts', (req, res) => {
  const contacts = getContactsWithDaysSince();
  res.json(contacts);
});

app.post('/api/contacts', (req, res) => {
  const { first_name, last_name, birthday, frequency_days } = req.body;
  const info = db.prepare(`
    INSERT INTO contacts (first_name, last_name, birthday, frequency_days, tags, preferred_contact_method, preferred_meeting_method) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    first_name, 
    last_name || '', 
    birthday || null,
    frequency_days || 30, 
    normalizeRelationshipTags(req.body),
    normalizePreferredContactMethod(req.body),
    normalizeCatchUpMethod(req.body)
  );
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/contacts/:id', (req, res) => {
  const { first_name, last_name, birthday, frequency_days } = req.body;
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
    normalizeRelationshipTags(req.body),
    normalizePreferredContactMethod(req.body),
    normalizeCatchUpMethod(req.body),
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
    const info = db
      .prepare('INSERT INTO interactions (contact_id, type, date, notes) VALUES (?, ?, ?, ?)')
      .run(contact_id, type, date, notes || '');
    syncContactLastInteraction(contact_id);
    return info.lastInsertRowid;
  });

  const interactionId = insertInteraction();
  res.status(201).json({ id: interactionId });
});

app.put('/api/interactions/:id', (req, res) => {
  const { type, date, notes } = req.body;

  const updateInteraction = db.transaction(() => {
    const existing = db
      .prepare('SELECT contact_id FROM interactions WHERE id = ?')
      .get(req.params.id);

    if (!existing) {
      return null;
    }

    db.prepare('UPDATE interactions SET type = ?, date = ?, notes = ? WHERE id = ?').run(
      type,
      date,
      notes || '',
      req.params.id
    );
    syncContactLastInteraction(existing.contact_id);

    return existing.contact_id;
  });

  const contactId = updateInteraction();

  if (!contactId) {
    return res.status(404).json({ error: 'Interaction not found' });
  }

  res.status(200).send();
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

async function sendNotificationEmails() {
  const apiKey = process.env.RESEND_API_KEY;
  const notificationEmail = process.env.NOTIFICATION_EMAIL;
  const emailFrom = process.env.EMAIL_FROM || "Let's Grab a Meal <onboarding@resend.dev>";

  if (!apiKey || apiKey === 'your_resend_api_key_here') {
    console.warn('CRON: Skipping email notification: RESEND_API_KEY is not configured.');
    return;
  }

  if (!notificationEmail || notificationEmail === 'your_email@example.com') {
    console.warn('CRON: Skipping email notification: NOTIFICATION_EMAIL is not configured or using default.');
    return;
  }

  const { overdue, birthdays } = await getNotificationData();

  console.log(`CRON: Found ${overdue.length} overdue contacts and ${birthdays.length} birthdays. Sending daily summary.`);

  const html = buildDigestEmail({
    overdue,
    birthdays,
  });

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [notificationEmail],
        subject: `Let's Grab a Meal: ${overdue.length + birthdays.length} Reminders for Today`,
        html,
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('CRON: Resend error:', data);
      return {
        sent: false,
        resendError: data,
        overdueCount: overdue.length,
        birthdayCount: birthdays.length,
      };
    }

    console.log('CRON: Email sent successfully:', data.id);
    return {
      sent: true,
      emailId: data.id,
      overdueCount: overdue.length,
      birthdayCount: birthdays.length,
    };
  } catch (err) {
    console.error('CRON: Error sending email:', err);
    return {
      sent: false,
      sendError: err?.message || 'Unknown email send error.',
      overdueCount: overdue.length,
      birthdayCount: birthdays.length,
    };
  }
}

app.post('/api/test-notify', async (req, res) => {
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_TEST_NOTIFY !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }

  const result = await sendNotificationEmails();
  res.json({
    message: 'Notification check triggered.',
    ...result,
  });
});

app.use('/api', (err, req, res, next) => {
  console.error('Local API error:', err);
  if (res.headersSent) return next(err);
  return res.status(err?.type === 'entity.too.large' ? 413 : 400).json({
    error: err?.type === 'entity.too.large' ? 'Request body is too large' : 'Invalid request',
  });
});

// Serve static files for hosting
app.use(express.static(path.join(__dirname, '../client/dist')));
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const server = app.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}`);
});

server.on('error', (err) => {
  console.error(`Server failed to listen on ${host}:${port}:`, err);
  process.exit(1);
});

server.ref();
