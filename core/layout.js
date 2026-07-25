export function initLayout() {
  const app = document.getElementById('app');
  if (!app) return;

  const shell = `
    <header class="app-header">
      <h1>VAMS V2</h1>
      <nav class="app-nav">
        <a href="#/dashboard">Dashboard</a>
        <a href="#/crew">Crew</a>
        <a href="#/aircraft">Aircraft</a>
      </nav>
    </header>
    <main id="view" class="app-view"></main>
  `;

  app.innerHTML = shell;
  document.body.style.background = '#f5f7fb';
}
