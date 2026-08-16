import { getAircraft, getCompanyAircraft, onCompanyAircraftSnapshot } from '../../services/aircraftService.js';
import { getCrew, onCrewSnapshot, syncCrewDocumentCache, summarizeCrewDocumentCompliance } from '../../services/crewService.js';
import { appConfig } from '../../config/app.config.js';
import { mountModuleActions, getModuleAction, setModuleSubtitle } from '../../shared/moduleHeader.js';

let aircraftUnsubscribe = null;
let crewUnsubscribe = null;
let complianceRequestToken = 0;
let warningWindowSelectCleanup = null;

const dashboardState = {
  aircraftFleet: [],
  crewList: [],
  docsByPilot: new Map(),
  compliance: {
    total: 0,
    expiring: 0,
    expired: 0
  },
  warningDays: 30,
  operatorUid: null,
  lastSyncAt: null
};

function toDateValue(value) {
  const raw = value?.toDate ? value.toDate() : value;
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function formatDate(value) {
  const date = toDateValue(value);
  return date ? date.toLocaleDateString() : 'N/A';
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = value;
}

function normalizeStatus(value) {
  return `${value || ''}`.trim().toLowerCase();
}

function getDocStatus(document, warningDays = 30) {
  const expiry = toDateValue(document.expiryDate);
  if (!expiry) return 'Valid';

  const days = (expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (days < 0) return 'Expired';
  if (days < warningDays) return 'Expiring';
  return 'Valid';
}

function getFleetMetrics(aircraftFleet) {
  const fleetTotal = aircraftFleet.length;
  const fleetOperational = aircraftFleet.filter((item) => normalizeStatus(item.status) === 'operational').length;
  const fleetAttention = Math.max(fleetTotal - fleetOperational, 0);
  return {
    fleetTotal,
    fleetOperational,
    fleetAttention
  };
}

function getComplianceRate(compliance) {
  if (!compliance.total) return 100;
  const valid = Math.max(compliance.total - compliance.expired - compliance.expiring, 0);
  return Math.round((valid / compliance.total) * 100);
}

function renderHealthBadges({ fleetAttention, compliance }) {
  const docCritical = compliance.expired;
  const docWatch = compliance.expiring;

  const fleetTone = fleetAttention > 0 ? 'watch' : 'good';
  const docsTone = docCritical > 0 ? 'critical' : docWatch > 0 ? 'watch' : 'good';
  const overallTone = docCritical > 0 ? 'critical' : (fleetAttention > 0 || docWatch > 0) ? 'watch' : 'good';

  const fleetBadge = document.getElementById('health-fleet');
  const docsBadge = document.getElementById('health-docs');
  const overallBadge = document.getElementById('health-overall');

  if (fleetBadge) {
    fleetBadge.className = `health-badge ${fleetTone}`;
    fleetBadge.textContent = fleetTone === 'good' ? 'Fleet Stable' : 'Fleet Watch';
  }

  if (docsBadge) {
    docsBadge.className = `health-badge ${docsTone}`;
    docsBadge.textContent = docsTone === 'critical' ? 'Docs Critical' : docsTone === 'watch' ? 'Docs Watch' : 'Docs Stable';
  }

  if (overallBadge) {
    overallBadge.className = `health-badge ${overallTone}`;
    overallBadge.textContent = overallTone === 'critical' ? 'Overall Critical' : overallTone === 'watch' ? 'Overall Watch' : 'Overall Stable';
  }
}

function renderAlerts({ fleetTotal, fleetOperational, fleetAttention, crewTotal, compliance, warningDays }) {
  const alerts = [];

  if (compliance.expired > 0) {
    alerts.push({ tone: 'critical', copy: `${compliance.expired} document(s) expired and require immediate action.` });
  }
  if (compliance.expiring > 0) {
    alerts.push({ tone: 'watch', copy: `${compliance.expiring} document(s) expiring within ${warningDays} days.` });
  }
  if (fleetAttention > 0) {
    alerts.push({ tone: 'watch', copy: `${fleetAttention} aircraft not operational in the active fleet.` });
  }
  if (crewTotal === 0) {
    alerts.push({ tone: 'watch', copy: 'No linked crew found. Link pilots to unlock compliance monitoring.' });
  }
  if (fleetTotal > 0 && fleetOperational === fleetTotal && compliance.expired === 0 && compliance.expiring === 0) {
    alerts.push({ tone: 'good', copy: 'All major controls healthy across fleet and crew compliance.' });
  }
  if (!alerts.length) {
    alerts.push({ tone: 'good', copy: 'Waiting for incoming operational data.' });
  }

  const list = document.getElementById('dashboard-alert-list');
  if (!list) return;
  list.innerHTML = alerts
    .slice(0, 5)
    .map(
      (alert) =>
        `<li>
          <span class="alert-tag ${alert.tone}">${alert.tone === 'critical' ? 'Critical' : alert.tone === 'watch' ? 'Watch' : 'Stable'}</span>
          <p class="alert-copy">${alert.copy}</p>
        </li>`
    )
    .join('');
}

function renderWatchlistRows(crewList, docsByPilot, warningDays) {
  const body = document.getElementById('dashboard-watchlist-body');
  if (!body) return;

  const crewMap = new Map(crewList.map((pilot) => [pilot.uid, pilot]));
  const watchlist = [];

  docsByPilot.forEach((docs, pilotUid) => {
    const pilot = crewMap.get(pilotUid);
    docs.forEach((item) => {
      const status = getDocStatus(item, warningDays);
      if (status === 'Valid') return;
      const expiry = toDateValue(item.expiryDate);
      watchlist.push({
        pilotName: pilot?.name || pilot?.displayName || pilot?.email || 'Unknown Pilot',
        documentName: item.documentName || item.documentCategory || 'Document',
        expiry,
        status
      });
    });
  });

  watchlist.sort((left, right) => {
    const leftTime = left.expiry ? left.expiry.getTime() : Number.MAX_SAFE_INTEGER;
    const rightTime = right.expiry ? right.expiry.getTime() : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime;
  });

  if (!watchlist.length) {
    body.innerHTML = '<tr><td colspan="4" class="row-muted">No expiring or expired documents.</td></tr>';
    return;
  }

  body.innerHTML = watchlist
    .slice(0, 8)
    .map((item) => {
      const tone = item.status === 'Expired' ? 'critical' : 'watch';
      return `<tr>
        <td>${item.pilotName}</td>
        <td>${item.documentName}</td>
        <td>${item.expiry ? item.expiry.toLocaleDateString() : 'N/A'}</td>
        <td><span class="status-pill ${tone}">${item.status}</span></td>
      </tr>`;
    })
    .join('');
}

function renderFleetFocusRows(aircraftFleet) {
  const body = document.getElementById('dashboard-fleet-focus-body');
  if (!body) return;

  const ranked = [...aircraftFleet]
    .sort((left, right) => {
      const leftOperational = normalizeStatus(left.status) === 'operational' ? 1 : 0;
      const rightOperational = normalizeStatus(right.status) === 'operational' ? 1 : 0;
      if (leftOperational !== rightOperational) return leftOperational - rightOperational;

      const leftInspection = toDateValue(left.nextInspection)?.getTime() || Number.MAX_SAFE_INTEGER;
      const rightInspection = toDateValue(right.nextInspection)?.getTime() || Number.MAX_SAFE_INTEGER;
      return leftInspection - rightInspection;
    })
    .slice(0, 8);

  if (!ranked.length) {
    body.innerHTML = '<tr><td colspan="4" class="row-muted">No aircraft records available.</td></tr>';
    return;
  }

  body.innerHTML = ranked
    .map((item) => {
      const isOperational = normalizeStatus(item.status) === 'operational';
      return `<tr>
        <td>${item.reg || 'N/A'}</td>
        <td>${item.type || 'Unknown'}</td>
        <td><span class="status-pill ${isOperational ? 'good' : 'watch'}">${item.status || 'Unknown'}</span></td>
        <td>${formatDate(item.nextInspection)}</td>
      </tr>`;
    })
    .join('');
}

function renderCrewRiskRows(crewList, docsByPilot, warningDays) {
  const body = document.getElementById('dashboard-crew-risk-body');
  if (!body) return;

  const rows = crewList.map((pilot) => {
    const docs = docsByPilot.get(pilot.uid) || [];
    let expired = 0;
    let expiring = 0;
    let nextCriticalDate = null;

    docs.forEach((item) => {
      const status = getDocStatus(item, warningDays);
      const expiry = toDateValue(item.expiryDate);
      if (status === 'Expired') expired += 1;
      if (status === 'Expiring') expiring += 1;
      if (status !== 'Valid' && expiry && (!nextCriticalDate || expiry.getTime() < nextCriticalDate.getTime())) {
        nextCriticalDate = expiry;
      }
    });

    return {
      pilotName: pilot.name || pilot.displayName || pilot.email || pilot.uid,
      expired,
      expiring,
      nextCriticalDate
    };
  });

  rows.sort((left, right) => {
    if (left.expired !== right.expired) return right.expired - left.expired;
    if (left.expiring !== right.expiring) return right.expiring - left.expiring;

    const leftDate = left.nextCriticalDate?.getTime() || Number.MAX_SAFE_INTEGER;
    const rightDate = right.nextCriticalDate?.getTime() || Number.MAX_SAFE_INTEGER;
    return leftDate - rightDate;
  });

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="4" class="row-muted">No linked crew available.</td></tr>';
    return;
  }

  body.innerHTML = rows
    .slice(0, 8)
    .map((item) => {
      const tone = item.expired > 0 ? 'critical' : item.expiring > 0 ? 'watch' : 'good';
      return `<tr>
        <td>${item.pilotName}</td>
        <td><span class="status-pill ${item.expired > 0 ? 'critical' : 'good'}">${item.expired}</span></td>
        <td><span class="status-pill ${item.expiring > 0 ? 'watch' : 'good'}">${item.expiring}</span></td>
        <td><span class="status-pill ${tone}">${item.nextCriticalDate ? item.nextCriticalDate.toLocaleDateString() : 'Clear'}</span></td>
      </tr>`;
    })
    .join('');
}

function renderDashboard() {
  const { fleetTotal, fleetOperational, fleetAttention } = getFleetMetrics(dashboardState.aircraftFleet);
  const crewTotal = dashboardState.crewList.length;
  const complianceRate = getComplianceRate(dashboardState.compliance);

  setText('kpi-fleet-total', String(fleetTotal));
  setText('kpi-fleet-ready', String(fleetOperational));
  setText('kpi-fleet-maint', String(fleetAttention));
  setText('kpi-crew-total', String(crewTotal));
  setText('kpi-doc-total', String(dashboardState.compliance.total));
  setText('kpi-doc-expiring', String(dashboardState.compliance.expiring));
  setText('kpi-doc-expired', String(dashboardState.compliance.expired));
  setText('kpi-compliance-rate', `${complianceRate}%`);

  setModuleSubtitle(
    `Loaded ${fleetTotal} aircraft and ${crewTotal} pilots. Fleet readiness ${fleetTotal ? Math.round((fleetOperational / fleetTotal) * 100) : 0}% with ${complianceRate}% documentation compliance using a ${dashboardState.warningDays}-day alert window.`
  );
  setText('dashboard-watchlist-hint', `Top expiry risks (${dashboardState.warningDays}-day window)`);

  const warningWindowSelect = getModuleAction('dashboard-warning-window');
  if (warningWindowSelect && warningWindowSelect.value !== String(dashboardState.warningDays)) {
    warningWindowSelect.value = String(dashboardState.warningDays);
  }
  setText(
    'dashboard-last-sync',
    dashboardState.lastSyncAt ? `Synced ${dashboardState.lastSyncAt.toLocaleTimeString()}` : 'Sync pending'
  );

  renderHealthBadges({
    fleetAttention,
    compliance: dashboardState.compliance
  });

  renderAlerts({
    fleetTotal,
    fleetOperational,
    fleetAttention,
    crewTotal,
    compliance: dashboardState.compliance,
    warningDays: dashboardState.warningDays
  });

  renderWatchlistRows(dashboardState.crewList, dashboardState.docsByPilot, dashboardState.warningDays);
  renderFleetFocusRows(dashboardState.aircraftFleet);
  renderCrewRiskRows(dashboardState.crewList, dashboardState.docsByPilot, dashboardState.warningDays);
}

function recalculateComplianceFromCachedDocuments() {
  const allDocuments = Array.from(dashboardState.docsByPilot.values()).flat();
  dashboardState.compliance = summarizeCrewDocumentCompliance(allDocuments, dashboardState.warningDays);
}

function bindDashboardControls() {
  warningWindowSelectCleanup?.();
  warningWindowSelectCleanup = null;

  const warningWindowSelect = getModuleAction('dashboard-warning-window');
  if (!warningWindowSelect) return;

  warningWindowSelect.value = String(dashboardState.warningDays);
  const onWarningWindowChange = () => {
    const nextWindow = Number(warningWindowSelect.value);
    dashboardState.warningDays = Number.isFinite(nextWindow) && nextWindow > 0 ? nextWindow : 30;
    recalculateComplianceFromCachedDocuments();
    dashboardState.lastSyncAt = new Date();
    renderDashboard();
  };

  warningWindowSelect.addEventListener('change', onWarningWindowChange);
  warningWindowSelectCleanup = () => warningWindowSelect.removeEventListener('change', onWarningWindowChange);
}

async function refreshComplianceDocuments() {
  const token = ++complianceRequestToken;
  const crewList = dashboardState.crewList.filter((pilot) => Boolean(pilot.uid));

  if (!crewList.length) {
    dashboardState.docsByPilot = new Map();
    dashboardState.compliance = { total: 0, expiring: 0, expired: 0 };
    renderDashboard();
    return;
  }

  const docsByPilot = await syncCrewDocumentCache(dashboardState.docsByPilot, crewList);
  if (token !== complianceRequestToken) return;

  const allDocuments = Array.from(docsByPilot.values()).flat();
  dashboardState.docsByPilot = docsByPilot;
  dashboardState.compliance = summarizeCrewDocumentCompliance(allDocuments, dashboardState.warningDays);
  dashboardState.lastSyncAt = new Date();
  renderDashboard();
}

export async function init(view, context) {
  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'Live Dashboard';
  }

  setText('dashboard-release-chip', `Build: ${appConfig.releaseVersion || 'V2.x'}`);

  mountModuleActions(`
    <span id="dashboard-last-sync" class="vs-page-chip">Syncing...</span>
    <label class="dashboard-controls" for="dashboard-warning-window">
      <span>Alert Window</span>
      <select id="dashboard-warning-window" aria-label="Select compliance alert window">
        <option value="15">15 days</option>
        <option value="30" selected>30 days</option>
        <option value="45">45 days</option>
        <option value="60">60 days</option>
      </select>
    </label>
    <div class="dashboard-quick-links">
      <a href="#/crew" class="vs-button vs-button--ghost vs-button--sm">Crew</a>
      <a href="#/fdtl" class="vs-button vs-button--ghost vs-button--sm">FDTL</a>
      <a href="#/reports" class="vs-button vs-button--ghost vs-button--sm">Reports</a>
    </div>
  `);

  const cards = view.querySelectorAll('.card');
  cards.forEach((card, index) => {
    card.dataset.module = 'dashboard';
    card.setAttribute('data-index', index + 1);
  });

  dashboardState.operatorUid = context?.currentUser?.uid || null;
  bindDashboardControls();

  if (!dashboardState.operatorUid) {
    setModuleSubtitle('No authorized operator available for this dashboard view.');
    setText('dashboard-last-sync', 'Authorization required');
    return {
      destroy() {
        aircraftUnsubscribe?.();
        crewUnsubscribe?.();
      }
    };
  }

  const [companyAircraft, initialCrew] = await Promise.all([
    getCompanyAircraft(dashboardState.operatorUid),
    getCrew(dashboardState.operatorUid)
  ]);

  dashboardState.aircraftFleet = companyAircraft.length ? companyAircraft : await getAircraft();
  dashboardState.crewList = initialCrew;
  dashboardState.lastSyncAt = new Date();
  renderDashboard();
  await refreshComplianceDocuments();

  aircraftUnsubscribe = onCompanyAircraftSnapshot(
    dashboardState.operatorUid,
    (fleet) => {
      if (fleet.length > 0) dashboardState.aircraftFleet = fleet;
      dashboardState.lastSyncAt = new Date();
      renderDashboard();
    },
    (error) => console.error('Aircraft snapshot error:', error)
  );

  crewUnsubscribe = onCrewSnapshot(
    dashboardState.operatorUid,
    async (snapshot) => {
      dashboardState.crewList = snapshot.map((item) => ({ uid: item.uid || item.crewProfileId, ...item }));
      dashboardState.lastSyncAt = new Date();
      renderDashboard();
      await refreshComplianceDocuments();
    },
    (error) => console.error('Crew snapshot error:', error)
  );

  return {
    destroy() {
      aircraftUnsubscribe?.();
      crewUnsubscribe?.();
      complianceRequestToken += 1;
      warningWindowSelectCleanup?.();
      warningWindowSelectCleanup = null;
      console.log('Dashboard module destroyed');
    }
  };
}
