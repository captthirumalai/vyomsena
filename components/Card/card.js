export function createCard({
  title = '',
  body = '',
  footer = '',
  className = ''
} = {}) {
  const card = document.createElement('section');
  card.className = `vs-card ${className}`.trim();

  if (title) {
    const heading = document.createElement('h3');
    heading.className = 'vs-card__title';
    heading.textContent = title;
    card.appendChild(heading);
  }

  if (body) {
    const bodyContainer = document.createElement('div');
    bodyContainer.className = 'vs-card__body';
    bodyContainer.innerHTML = body;
    card.appendChild(bodyContainer);
  }

  if (footer) {
    const footerEl = document.createElement('div');
    footerEl.className = 'vs-card__footer';
    footerEl.innerHTML = footer;
    card.appendChild(footerEl);
  }

  return card;
}
