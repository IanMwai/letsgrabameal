import { createRemoteJWKSet, jwtVerify } from 'jose';

const DEFAULT_TIMEZONE = 'America/New_York';
const MAX_JSON_BODY_BYTES = 16 * 1024;
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let response;

    if (url.pathname === '/health') {
      response = new Response('OK', { status: 200 });
    } else if (url.pathname.startsWith('/api/')) {
      response = await authorizeApiRequest(request, env);
      if (!response) {
        response = await handleApiRequest(request, env);
      }
    } else {
      response = await env.ASSETS.fetch(request);
    }

    return withSecurityHeaders(response, url.pathname.startsWith('/api/'));
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledDigest(controller, env));
  },
};

async function handleApiRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  try {
    enforceSameOrigin(request, url);

    if (pathname === '/api/contacts' && request.method === 'GET') {
      return jsonResponse(await getContactsWithDaysSince(env));
    }

    if (pathname === '/api/contacts' && request.method === 'POST') {
      return createContact(request, env);
    }

    if (pathname === '/api/notify-check' && request.method === 'GET') {
      const contacts = await getContactsWithDaysSince(env);
      return jsonResponse({
        overdue: contacts.filter((contact) => contact.days_since_contact >= contact.frequency_days),
        birthdays: getContactsWithBirthdaysToday(contacts, getTimezone(env)),
      });
    }

    if (pathname === '/api/test-notify' && request.method === 'POST') {
      const result = await sendNotificationEmails(env);
      return jsonResponse({
        message: 'Notification check triggered.',
        ...result,
      });
    }

    const contactMatch = pathname.match(/^\/api\/contacts\/(\d+)$/);
    if (contactMatch && request.method === 'GET') {
      return getContactDetails(contactMatch[1], env);
    }

    if (contactMatch && request.method === 'PUT') {
      return updateContact(contactMatch[1], request, env);
    }

    if (contactMatch && request.method === 'DELETE') {
      await dbRun(env, 'DELETE FROM contacts WHERE id = ?', Number(contactMatch[1]));
      return new Response(null, { status: 204 });
    }

    if (pathname === '/api/interactions' && request.method === 'POST') {
      return createInteraction(request, env);
    }

    const interactionMatch = pathname.match(/^\/api\/interactions\/(\d+)$/);
    if (interactionMatch && request.method === 'PUT') {
      return updateInteraction(interactionMatch[1], request, env);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (error) {
    console.error('API error:', error);
    if (error instanceof ApiError) {
      return jsonResponse({ error: error.message }, error.status);
    }

    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

async function createContact(request, env) {
  const payload = validateContact(await readJson(request));
  const result = await dbRun(
    env,
    `
      INSERT INTO contacts (
        first_name,
        last_name,
        birthday,
        frequency_days,
        tags,
        preferred_contact_method,
        preferred_meeting_method
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    payload.first_name,
    payload.last_name,
    payload.birthday,
    payload.frequency_days,
    payload.tags,
    payload.preferred_contact_method,
    payload.preferred_meeting_method,
  );

  return jsonResponse({ id: result.meta?.last_row_id });
}

async function updateContact(id, request, env) {
  const payload = validateContact(await readJson(request));
  await dbRun(
    env,
    `
      UPDATE contacts SET
        first_name = ?,
        last_name = ?,
        birthday = ?,
        frequency_days = ?,
        tags = ?,
        preferred_contact_method = ?,
        preferred_meeting_method = ?
      WHERE id = ?
    `,
    payload.first_name,
    payload.last_name,
    payload.birthday,
    payload.frequency_days,
    payload.tags,
    payload.preferred_contact_method,
    payload.preferred_meeting_method,
    Number(id),
  );

  return new Response(null, { status: 200 });
}

async function getContactDetails(id, env) {
  const contact = await dbFirst(env, 'SELECT * FROM contacts WHERE id = ?', Number(id));

  if (!contact) {
    return jsonResponse({ error: 'Contact not found' }, 404);
  }

  const interactions = await dbAll(
    env,
    'SELECT * FROM interactions WHERE contact_id = ? ORDER BY date DESC',
    Number(id),
  );

  return jsonResponse({ ...contact, interactions });
}

async function createInteraction(request, env) {
  const payload = validateInteraction(await readJson(request), true);
  const contact = await dbFirst(env, 'SELECT id FROM contacts WHERE id = ?', payload.contact_id);

  if (!contact) {
    throw new ApiError(404, 'Contact not found');
  }

  const result = await dbRun(
    env,
    'INSERT INTO interactions (contact_id, type, date, notes) VALUES (?, ?, ?, ?)',
    payload.contact_id,
    payload.type,
    payload.date,
    payload.notes || '',
  );

  await syncContactLastInteraction(env, Number(payload.contact_id));
  return jsonResponse({ id: result.meta?.last_row_id }, 201);
}

async function updateInteraction(id, request, env) {
  const payload = validateInteraction(await readJson(request), false);
  const existing = await dbFirst(
    env,
    'SELECT contact_id FROM interactions WHERE id = ?',
    Number(id),
  );

  if (!existing) {
    return jsonResponse({ error: 'Interaction not found' }, 404);
  }

  await dbRun(
    env,
    'UPDATE interactions SET type = ?, date = ?, notes = ? WHERE id = ?',
    payload.type,
    payload.date,
    payload.notes || '',
    Number(id),
  );

  await syncContactLastInteraction(env, existing.contact_id);
  return new Response(null, { status: 200 });
}

async function syncContactLastInteraction(env, contactId) {
  const latestInteraction = await dbFirst(
    env,
    'SELECT date FROM interactions WHERE contact_id = ? ORDER BY date DESC LIMIT 1',
    contactId,
  );

  await dbRun(
    env,
    'UPDATE contacts SET last_contact_date = ? WHERE id = ?',
    latestInteraction?.date || null,
    contactId,
  );
}

async function getContactsWithDaysSince(env) {
  const timezone = getTimezone(env);
  const todayKey = getZonedDateKey(new Date(), timezone);
  const contacts = await dbAll(env, 'SELECT * FROM contacts');

  const enrichedContacts = await Promise.all(
    contacts.map(async (contact) => {
      const referenceDateKey = getZonedDateKey(
        contact.last_contact_date || contact.created_at,
        timezone,
      );
      const latestInteraction = await dbFirst(
        env,
        'SELECT * FROM interactions WHERE contact_id = ? ORDER BY date DESC LIMIT 1',
        contact.id,
      );

      return {
        ...contact,
        days_since_contact: diffCalendarDays(todayKey, referenceDateKey),
        latestInteraction: latestInteraction || null,
      };
    }),
  );

  return enrichedContacts.sort(
    (a, b) =>
      a.frequency_days - a.days_since_contact - (b.frequency_days - b.days_since_contact),
  );
}

function getContactsWithBirthdaysToday(contacts, timezone) {
  const todayMonthDay = getTodayMonthDay(timezone);
  return contacts.filter((contact) => getMonthDayFromBirthday(contact.birthday, timezone) === todayMonthDay);
}

async function getNotificationData(env) {
  const contacts = await getContactsWithDaysSince(env);
  const overdue = contacts.filter((contact) => contact.days_since_contact >= contact.frequency_days);
  const birthdays = getContactsWithBirthdaysToday(contacts, getTimezone(env));

  async function enrichContact(contact) {
    const lastInteraction = await dbFirst(
      env,
      'SELECT * FROM interactions WHERE contact_id = ? ORDER BY date DESC LIMIT 1',
      contact.id,
    );
    return { ...contact, lastInteraction };
  }

  return {
    overdue: await Promise.all(overdue.map(enrichContact)),
    birthdays: await Promise.all(birthdays.map(enrichContact)),
  };
}

async function sendNotificationEmails(env) {
  if (!env.RESEND_API_KEY || env.RESEND_API_KEY === 'your_resend_api_key_here') {
    console.warn('CRON: Skipping email notification: RESEND_API_KEY is not configured.');
    return { sent: false, skipped: true, reason: 'RESEND_API_KEY is not configured.' };
  }

  if (!env.NOTIFICATION_EMAIL || env.NOTIFICATION_EMAIL === 'your_email@example.com') {
    console.warn('CRON: Skipping email notification: NOTIFICATION_EMAIL is not configured.');
    return { sent: false, skipped: true, reason: 'NOTIFICATION_EMAIL is not configured.' };
  }

  const { overdue, birthdays } = await getNotificationData(env);
  const html = buildDigestEmail({
    overdue,
    birthdays,
    timezone: getTimezone(env),
    appUrl: env.APP_URL || 'https://letsgrabameal.workers.dev',
  });

  console.log(`CRON: Found ${overdue.length} overdue contacts and ${birthdays.length} birthdays. Sending daily summary.`);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || "Let's Grab a Meal <onboarding@resend.dev>",
        to: [env.NOTIFICATION_EMAIL],
        subject: `Let's Grab a Meal: ${overdue.length + birthdays.length} Reminders for Today`,
        html,
      }),
    });

    const responseText = await response.text();
    const data = responseText ? safeJsonParse(responseText) : null;

    if (!response.ok) {
      console.error('CRON: Resend error:', data || responseText);
      return {
        sent: false,
        resendError: data || responseText,
        overdueCount: overdue.length,
        birthdayCount: birthdays.length,
      };
    }

    console.log('CRON: Email sent successfully:', data?.id);
    return {
      sent: true,
      emailId: data?.id,
      overdueCount: overdue.length,
      birthdayCount: birthdays.length,
    };
  } catch (error) {
    console.error('CRON: Error sending email:', error);
    return {
      sent: false,
      sendError: error?.message || 'Unknown email send error.',
      overdueCount: overdue.length,
      birthdayCount: birthdays.length,
    };
  }
}

async function runScheduledDigest(controller, env) {
  const timezone = getTimezone(env);
  const scheduledDate = new Date(controller.scheduledTime || Date.now());

  if (!isLocalHour(scheduledDate, timezone, 9)) {
    console.log(`CRON: Skipping digest at ${scheduledDate.toISOString()} because it is not 9 AM in ${timezone}.`);
    return;
  }

  const runDate = getZonedDateKey(scheduledDate, timezone);
  const existingRun = await dbFirst(
    env,
    'SELECT run_date FROM notification_runs WHERE run_date = ?',
    runDate,
  );

  if (existingRun) {
    console.log(`CRON: Daily digest already sent for ${runDate}.`);
    return;
  }

  const result = await sendNotificationEmails(env);

  if (result?.sent) {
    await dbRun(
      env,
      'INSERT OR REPLACE INTO notification_runs (run_date, sent_at) VALUES (?, ?)',
      runDate,
      new Date().toISOString(),
    );
  }
}

async function dbAll(env, sql, ...params) {
  const result = await bindStatement(env.DB.prepare(sql), params).all();
  return result.results || [];
}

async function dbFirst(env, sql, ...params) {
  return bindStatement(env.DB.prepare(sql), params).first();
}

async function dbRun(env, sql, ...params) {
  return bindStatement(env.DB.prepare(sql), params).run();
}

function bindStatement(statement, params) {
  return params.length > 0 ? statement.bind(...params) : statement;
}

async function authorizeApiRequest(request, env) {
  if (!env.TEAM_DOMAIN || !env.POLICY_AUD) {
    console.error('Cloudflare Access is not configured.');
    return jsonResponse({ error: 'Service unavailable' }, 503);
  }

  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  try {
    const teamDomain = new URL(env.TEAM_DOMAIN);
    if (teamDomain.protocol !== 'https:') {
      throw new Error('TEAM_DOMAIN must use HTTPS.');
    }

    const jwks = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', teamDomain));
    await jwtVerify(token, jwks, {
      issuer: teamDomain.origin,
      audience: env.POLICY_AUD,
    });
    return null;
  } catch (error) {
    console.warn('Cloudflare Access JWT rejected:', error?.code || error?.message || 'unknown error');
    return jsonResponse({ error: 'Forbidden' }, 403);
  }
}

function enforceSameOrigin(request, url) {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) return;

  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) {
    throw new ApiError(403, 'Forbidden');
  }
}

function withSecurityHeaders(response, isApi) {
  const securedResponse = new Response(response.body, response);
  Object.entries(SECURITY_HEADERS).forEach(([name, value]) => {
    securedResponse.headers.set(name, value);
  });

  if (isApi) {
    securedResponse.headers.set('Cache-Control', 'no-store');
  }

  return securedResponse;
}

function getTimezone(env) {
  return env.TIMEZONE || DEFAULT_TIMEZONE;
}

function parseStoredDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00`);
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(value.replace(' ', 'T') + 'Z');
  }

  return new Date(value);
}

function getFormatterParts(formatter, date) {
  return formatter.formatToParts(date).reduce((parts, part) => {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
    return parts;
  }, {});
}

function getZonedDateKey(value, timezone) {
  const date = value instanceof Date ? value : parseStoredDate(value);

  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const { year, month, day } = getFormatterParts(formatter, date);

  return `${year}-${month}-${day}`;
}

function getTodayMonthDay(timezone) {
  const todayKey = getZonedDateKey(new Date(), timezone);
  return todayKey ? todayKey.slice(5, 10) : null;
}

function getMonthDayFromBirthday(value, timezone) {
  if (!value) return null;

  const dateOnlyMatch = value.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    return `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}`;
  }

  const zonedDateKey = getZonedDateKey(value, timezone);
  return zonedDateKey ? zonedDateKey.slice(5, 10) : null;
}

function diffCalendarDays(currentDateKey, previousDateKey) {
  if (!currentDateKey || !previousDateKey) return 0;

  const currentUtc = new Date(`${currentDateKey}T00:00:00Z`);
  const previousUtc = new Date(`${previousDateKey}T00:00:00Z`);

  return Math.max(0, Math.floor((currentUtc - previousUtc) / (1000 * 60 * 60 * 24)));
}

function isLocalHour(date, timezone, hour) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const { hour: formattedHour } = getFormatterParts(formatter, date);
  return Number(formattedHour) === hour;
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

function formatDigestDate(timezone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
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
      <td style="padding:16px 0; border-top:1px solid #e7e1d8;">
        ${label ? `<div style="font-size:12px; line-height:18px; font-weight:800; color:#6f9f86; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px;">${escapeHtml(label)}</div>` : ''}
        <div style="font-size:20px; line-height:26px; font-weight:800; color:#243044; margin-bottom:4px;">${escapeHtml(formatContactName(contact))}</div>
        ${detail ? `<div style="font-size:14px; line-height:22px; color:#748094; margin-bottom:10px;">${detail}</div>` : ''}
        <div style="font-size:13px; line-height:20px; font-weight:800; color:#748094; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:4px;">Last touch</div>
        <div style="font-size:15px; line-height:24px; color:#526074;">${escapeHtml(buildLastTouch(contact))}</div>
      </td>
    </tr>
  `;
}

function buildDigestEmail({ overdue, birthdays, timezone, appUrl }) {
  const totalReminders = overdue.length + birthdays.length;
  const headerPadding = totalReminders === 0 ? '28px 28px 18px 28px' : '28px 28px 10px 28px';
  const ctaPadding = totalReminders === 0 ? '8px 28px 28px 28px' : '24px 28px 28px 28px';
  const birthdayRows = birthdays.map((contact) =>
    buildContactRow(contact, {
      label: 'Birthday today',
      detail: 'Today',
    }),
  ).join('');

  const overdueRows = overdue.map((contact) =>
    buildContactRow(contact, {
      label: contact.days_since_contact > contact.frequency_days ? 'Past due' : 'Due today',
      detail: `${Math.floor(contact.days_since_contact)} day${Math.floor(contact.days_since_contact) === 1 ? '' : 's'} since last interaction · every ${contact.frequency_days} days`,
    }),
  ).join('');

  return `
    <!doctype html>
    <html lang="en">
      <body style="margin:0; padding:0; background:#f6f3ed; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color:#243044;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f3ed; padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px; background:#fffcf7; border:1px solid #e7e1d8; border-radius:18px;">
                <tr>
                  <td style="padding:${headerPadding};">
                    <div style="font-size:13px; line-height:18px; font-weight:800; color:#748094; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:10px;">Let's Grab a Meal</div>
                    <div style="font-size:30px; line-height:36px; font-weight:850; color:#243044; margin-bottom:8px;">Daily check-in</div>
                    <div style="font-size:16px; line-height:25px; color:#526074; margin-bottom:12px;">${escapeHtml(buildDigestIntro(overdue, birthdays))}</div>
                    <div style="font-size:14px; line-height:22px; color:#748094;">${escapeHtml(formatDigestDate(timezone))} · ${escapeHtml(buildDigestSummary(overdue, birthdays))}</div>
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
                    <a href="${escapeHtml(appUrl)}" style="display:inline-block; padding:11px 14px; border-radius:10px; background:#5f8d75; color:#ffffff; font-size:14px; line-height:20px; font-weight:800; text-decoration:none;">Open app</a>
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

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function requireString(value, field, maxLength, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    throw new ApiError(400, `${field} must be a string`);
  }

  const normalized = value.trim();
  if (!allowEmpty && !normalized) {
    throw new ApiError(400, `${field} is required`);
  }
  if (normalized.length > maxLength) {
    throw new ApiError(400, `${field} is too long`);
  }

  return normalized;
}

function optionalString(value, field, maxLength) {
  if (value === undefined || value === null || value === '') return '';
  return requireString(value, field, maxLength, { allowEmpty: true });
}

function validateDateOnly(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = requireString(value, 'birthday', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new ApiError(400, 'birthday must use YYYY-MM-DD');
  }

  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new ApiError(400, 'birthday must be a valid date');
  }

  return normalized;
}

function validateTags(payload) {
  const value = payload.how_i_know_them ?? payload.tags ?? [];
  if (!Array.isArray(value) && typeof value !== 'string') {
    throw new ApiError(400, 'tags must be an array or comma-separated string');
  }
  const tags = Array.isArray(value) ? value : String(value).split(',');
  if (tags.length > 20) throw new ApiError(400, 'tags contains too many values');
  return tags
    .map((tag) => requireString(tag, 'tag', 50, { allowEmpty: true }))
    .filter(Boolean)
    .join(',');
}

function validateContact(payload) {
  const frequency = Number(payload.frequency_days ?? 30);
  if (!Number.isInteger(frequency) || frequency < 1 || frequency > 3650) {
    throw new ApiError(400, 'frequency_days must be an integer between 1 and 3650');
  }

  return {
    first_name: requireString(payload.first_name, 'first_name', 100),
    last_name: optionalString(payload.last_name, 'last_name', 100),
    birthday: validateDateOnly(payload.birthday),
    frequency_days: frequency,
    tags: validateTags(payload),
    preferred_contact_method: optionalString(
      payload.preferred_contact_method || 'Texting',
      'preferred_contact_method',
      80,
    ),
    preferred_meeting_method: optionalString(
      payload.preferred_catch_up_method || payload.preferred_meeting_method || 'In-person',
      'preferred_meeting_method',
      80,
    ),
  };
}

function validateInteraction(payload, includeContactId) {
  const date = requireString(payload.date, 'date', 100);
  if (Number.isNaN(new Date(date).getTime())) {
    throw new ApiError(400, 'date must be valid');
  }

  const result = {
    type: requireString(payload.type, 'type', 50),
    date,
    notes: optionalString(payload.notes, 'notes', 2000),
  };

  if (includeContactId) {
    const contactId = Number(payload.contact_id);
    if (!Number.isInteger(contactId) || contactId < 1) {
      throw new ApiError(400, 'contact_id must be a positive integer');
    }
    result.contact_id = contactId;
  }

  return result;
}

async function readJson(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'Content-Type must be application/json');
  }

  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new ApiError(413, 'Request body is too large');
  }

  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'JSON body is required');

  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_JSON_BODY_BYTES) {
        await reader.cancel();
        throw new ApiError(413, 'Request body is too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApiError(400, 'JSON body must be an object');
    }
    return parsed;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'Invalid JSON body');
  }
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
