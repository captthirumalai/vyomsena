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

  async init(context) {
    await this.load(context);
    this.render(context);
    this.bindEvents(context);
    return this;
  }

  async load(context) {
    return Promise.resolve();
  }

  render(context) {
    return null;
  }

  bindEvents(context) {
    // Override in modules to attach event listeners.
  }

  async refresh(context) {
    return Promise.resolve();
  }

  onEnter(context) {
    // Called when the module becomes active.
  }

  onLeave() {
    // Called when the module is deactivated.
  }

  destroy() {
    // Override in modules when cleanup is required.
  }

  static clear(view) {
    if (!view) return;
    view.innerHTML = '';
  }
}
