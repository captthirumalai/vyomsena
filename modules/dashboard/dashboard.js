import { getAircraft, onAircraftSnapshot } from '../../services/aircraftService.js';
import { getCrew, getPilotDocuments, onCrewSnapshot } from '../../services/crewService.js';

let aircraftUnsubscribe = null;
let crewUnsubscribe = null;

async function renderSummary(aircraftFleet, crewList) {
  const fleetTotal = aircraftFleet.length;
  const fleetOperational = aircraftFleet.filter((item) => item.status === 'Operational').length;
  const fleetMaintenance = aircraftFleet.filter((item) => item.status !== 'Operational').length;
  const crewTotal = crewList.length;

  let expiring = 0;
  let expired = 0;

  const pilotDocsPromises = crewList.map((pilot) => getPilotDocuments(pilot.uid));
  const docsByPilot = await Promise.all(pilotDocsPromises);

  docsByPilot.forEach((docs) => {
    docs.forEach((doc) => {
      const rawExpiry = doc.expiryDate?.toDate ? doc.expiryDate.toDate() : doc.expiryDate;
      const expiry = rawExpiry ? new Date(rawExpiry) : null;
      if (!expiry || Number.isNaN(expiry.getTime())) return;
      const diff = expiry - new Date();
      const days = diff / (1000 * 60 * 60 * 24);
      if (days < 0) expired += 1;
      else if (days < 30) expiring += 1;
    });
  });

  document.getElementById('fleet-total').textContent = fleetTotal;
  document.getElementById('fleet-operational').textContent = fleetOperational;
  document.getElementById('fleet-maintenance').textContent = fleetMaintenance;
  document.getElementById('crew-total').textContent = crewTotal;
  document.getElementById('crew-expiring').textContent = expiring;
  document.getElementById('crew-expired').textContent = expired;
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
