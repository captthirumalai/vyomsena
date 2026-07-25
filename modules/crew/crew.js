import { getCrew, onCrewSnapshot, delinkPilot, deletePilot, getCrewDocumentsByPilots, summarizeCrewDocumentCompliance } from '../../services/crewService.js';

let crewUnsubscribe = null;

async function renderCrewTable(pilots) {
  const body = document.getElementById('crew-table-body');
  if (!body) return;
  body.innerHTML = '';

  const docsByPilot = await getCrewDocumentsByPilots(pilots.map((pilot) => pilot.uid));

  const pilotRows = pilots.map((pilot) => {
    const docs = docsByPilot.get(pilot.uid) || [];
    const compliance = summarizeCrewDocumentCompliance(docs);
    const status = compliance.expired > 0 ? 'Expired' : compliance.expiring > 0 ? 'Expiring' : 'Valid';

    return `<tr>
      <td><strong>${pilot.name}</strong><br /><small>${pilot.email || 'No email'}</small></td>
      <td>${pilot.role || 'Pilot'}</td>
      <td>${status}</td>
      <td>${docs.length}</td>
    </tr>`;
  });

  body.innerHTML = pilotRows.join('');
}

async function refreshCrew(operatorUid) {
  const pilots = await getCrew(operatorUid);
  await renderCrewTable(pilots);
}

export async function init(view, context) {
  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'Crew Management';
  }

  const cards = view.querySelectorAll('.card');
  cards.forEach((card, index) => {
    card.dataset.module = 'crew';
    card.setAttribute('data-index', index + 1);
  });

  const operatorUid = context?.currentUser?.uid || null;
  if (!operatorUid) {
    console.warn('Crew module requires operator UID');
    return {
      destroy() {
        console.log('Crew module destroyed');
      }
    };
  }

  crewUnsubscribe = onCrewSnapshot(operatorUid, async (snapshot) => {
    const pilots = snapshot.docs.map((item) => ({ uid: item.id, ...item.data() }));
    await renderCrewTable(pilots);
  }, (error) => console.error('Crew snapshot error:', error));

  await refreshCrew(operatorUid);

  return {
    destroy() {
      crewUnsubscribe?.();
      console.log('Crew module destroyed');
    }
  };
}
