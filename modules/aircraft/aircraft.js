export function initAircraft(view) {
  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'Aircraft Fleet';
  }

  const cards = view.querySelectorAll('.card');
  cards.forEach((card, index) => {
    card.dataset.module = 'aircraft';
    card.setAttribute('data-index', index + 1);
  });

  console.log('Aircraft module initialized');
}
