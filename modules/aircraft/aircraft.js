import { getAircraft, onAircraftSnapshot } from '../../services/aircraftService.js';

let aircraftUnsubscribe = null;

function renderAircraftTable(aircraftFleet) {
  const body = document.getElementById('aircraft-table-body');
  if (!body) return;
  body.innerHTML = '';

  aircraftFleet.forEach((item) => {
    body.insertAdjacentHTML(
      'beforeend',
      `<tr>
        <td>${item.reg}</td>
        <td>${item.type || 'Unknown'}</td>
        <td>${item.status || 'Unknown'}</td>
        <td>${item.nextInspection ? new Date(item.nextInspection.toDate ? item.nextInspection.toDate() : item.nextInspection).toLocaleDateString() : 'N/A'}</td>
      </tr>`
    );
  });
}

export async function init(view, context) {
  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'Aircraft Fleet';
  }

  const cards = view.querySelectorAll('.card');
  cards.forEach((card, index) => {
    card.dataset.module = 'aircraft';
    card.setAttribute('data-index', index + 1);
  });

  aircraftUnsubscribe = onAircraftSnapshot((snapshot) => {
    const aircraftFleet = snapshot.docs.map((item) => ({ reg: item.id, ...item.data() }));
    renderAircraftTable(aircraftFleet);
  }, (error) => console.error('Aircraft snapshot error:', error));

  const aircraftFleet = await getAircraft();
  renderAircraftTable(aircraftFleet);

  return {
    destroy() {
      aircraftUnsubscribe?.();
      console.log('Aircraft module destroyed');
    }
  };
}
