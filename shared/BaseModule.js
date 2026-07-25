export class BaseModule {
  constructor(view, moduleKey, moduleTitle) {
    this.view = view;
    this.moduleKey = moduleKey;
    this.moduleTitle = moduleTitle;
    this.hydrate();
  }

  hydrate() {
    if (!this.view) return;

    const heading = this.view.querySelector('h2') || this.view.querySelector('h1');
    if (heading) {
      heading.textContent = this.moduleTitle;
    }

    this.view.querySelectorAll('.card').forEach((card, index) => {
      card.dataset.module = this.moduleKey;
      card.dataset.index = index + 1;
    });
  }

  async load() {
    return Promise.resolve();
  }

  async refresh() {
    return Promise.resolve();
  }

  destroy() {
    // Override in modules when cleanup is required.
  }

  static clear(view) {
    if (!view) return;
    view.innerHTML = '';
  }
}
