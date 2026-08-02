import { crewState } from './state.js';
import {
  query,
  queryAll,
  setText,
  CIRC,
  daysUntil,
  formatExpiry,
  escapeHtml,
  toProfileName
} from './utils.js';
import { getDocumentComplianceState } from '../../services/documentService.js';

export function renderComplianceTab() {
  const categories = {
    LICENCE: { label: 'Licence', total: 0, valid: 0 },
    MEDICAL: { label: 'Medical', total: 0, valid: 0 },
    TRAINING: { label: 'Training', total: 0, valid: 0 },
    DOCUMENT: { label: 'Documents', total: 0, valid: 0 }
  };

  let expiring30 = 0;
  let expiring60 = 0;
  let expiredCount = 0;
  const alerts = [];

  crewState.pilotsCache.forEach((pilot) => {
    const docs = crewState.docsByPilotCache.get(pilot.uid) || [];
    docs.forEach((doc) => {
      const category = `${doc.documentCategory || 'GENERAL'}`.toUpperCase();
      const group = categories[category] ? category : 'DOCUMENT';
      categories[group].total += 1;
      const state = getDocumentComplianceState(doc);
      if (state === 'Valid') categories[group].valid += 1;

      const days = daysUntil(doc.expiryDate);
      if (days === null) return;
      if (days < 0) {
        expiredCount += 1;
        alerts.push({ pilot: pilot, doc, days, state: 'Expired' });
      } else if (days < 30) {
        expiring30 += 1;
        alerts.push({ pilot: pilot, doc, days, state: 'Expiring' });
      } else if (days < 60) {
        expiring60 += 1;
      }
    });
  });

  queryAll('.cm-comp-card').forEach((card) => {
    const compType = card.dataset.compType;
    const group = categories[compType] || { total: 0, valid: 0 };
    const percent = group.total ? Math.round((group.valid / group.total) * 100) : 0;
    const bar = card.querySelector('.cm-ring-bar');
    const strong = card.querySelector('strong');
    const detail = card.querySelector(`#cm-comp-${compType.toLowerCase()}-detail`);

    if (bar) {
      const circumference = CIRC(52);
      bar.style.strokeDasharray = `${circumference.toFixed(2)}`;
      bar.style.strokeDashoffset = `${(circumference * (1 - percent / 100)).toFixed(2)}`;
      bar.classList.toggle('is-amber', percent < 100 && percent >= 60);
      bar.classList.toggle('is-red', percent < 60);
    }
    if (strong) strong.textContent = `${percent}%`;
    if (detail) detail.textContent = `${group.valid} of ${group.total} valid`;
  });

  const totalDocs = Object.values(categories).reduce((sum, group) => sum + group.total, 0);
  setText('#cm-comp-window-30', `${expiring30}`);
  setText('#cm-comp-window-60', `${expiring60}`);
  setText('#cm-comp-window-expired', `${expiredCount}`);
  if (totalDocs) {
    const bar30 = query('#cm-comp-bar-30');
    const bar60 = query('#cm-comp-bar-60');
    const barExp = query('#cm-comp-bar-expired');
    if (bar30) bar30.style.width = `${Math.min(100, (expiring30 / totalDocs) * 100)}%`;
    if (bar60) bar60.style.width = `${Math.min(100, (expiring60 / totalDocs) * 100)}%`;
    if (barExp) barExp.style.width = `${Math.min(100, (expiredCount / totalDocs) * 100)}%`;
  }

  const alertsEl = query('#cm-comp-alerts');
  if (alertsEl) {
    if (!alerts.length) {
      alertsEl.innerHTML = '<li class="cm-form-status" style="margin:0">No compliance alerts. All documents are in good standing.</li>';
    } else {
      alertsEl.innerHTML = alerts
        .sort((a, b) => a.days - b.days)
        .slice(0, 8)
        .map((alert) => {
          const isExpired = alert.state === 'Expired';
          return `<li class="cm-alert-item">
            <span class="cm-alert-dot ${isExpired ? 'is-red' : 'is-amber'}"></span>
            <span class="cm-alert-text">
              <strong>${escapeHtml(toProfileName(alert.pilot))} — ${escapeHtml(alert.doc.documentName || 'Document')}</strong>
              <span>${isExpired ? 'Expired' : 'Expiring'} ${escapeHtml(alert.doc.expiryDate ? formatExpiry(alert.doc.expiryDate).rel : '')}</span>
            </span>
          </li>`;
        })
        .join('');
    }
  }
}
