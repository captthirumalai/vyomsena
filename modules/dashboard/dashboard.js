export function init(view) {
  const heading = view.querySelector('h2');
  if (heading) {
    heading.textContent = 'Dashboard Overview';
  }

  const cards = view.querySelectorAll('.card');
  cards.forEach((card, index) => {
    card.dataset.module = 'dashboard';
    card.setAttribute('data-index', index + 1);
  });

  console.log('Dashboard module initialized');

  return {
    destroy() {
      console.log('Dashboard module destroyed');
    }
  };
}
