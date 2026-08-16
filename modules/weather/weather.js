import { getAircraft, getCompanyAircraft, onCompanyAircraftSnapshot } from '../../services/aircraftService.js';
import { getCrew, onCrewSnapshot, getCrewDocumentsByPilots, syncCrewDocumentCache, summarizeCrewDocumentCompliance } from '../../services/crewService.js';
import { mountModuleActions, getModuleAction } from '../../shared/moduleHeader.js';

let aircraftUnsubscribe = null;
let crewUnsubscribe = null;
let latestAircraft = [];
let latestCrew = [];
let latestDocsByPilot = new Map();
let activeView = null;
let activeOperatorUid = null;

function escapeHtml(value) {
  return `${value || ''}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resolveRiskLevel(score) {
  if (score >= 70) return 'RED';
  if (score >= 35) return 'AMBER';
  return 'GREEN';
}

async function renderWeather() {
  if (!activeView) return;

  const watchlistBody = activeView.querySelector('#weather-watchlist-body');
  const statusLabel = getModuleAction('weather-status');
  if (!watchlistBody || !statusLabel) return;

  const docsByPilot = latestDocsByPilot;

  const nonOperationalAircraft = latestAircraft.filter((item) => `${item.status || ''}`.toLowerCase() !== 'operational');
  const crewConstraints = latestCrew
    .map((pilot) => {
      const docs = docsByPilot.get(pilot.uid) || [];
      const compliance = summarizeCrewDocumentCompliance(docs);
      const status = compliance.expired > 0 ? 'Expired' : compliance.expiring > 0 ? 'Expiring' : 'Valid';
      return {
        pilot,
        status,
        issueCount: compliance.expired + compliance.expiring
      };
    })
    .filter((item) => item.status !== 'Valid');

  const baseVolume = Math.max(1, latestAircraft.length + latestCrew.length);
  const impactPoints = nonOperationalAircraft.length * 12 + crewConstraints.length * 8;
  const riskScore = Math.min(100, Math.round((impactPoints / baseVolume) * 10));
  const readinessScore = Math.max(0, 100 - riskScore);
  const riskLevel = resolveRiskLevel(riskScore);

  activeView.querySelector('#weather-risk-level').textContent = riskLevel;
  activeView.querySelector('#weather-maintenance-impact').textContent = `${nonOperationalAircraft.length}`;
  activeView.querySelector('#weather-crew-impact').textContent = `${crewConstraints.length}`;
  activeView.querySelector('#weather-ready-score').textContent = `${readinessScore}%`;

  statusLabel.textContent = `Live posture for operator ${activeOperatorUid}: ${nonOperationalAircraft.length} aircraft and ${crewConstraints.length} crew constraints currently affecting weather resiliency.`;

  const rows = [];
  nonOperationalAircraft.forEach((item) => {
    rows.push({
      category: 'Aircraft',
      reference: item.reg || 'Unknown',
      impact: 'Reduced dispatch flexibility under adverse weather',
      level: `${item.status || 'Unknown'}`
    });
  });

  crewConstraints.forEach((entry) => {
    rows.push({
      category: 'Crew',
      reference: entry.pilot.name || entry.pilot.email || entry.pilot.uid,
      impact: entry.status === 'Expired' ? 'No-go until document renewal' : 'Nearing currency threshold',
      level: entry.status
    });
  });

  if (!rows.length) {
    watchlistBody.innerHTML = '<tr><td colspan="4">No active constraints. Weather posture is resilient.</td></tr>';
    return;
  }

  watchlistBody.innerHTML = rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.category)}</td>
        <td>${escapeHtml(row.reference)}</td>
        <td>${escapeHtml(row.impact)}</td>
        <td>${escapeHtml(row.level)}</td>
      </tr>`
    )
    .join('');
}

export async function init(view, context) {
  activeView = view;

  mountModuleActions('<span id="weather-status" class="vs-page-chip">Loading operational inputs...</span>');

  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'Weather Briefing';
  }

  const cards = view.querySelectorAll('.card');
  cards.forEach((card, index) => {
    card.dataset.module = 'weather';
    card.setAttribute('data-index', index + 1);
  });

  const operatorUid = context?.currentUser?.uid || null;
  activeOperatorUid = operatorUid;

  if (!operatorUid) {
    const statusLabel = getModuleAction('weather-status');
    if (statusLabel) {
      statusLabel.textContent = 'No authorized operator found.';
    }
    return {
      destroy() {}
    };
  }

  try {
    const [companyAircraft, crewList] = await Promise.all([getCompanyAircraft(operatorUid), getCrew(operatorUid)]);
    latestAircraft = companyAircraft.length ? companyAircraft : await getAircraft();
    latestCrew = crewList;
    latestDocsByPilot = await getCrewDocumentsByPilots(crewList);
    await renderWeather();
  } catch (error) {
    console.error('Weather initial load failed:', error);
    const statusLabel = getModuleAction('weather-status');
    if (statusLabel) {
      statusLabel.textContent = 'Unable to load weather posture inputs right now.';
    }
  }

  aircraftUnsubscribe = onCompanyAircraftSnapshot(
    operatorUid,
    (fleet) => {
      if (fleet.length > 0) latestAircraft = fleet;
      renderWeather();
    },
    (error) => console.error('Weather aircraft snapshot error:', error)
  );

  crewUnsubscribe = onCrewSnapshot(
    operatorUid,
    async (snapshot) => {
      latestCrew = snapshot.map((item) => ({ uid: item.uid || item.crewProfileId, ...item }));
      latestDocsByPilot = await syncCrewDocumentCache(latestDocsByPilot, latestCrew);
      await renderWeather();
    },
    (error) => console.error('Weather crew snapshot error:', error)
  );

  return {
    destroy() {
      aircraftUnsubscribe?.();
      crewUnsubscribe?.();
      aircraftUnsubscribe = null;
      crewUnsubscribe = null;
      latestAircraft = [];
      latestCrew = [];
      latestDocsByPilot = new Map();
      activeView = null;
      activeOperatorUid = null;
    }
  };
}
