/**
 * Outbound mail. Nodemailer over any SMTP server (Gmail app password,
 * SendGrid, your own host). No vendor SDKs, no per-message cost beyond
 * what your SMTP provider charges (Gmail: free, 500/day).
 */

const nodemailer = require('nodemailer');

function escapeHtml(value) {
  return `${value ?? ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildTransport(smtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined
  });
}

function formatExpiryDate(value) {
  const raw = typeof value?.toDate === 'function' ? value.toDate() : value;
  const parsed = raw instanceof Date ? raw : new Date(raw);
  if (!parsed || Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function docLine(item) {
  if (item.tier === 'expired') {
    return `${item.documentName} expired on ${formatExpiryDate(item.expiryDate)}`;
  }
  const days = item.days === 0 ? 'today' : `in ${item.days} day(s)`;
  return `${item.documentName} expires ${days} (${formatExpiryDate(item.expiryDate)})`;
}

function pilotText({ pilotName, companyName, items }) {
  const lines = items.map((item) => `• ${docLine(item)}`).join('\n');
  return [
    `Dear ${pilotName},`,
    '',
    `This is an automatic licence/document expiry reminder from ${companyName} (VyomSena).`,
    '',
    lines,
    '',
    'Please renew the above before expiry and share the updated document with your operations team.',
    '',
    '— Operations, ' + companyName
  ].join('\n');
}

function pilotHtml({ pilotName, companyName, items }) {
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const expiredCount = items.filter((item) => item.tier === 'expired').length;
  const expiringCount = items.length - expiredCount;

  const sorted = items.slice().sort((left, right) => left.expiryMs - right.expiryMs);
  const rows = sorted
    .map((item) => {
      const expired = item.tier === 'expired';
      const tierNote = expired ? 'expired notice' : `${item.tier}-day tier`;
      return `<tr>`
        + `<td style="padding:8px 10px;border-bottom:1px solid #eef2f7;">${escapeHtml(item.documentName)}<br />`
        + `<span style="font-size:12px;color:#64748b;">${escapeHtml(tierNote)}${item.licenseOrCertificateNumber ? ` · ${escapeHtml(item.licenseOrCertificateNumber)}` : ''}</span></td>`
        + `<td style="padding:8px 10px;border-bottom:1px solid #eef2f7;white-space:nowrap;">${escapeHtml(formatExpiryDate(item.expiryDate))}<br />`
        + `<span style="font-size:12px;color:#64748b;">${escapeHtml(digestRelLabel(item))}</span></td>`
        + `<td style="padding:8px 10px;border-bottom:1px solid #eef2f7;text-align:center;">${pillHtml(expired ? 'Expired' : 'Expiring', expired ? 'critical' : 'watch')}</td>`
        + `</tr>`;
    })
    .join('');

  const kpiCell = (value, label) => `<td style="padding:10px;border:1px solid #e2e8f0;border-radius:8px;text-align:center;background:#f8fafc;" width="50%">`
    + `<div style="font-size:22px;font-weight:800;">${value}</div>`
    + `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;">${label}</div></td>`;

  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#eef4fb;padding:24px;color:#1f2937;">`
    + `<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">`
    + `<div style="background:#1d4ed8;color:#ffffff;padding:18px 24px;">`
    + `<div style="font-size:18px;font-weight:700;">VyomSena — Document Expiry Reminder</div>`
    + `<div style="font-size:13px;opacity:0.85;">${escapeHtml(companyName)} · ${escapeHtml(today)}</div>`
    + `</div>`
    + `<div style="padding:20px 24px;">`
    + `<p style="margin:0 0 16px;">Dear ${escapeHtml(pilotName)}, this is an automatic reminder that the following need your attention.</p>`
    + `<table role="presentation" cellpadding="0" cellspacing="8" width="100%" style="border-collapse:separate;margin:0 0 20px;"><tr>`
    + kpiCell(String(expiringCount), 'Docs expiring')
    + kpiCell(String(expiredCount), 'Docs expired')
    + `</tr></table>`
    + `<h3 style="margin:0 0 8px;font-size:15px;">Your document watchlist</h3>`
    + `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 16px;">`
    + `<tr>`
    + `<th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;border-bottom:2px solid #e2e8f0;background:#f8fafc;">Document</th>`
    + `<th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;border-bottom:2px solid #e2e8f0;background:#f8fafc;">Expiry</th>`
    + `<th style="text-align:center;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;border-bottom:2px solid #e2e8f0;background:#f8fafc;">Status</th>`
    + `</tr>`
    + rows
    + `</table>`
    + `<p style="margin:0 0 8px;">Please renew the above before expiry and share the updated document with your operations team.</p>`
    + `<p style="font-size:12px;color:#64748b;margin:0;">— Operations, ${escapeHtml(companyName)}</p>`
    + `</div>`
    + `</div>`
    + `</div>`;
}

function opsText({ companyName, groups }) {
  const lines = groups
    .map((group) => `${group.pilotName} <${group.pilotEmail || 'no email'}>:\n${group.items.map((item) => `  • ${docLine(item)}`).join('\n')}`)
    .join('\n\n');
  return [
    `VyomSena daily expiry digest for ${companyName}.`,
    '',
    lines || 'No documents in a reminder window today.',
    '',
    'Reminder rules: pilots are mailed per tier — daily when urgent (7 days or less), weekly otherwise; expired documents repeat weekly.'
  ].join('\n');
}

async function sendPilotReminder(transport, { from, to, companyName, pilotName, items }) {
  const subject = `Action needed: ${items.length} document(s) expiring — ${pilotName} (${companyName})`;
  const text = pilotText({ pilotName, companyName, items });
  const html = pilotHtml({ pilotName, companyName, items });
  return transport.sendMail({ from, to, subject, text, html });
}

async function sendOpsDigest(transport, { from, to, companyName, groups }) {
  const subject = `VyomSena expiry digest: ${groups.length} pilot(s) with documents in window — ${companyName}`;
  const text = opsText({ companyName, groups });
  const html = opsDigestHtml({ companyName, groups });
  return transport.sendMail({ from, to, subject, text, html });
}

// Email-safe solid palette mirroring the dashboard status pills.
const PILL_TONES = {
  critical: { bg: '#FEE2E2', border: '#FCA5A5', text: '#991B1B' },
  watch: { bg: '#FEF3C7', border: '#FCD34D', text: '#92400E' },
  good: { bg: '#D1FAE5', border: '#A7F3D0', text: '#065F46' },
  neutral: { bg: '#F1F5F9', border: '#CBD5E1', text: '#334155' }
};

function pillHtml(content, tone) {
  const palette = PILL_TONES[tone] || PILL_TONES.neutral;
  return `<span style="display:inline-block;padding:2px 10px;border-radius:999px;`
    + `font-size:12px;font-weight:700;white-space:nowrap;`
    + `background:${palette.bg};color:${palette.text};border:1px solid ${palette.border};">${content}</span>`;
}

function digestRelLabel(item) {
  if (item.tier === 'expired') return `${Math.abs(item.days)}d ago`;
  if (item.days === 0) return 'today';
  return `in ${item.days}d`;
}

function opsDigestHtml({ companyName, groups }) {
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  // Crew risk matrix rows (same ranking as the dashboard: expired, expiring, earliest).
  const riskRows = groups
    .map((group) => {
      const expired = group.items.filter((item) => item.tier === 'expired').length;
      const expiring = group.items.length - expired;
      const earliest = group.items.reduce((min, item) => Math.min(min, item.expiryMs), Number.MAX_SAFE_INTEGER);
      return { group, expired, expiring, earliest };
    })
    .sort((left, right) => {
      if (left.expired !== right.expired) return right.expired - left.expired;
      if (left.expiring !== right.expiring) return right.expiring - left.expiring;
      return left.earliest - right.earliest;
    });

  const totalExpiring = riskRows.reduce((sum, row) => sum + row.expiring, 0);
  const totalExpired = riskRows.reduce((sum, row) => sum + row.expired, 0);

  const riskBody = riskRows
    .map((row) => {
      const tone = row.expired > 0 ? 'critical' : 'watch';
      const earliestDate = new Date(row.earliest).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      const mailed = row.group.mailedToday === true;
      return `<tr>`
        + `<td style="padding:8px 10px;border-bottom:1px solid #eef2f7;">${escapeHtml(row.group.pilotName)}<br />`
        + `<span style="font-size:12px;color:#64748b;">${escapeHtml(row.group.pilotEmail || '')}</span></td>`
        + `<td style="padding:8px 10px;border-bottom:1px solid #eef2f7;text-align:center;">${pillHtml(mailed ? 'Mailed' : '—', mailed ? 'good' : 'neutral')}</td>`
        + `<td style="padding:8px 10px;border-bottom:1px solid #eef2f7;text-align:center;">${pillHtml(String(row.expired), row.expired > 0 ? 'critical' : 'good')}</td>`
        + `<td style="padding:8px 10px;border-bottom:1px solid #eef2f7;text-align:center;">${pillHtml(String(row.expiring), row.expiring > 0 ? 'watch' : 'good')}</td>`
        + `<td style="padding:8px 10px;border-bottom:1px solid #eef2f7;text-align:center;">${pillHtml(escapeHtml(earliestDate), tone)}</td>`
        + `</tr>`;
    })
    .join('');

  // Document watchlist rows, earliest expiry first (same as the dashboard).
  const watchRows = groups
    .flatMap((group) => group.items.map((item) => ({ group, item })))
    .sort((left, right) => left.item.expiryMs - right.item.expiryMs)
    .map(({ group, item }) => {
      const expired = item.tier === 'expired';
      const date = formatExpiryDate(item.expiryDate);
      return `<tr>`
        + `<td style="padding:8px 10px;border-bottom:1px solid #eef2f7;">${escapeHtml(group.pilotName)}</td>`
        + `<td style="padding:8px 10px;border-bottom:1px solid #eef2f7;">${escapeHtml(item.documentName)}</td>`
        + `<td style="padding:8px 10px;border-bottom:1px solid #eef2f7;white-space:nowrap;">${escapeHtml(date)}<br />`
        + `<span style="font-size:12px;color:#64748b;">${escapeHtml(digestRelLabel(item))}</span></td>`
        + `<td style="padding:8px 10px;border-bottom:1px solid #eef2f7;text-align:center;">${pillHtml(expired ? 'Expired' : 'Expiring', expired ? 'critical' : 'watch')}</td>`
        + `</tr>`;
    })
    .join('');

  const tableHead = (cells) => `<tr>${cells
    .map((cell) => `<th style="text-align:${cell.align || 'left'};padding:8px 10px;font-size:11px;`
      + `text-transform:uppercase;letter-spacing:0.05em;color:#64748b;`
      + `border-bottom:2px solid #e2e8f0;background:#f8fafc;">${cell.label}</th>`)
    .join('')}</tr>`;

  const kpiCell = (value, label) => `<td style="padding:10px;border:1px solid #e2e8f0;border-radius:8px;text-align:center;background:#f8fafc;" width="33%">`
    + `<div style="font-size:22px;font-weight:800;">${value}</div>`
    + `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;">${label}</div></td>`;

  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#eef4fb;padding:24px;color:#1f2937;">`
    + `<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">`
    + `<div style="background:#1d4ed8;color:#ffffff;padding:18px 24px;">`
    + `<div style="font-size:18px;font-weight:700;">VyomSena — Daily Expiry Digest</div>`
    + `<div style="font-size:13px;opacity:0.85;">${escapeHtml(companyName)} · ${escapeHtml(today)}</div>`
    + `</div>`
    + `<div style="padding:20px 24px;">`
    + `<p style="margin:0 0 16px;">Full daily watchlist of documents nearing expiry across your crew. Pilots marked mailed were also mailed individually today.</p>`
    + `<table role="presentation" cellpadding="0" cellspacing="8" width="100%" style="border-collapse:separate;margin:0 0 20px;"><tr>`
    + kpiCell(String(groups.length), 'Pilots in window')
    + kpiCell(String(totalExpiring), 'Docs expiring')
    + kpiCell(String(totalExpired), 'Docs expired')
    + `</tr></table>`
    + `<h3 style="margin:0 0 8px;font-size:15px;">Crew risk matrix</h3>`
    + `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 20px;">`
    + tableHead([{ label: 'Pilot' }, { label: 'Mailed', align: 'center' }, { label: 'Expired', align: 'center' }, { label: 'Expiring', align: 'center' }, { label: 'Earliest', align: 'center' }])
    + riskBody
    + `</table>`
    + `<h3 style="margin:0 0 8px;font-size:15px;">Document watchlist</h3>`
    + `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 16px;">`
    + tableHead([{ label: 'Pilot' }, { label: 'Document' }, { label: 'Expiry' }, { label: 'Status', align: 'center' }])
    + watchRows
    + `</table>`
    + `<p style="font-size:12px;color:#64748b;margin:0;">Reminder rules: pilots are mailed per tier — daily when urgent (7 days or less), weekly otherwise; expired documents repeat weekly. Manage this in the web app → Notification Centre.</p>`
    + `</div>`
    + `</div>`
    + `</div>`;
}

function failureText({ companyName, companySummary }) {
  const lines = (companySummary.details || []).map((detail) => `• ${detail}`).join('\n');
  return [
    `VyomSena automatic reminders hit a problem for ${companyName}.`,
    '',
    `Pilot mails sent: ${companySummary.sent || 0}. Failed sends: ${companySummary.failed || 0}.`,
    companySummary.quotaReached ? `Daily send quota was reached; remaining pilots retry on the next run.` : '',
    '',
    'Details:',
    lines || '(no details recorded)',
    '',
    'If failures repeat, check the SMTP credentials (Firebase functions secrets) and the function logs.',
    'Open the Notification Centre in the web app for the full run history.'
  ].filter((line) => line !== '').join('\n');
}

async function sendFailureAlert(transport, { from, to, companyName, companySummary }) {
  const subject = `VyomSena reminders need attention — ${companyName} (${companySummary.failed || 0} failed)`;
  const text = failureText({ companyName, companySummary });
  return transport.sendMail({ from, to, subject, text });
}

function testText({ companyName }) {
  return [
    `This is a test mail from the VyomSena expiry-reminder system for ${companyName}.`,
    '',
    '• Sample row: Medical Assessment expires in 12 days (20 Oct 2026) [30-day tier]',
    '• Sample row: Pilot Licence (Aeroplane) expired on 01 Oct 2026 [expired notice]',
    '',
    'If you received this, the mail pipeline (Cloud Function → SMTP → inbox) works.',
    'Real reminders bundle one pilot\'s pending tiers into a single mail — daily when urgent, weekly otherwise.',
    '',
    '— VyomSena'
  ].join('\n');
}

async function sendTestMail(transport, { from, to, companyName }) {
  const subject = `VyomSena test mail — reminder pipeline OK (${companyName})`;
  const text = testText({ companyName });
  const html = `<p>${escapeHtml(`This is a test mail from the VyomSena expiry-reminder system for ${companyName}.`)}</p>`
    + `<p>If you received this, the mail pipeline (Cloud Function → SMTP → inbox) works.</p>`
    + `<p>— VyomSena</p>`;
  return transport.sendMail({ from, to, subject, text, html });
}

module.exports = {
  buildTransport,
  sendPilotReminder,
  sendOpsDigest,
  sendFailureAlert,
  sendTestMail
};
