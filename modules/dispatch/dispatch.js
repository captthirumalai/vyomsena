import { getAircraft, onAircraftSnapshot } from '../../services/aircraftService.js';
import { getCrew, onCrewSnapshot, getCrewDocumentsByPilots, summarizeCrewDocumentCompliance } from '../../services/crewService.js';

let aircraftUnsubscribe = null;
let crewUnsubscribe = null;
let latestAircraft = [];
let latestCrew = [];
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

async function renderDispatch() {
  if (!activeView) return;

  const statusLabel = activeView.querySelector('#dispatch-status');
  const queueBody = activeView.querySelector('#dispatch-queue-body');
  if (!statusLabel || !queueBody) return;

  const pilotIds = latestCrew.map((pilot) => pilot.uid).filter(Boolean);
  const docsByPilot = await getCrewDocumentsByPilots(pilotIds);

  const crewRows = latestCrew.map((pilot) => {
    const docs = docsByPilot.get(pilot.uid) || [];
    const compliance = summarizeCrewDocumentCompliance(docs);
    const status = compliance.expired > 0 ? 'Expired' : compliance.expiring > 0 ? 'Expiring' : 'Valid';
    return {
      name: pilot.name || pilot.email || pilot.uid,
      status,
      issues: compliance.expired + compliance.expiring
    };
  });

  const totalFleet = latestAircraft.length;
  const operationalFleet = latestAircraft.filter((item) => `${item.status || ''}`.toLowerCase() === 'operational').length;
  const readyCrew = crewRows.filter((item) => item.status === 'Valid').length;
  const constrainedCrew = crewRows.length - readyCrew;
  const constrainedAircraft = latestAircraft.filter((item) => `${item.status || ''}`.toLowerCase() !== 'operational').length;
  const totalConstraints = constrainedCrew + constrainedAircraft;

  activeView.querySelector('#dispatch-fleet-total').textContent = `${totalFleet}`;
  activeView.querySelector('#dispatch-fleet-operational').textContent = `${operationalFleet}`;
  activeView.querySelector('#dispatch-crew-ready').textContent = `${readyCrew}`;
  activeView.querySelector('#dispatch-constraints').textContent = `${totalConstraints}`;

  statusLabel.textContent = `Live readiness for operator ${activeOperatorUid}: ${operationalFleet}/${totalFleet} aircraft operational, ${readyCrew}/${crewRows.length} crew ready.`;

  const queueRows = [];
  latestAircraft.forEach((item) => {
    if (`${item.status || ''}`.toLowerCase() === 'operational') return;
    queueRows.push({
      type: 'Aircraft',
      reference: item.reg || 'Unknown',
      issue: 'Not operational',
      status: item.status || 'Unknown'
    });
  });

  crewRows.forEach((item) => {
    if (item.status === 'Valid') return;
    queueRows.push({
      type: 'Crew',
      reference: item.name,
      issue: item.status === 'Expired' ? 'Critical document expired' : 'Document expiring soon',
      status: item.status
    });
  });

  if (!queueRows.length) {
    queueBody.innerHTML = '<tr><td colspan="4">No active constraints. Dispatch window is clear.</td></tr>';
    return;
  }

  queueBody.innerHTML = queueRows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.type)}</td>
        <td>${escapeHtml(row.reference)}</td>
        <td>${escapeHtml(row.issue)}</td>
        <td>${escapeHtml(row.status)}</td>
      </tr>`
    )
    .join('');
}

export async function init(view, context) {
  activeView = view;

  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'Dispatch Control';
  }

  const cards = view.querySelectorAll('.card');
  cards.forEach((card, index) => {
    card.dataset.module = 'dispatch';
    card.setAttribute('data-index', index + 1);
  });

  const operatorUid = context?.currentUser?.uid || null;
  activeOperatorUid = operatorUid;

  if (!operatorUid) {
    const statusLabel = view.querySelector('#dispatch-status');
    if (statusLabel) {
      statusLabel.textContent = 'No authorized operator found.';
    }
    return {
      destroy() {}
    };
  }

  try {
    const [aircraftFleet, crewList] = await Promise.all([getAircraft(), getCrew(operatorUid)]);
    latestAircraft = aircraftFleet;
    latestCrew = crewList;
    await renderDispatch();
  } catch (error) {
    console.error('Dispatch initial load failed:', error);
    const statusLabel = view.querySelector('#dispatch-status');
    if (statusLabel) {
      statusLabel.textContent = 'Unable to load dispatch data right now.';
    }
  }

  aircraftUnsubscribe = onAircraftSnapshot(
    async (snapshot) => {
      latestAircraft = snapshot.docs.map((item) => ({ reg: item.id, ...item.data() }));
      await renderDispatch();
    },
    (error) => console.error('Dispatch aircraft snapshot error:', error)
  );

  crewUnsubscribe = onCrewSnapshot(
    operatorUid,
    async (snapshot) => {
      latestCrew = snapshot.docs.map((item) => ({ uid: item.id, ...item.data() }));
      await renderDispatch();
    },
    (error) => console.error('Dispatch crew snapshot error:', error)
  );

  return {
    destroy() {
      aircraftUnsubscribe?.();
      crewUnsubscribe?.();
      aircraftUnsubscribe = null;
      crewUnsubscribe = null;
      latestAircraft = [];
      latestCrew = [];
      activeView = null;
      activeOperatorUid = null;
    }
  };
}
