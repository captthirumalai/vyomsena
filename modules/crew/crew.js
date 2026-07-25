import { getCrew, getPilotDocuments, onCrewSnapshot, delinkPilot, deletePilot } from '../../services/crewService.js';

let crewUnsubscribe = null;

async function renderCrewTable(pilots) {
  const body = document.getElementById('crew-table-body');
  if (!body) return;
  body.innerHTML = '';

  const pilotRows = await Promise.all(
    pilots.map(async (pilot) => {
      const docs = await getPilotDocuments(pilot.uid);
      const status = docs.some((doc) => {
        const rawExpiry = doc.expiryDate?.toDate ? doc.expiryDate.toDate() : doc.expiryDate;
        const expiry = rawExpiry ? new Date(rawExpiry) : null;
        return expiry && expiry < new Date();
      })
        ? 'Expired'
        : docs.some((doc) => {
            const rawExpiry = doc.expiryDate?.toDate ? doc.expiryDate.toDate() : doc.expiryDate;
            const expiry = rawExpiry ? new Date(rawExpiry) : null;
            return expiry && (expiry - new Date()) / (1000 * 60 * 60 * 24) < 30;
          })
        ? 'Expiring'
        : 'Valid';

      return `<tr>
        <td><strong>${pilot.name}</strong><br /><small>${pilot.email || 'No email'}</small></td>
        <td>${pilot.role || 'Pilot'}</td>
        <td>${status}</td>
        <td>${docs.length}</td>
      </tr>`;
    })
  );

  body.innerHTML = pilotRows.join('');
}

async function refreshCrew(operatorUid) {
  const pilots = await getCrew(operatorUid);
  renderCrewTable(pilots);
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
    renderCrewTable(pilots);
  }, (error) => console.error('Crew snapshot error:', error));

  await refreshCrew(operatorUid);

  return {
    destroy() {
      crewUnsubscribe?.();
      console.log('Crew module destroyed');
    }
  };
}
