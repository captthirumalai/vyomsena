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
  const rows = items
    .map((item) => {
      const tone = item.tier === 'expired' ? '#b42318' : '#b54708';
      return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(item.documentName)}</td>`
        + `<td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(formatExpiryDate(item.expiryDate))}</td>`
        + `<td style="padding:6px 10px;border-bottom:1px solid #eee;color:${tone};font-weight:600;">${escapeHtml(docLine(item))}</td></tr>`;
    })
    .join('');
  return `<p>Dear ${escapeHtml(pilotName)},</p>`
    + `<p>This is an automatic licence/document expiry reminder from <strong>${escapeHtml(companyName)}</strong> (VyomSena).</p>`
    + `<table style="border-collapse:collapse;min-width:280px;"><tbody>${rows}</tbody></table>`
    + `<p>Please renew the above before expiry and share the updated document with your operations team.</p>`
    + `<p>— Operations, ${escapeHtml(companyName)}</p>`;
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
    'Reminder rules: one mail per pilot per escalation tier; expired documents get one expiry notice.'
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
  return transport.sendMail({ from, to, subject, text });
}

module.exports = {
  buildTransport,
  sendPilotReminder,
  sendOpsDigest
};
