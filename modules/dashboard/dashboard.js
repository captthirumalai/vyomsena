import { getAircraft, onAircraftSnapshot } from '../../services/aircraftService.js';
import { getCrew, onCrewSnapshot, getCrewDocumentsByPilots, summarizeCrewDocumentCompliance } from '../../services/crewService.js';

let aircraftUnsubscribe = null;
let crewUnsubscribe = null;

async function renderSummary(aircraftFleet, crewList) {
  const fleetTotal = aircraftFleet.length;
  const fleetOperational = aircraftFleet.filter((item) => item.status === 'Operational').length;
  const fleetMaintenance = aircraftFleet.filter((item) => item.status !== 'Operational').length;
  const crewTotal = crewList.length;

  const docsByPilot = await getCrewDocumentsByPilots(crewList.map((pilot) => pilot.uid));
  const allDocs = Array.from(docsByPilot.values()).flat();
  const compliance = summarizeCrewDocumentCompliance(allDocs);

  document.getElementById('fleet-total').textContent = fleetTotal;
  document.getElementById('fleet-operational').textContent = fleetOperational;
  document.getElementById('fleet-maintenance').textContent = fleetMaintenance;
  document.getElementById('crew-total').textContent = crewTotal;
  document.getElementById('crew-expiring').textContent = compliance.expiring;
  document.getElementById('crew-expired').textContent = compliance.expired;
  document.getElementById('dashboard-activity').textContent = `Loaded ${fleetTotal} aircraft and ${crewTotal} pilots from Firestore.`;
}

export async function init(view, context) {
  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'Dashboard Overview';
  }

  const cards = view.querySelectorAll('.card');
  cards.forEach((card, index) => {
    card.dataset.module = 'dashboard';
    card.setAttribute('data-index', index + 1);
  });

  const operatorUid = context?.currentUser?.uid || null;

  async function refreshData() {
    if (!operatorUid) {
      document.getElementById('dashboard-activity').textContent = 'No authorized operator available.';
      return;
    }
    const [aircraftFleet, crewList] = await Promise.all([getAircraft(), getCrew(operatorUid)]);
    await renderSummary(aircraftFleet, crewList);
  }

  aircraftUnsubscribe = onAircraftSnapshot(async (snapshot) => {
    const aircraftFleet = snapshot.docs.map((item) => ({ reg: item.id, ...item.data() }));
    const crewList = await getCrew(operatorUid);
    await renderSummary(aircraftFleet, crewList);
  }, (error) => console.error('Aircraft snapshot error:', error));

  crewUnsubscribe = onCrewSnapshot(operatorUid, async (snapshot) => {
    const crewList = snapshot.docs.map((item) => ({ uid: item.id, ...item.data() }));
    const aircraftFleet = await getAircraft();
    await renderSummary(aircraftFleet, crewList);
  }, (error) => console.error('Crew snapshot error:', error));

  await refreshData();

  return {
    destroy() {
      aircraftUnsubscribe?.();
      crewUnsubscribe?.();
      console.log('Dashboard module destroyed');
    }
  };
}
