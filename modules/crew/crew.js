export function init(view) {
  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'Crew Management';
  }

  const cards = view.querySelectorAll('.card');
  cards.forEach((card, index) => {
    card.dataset.module = 'crew';
    card.setAttribute('data-index', index + 1);
  });

  console.log('Crew module initialized');
}
