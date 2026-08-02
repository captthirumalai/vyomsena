import {
  getCompany,
  listCompanyAccounts,
  createCompanyAccount,
  listCompanyInvites,
  generateCompanyInvite
} from '../../services/companyService.js';

const ROLE_LABELS = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  OPERATIONS: 'Operations',
  PILOT: 'Pilot',
  MEMBER: 'Member'
};

function query(selector) {
  return document.querySelector(selector);
}

function escapeHtml(value) {
  return `${value ?? ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toDateValue(value) {
  const raw = value?.toDate ? value.toDate() : value;
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function formatShortDateTime(value) {
  const date = toDateValue(value);
  if (!date) return '—';
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

function getInviteStatus(invite) {
  if (invite.usedBy) return { label: 'Used', tone: 'green' };
  const expiresAt = toDateValue(invite.expiresAt);
  if (!expiresAt || expiresAt.getTime() <= Date.now()) return { label: 'Expired', tone: 'red' };
  return { label: 'Active', tone: 'blue' };
}

function roleLabel(role) {
  return ROLE_LABELS[`${role || ''}`.trim().toUpperCase()] || role || 'Member';
}

function renderCompanyInfo(company) {
  if (!company) return;
  query('#st-company-name').textContent = company.name || '—';
  query('#st-company-base').textContent = company.base || '—';
  query('#st-company-code').textContent = company.code || '—';
  query('#st-company-owner').textContent = company.ownerEmail || '—';
}

function renderAccounts(accounts) {
  const body = query('#st-accounts-body');
  if (!body) return;

  if (!accounts.length) {
    body.innerHTML = '<tr><td colspan="4" class="st-empty">No accounts yet. Invite the first user.</td></tr>';
    return;
  }

  body.innerHTML = accounts
    .map((account) => {
      const statusTone = `${account.status || 'ACTIVE'}`.toUpperCase() === 'ACTIVE' ? 'green' : 'red';
      return `<tr>
        <td>${escapeHtml(account.displayName || '—')}</td>
        <td>${escapeHtml(account.email || '—')}</td>
        <td>${escapeHtml(roleLabel(account.role))}</td>
        <td><span class="st-badge st-badge-${statusTone}">${escapeHtml(account.status || 'ACTIVE')}</span></td>
      </tr>`;
    })
    .join('');
}

function renderInvites(invites) {
  const body = query('#st-invites-body');
  if (!body) return;

  if (!invites.length) {
    body.innerHTML = '<tr><td colspan="5" class="st-empty">No invites generated yet.</td></tr>';
    return;
  }

  body.innerHTML = invites
    .map((invite) => {
      const status = getInviteStatus(invite);
      return `<tr>
        <td><strong>${escapeHtml(invite.code)}</strong></td>
        <td>${escapeHtml(invite.email || '—')}</td>
        <td>${escapeHtml(roleLabel(invite.role))}</td>
        <td>${escapeHtml(formatShortDateTime(invite.expiresAt))}</td>
        <td><span class="st-badge st-badge-${status.tone}">${status.label}</span></td>
      </tr>`;
    })
    .join('');
}

function setButtonState(button, loading) {
  if (!button) return;
  button.disabled = loading;
  button.querySelector('.st-btn-spinner')?.classList.toggle('hidden', !loading);
}

function setStatus(element, message, tone = '') {
  if (!element) return;
  element.textContent = message;
  element.classList.remove('is-success', 'is-error');
  if (tone) element.classList.add(`is-${tone}`);
}

export async function init(view, context) {
  const currentUser = context?.currentUser;
  const companyId = currentUser?.uid || null;

  if (!companyId) {
    const content = view.querySelector('#st-company-name');
    if (content) content.textContent = 'No operator workspace found.';
    return { destroy() {} };
  }

  let company = null;
  let accounts = [];
  let invites = [];
  let lastInvite = null;

  async function loadAll() {
    const [companyResult, accountsResult, invitesResult] = await Promise.all([
      getCompany(companyId),
      listCompanyAccounts(companyId),
      listCompanyInvites(companyId)
    ]);
    company = companyResult;
    accounts = accountsResult;
    invites = invitesResult;
    renderCompanyInfo(company);
    renderAccounts(accounts);
    renderInvites(invites);
  }

  const form = query('#st-invite-form');
  const submit = query('#st-invite-submit');
  const statusEl = query('#st-invite-status');
  const resultEl = query('#st-invite-result');
  const codeEl = query('#st-invite-code');

  function showInvite(invite) {
    lastInvite = invite;
    if (!codeEl) return;
    codeEl.textContent = invite.code;
    resultEl?.classList.remove('hidden');
  }

  async function handleInviteSubmit(event) {
    event.preventDefault();
    if (!(form instanceof HTMLFormElement)) return;

    const displayName = form.displayName?.value?.trim();
    const email = form.email?.value?.trim().toLowerCase();
    const role = form.role?.value || 'PILOT';

    if (!displayName || !email) {
      setStatus(statusEl, 'Display name and email are required.', 'error');
      return;
    }

    setButtonState(submit, true);
    setStatus(statusEl, 'Creating account and generating invite...');

    try {
      const account = await createCompanyAccount({ companyId, role, displayName, email });
      const invite = await generateCompanyInvite({ companyId, accountId: account.accountId, email, role });
      form.reset();
      showInvite(invite);
      setStatus(statusEl, 'Invite ready.', 'success');
      await loadAll();
    } catch (error) {
      console.error('Invite generation failed:', error);
      setStatus(statusEl, error.message || 'Unable to generate invite.', 'error');
    } finally {
      setButtonState(submit, false);
    }
  }

  form?.addEventListener('submit', handleInviteSubmit);

  const companyName = () => company?.name || 'VyomSena';

  function shareMessage() {
    if (!lastInvite) return '';
    return `Join ${companyName()} on VyomSena. Your invite code is ${lastInvite.code}. It expires in 5 minutes and can be used once.`;
  }

  query('#st-invite-copy')?.addEventListener('click', async () => {
    if (!lastInvite) return;
    try {
      await navigator.clipboard.writeText(lastInvite.code);
      setStatus(statusEl, 'Code copied to clipboard.', 'success');
    } catch (error) {
      setStatus(statusEl, 'Copy failed. Select and copy the code manually.', 'error');
    }
  });

  query('#st-share-whatsapp')?.addEventListener('click', () => {
    if (!lastInvite) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(shareMessage())}`, '_blank', 'noopener');
  });

  query('#st-share-sms')?.addEventListener('click', () => {
    if (!lastInvite) return;
    window.location.href = `sms:?body=${encodeURIComponent(shareMessage())}`;
  });

  query('#st-share-email')?.addEventListener('click', () => {
    if (!lastInvite) return;
    const subject = `Join ${companyName()} on VyomSena`;
    window.location.href = `mailto:${encodeURIComponent(lastInvite.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(shareMessage())}`;
  });

  query('#st-share-close')?.addEventListener('click', () => {
    resultEl?.classList.add('hidden');
  });

  try {
    await loadAll();
  } catch (error) {
    console.error('Company workspace load failed:', error);
    renderCompanyInfo(null);
    renderAccounts([]);
    renderInvites([]);
  }

  return {
    destroy() {
      // No long-lived listeners in this module.
    }
  };
}
