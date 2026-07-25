# VAMS V2 Module Template

Use this template when creating a new feature module.

## Folder structure

Create a new module folder under `modules/`:

- `modules/<module>/manifest.js`
- `modules/<module>/<module>.html`
- `modules/<module>/<module>.css`
- `modules/<module>/<module>.js`

## 1. Manifest

`manifest.js`

```js
export const manifest = {
  path: '/weather',
  name: 'Weather',
  title: 'Weather Briefing',
  icon: 'weather',
  order: 40,
  showInMenu: true,
  permissions: ['operations', 'pilot'],
  breadcrumbs: ['Home', 'Weather'],
  html: 'modules/weather/weather.html',
  js: 'modules/weather/weather.js',
  css: 'modules/weather/weather.css'
};
```

## 2. HTML

`<module>.html`

```html
<section class="card">
  <h2>Weather Briefing</h2>
  <p class="muted">Operational weather data appears here.</p>
  <div id="weather-content"></div>
</section>
```

## 3. CSS

`<module>.css`

```css
#weather-content {
  margin-top: 1rem;
}
```

## 4. JS entry

`<module>.js`

```js
export async function init(view, context) {
  const heading = view.querySelector('h2');
  if (heading) heading.textContent = 'Weather Briefing';

  const operatorUid = context?.currentUser?.uid || null;
  const content = view.querySelector('#weather-content');

  if (!operatorUid) {
    if (content) content.textContent = 'No authorized operator found.';
    return { destroy() {} };
  }

  if (content) {
    content.textContent = `Module ready for operator ${operatorUid}.`;
  }

  return {
    destroy() {
      // Cleanup listeners and timers here.
    }
  };
}
```

## 5. Register the module route

Add the module manifest import to `shared/routes.js` and include it in `appRoutes`.

## 6. Service layer rule

- Module files should not import Firebase SDK directly.
- Use `services/*Service.js` and `services/firestoreService.js`.

## 7. Completion checklist

- Manifest has `permissions`, `showInMenu`, and `order`.
- Route loads HTML/CSS/JS correctly.
- Module uses `init(view, context)` signature.
- No direct global state usage (avoid window globals).
- Cleanup logic exists in `destroy()` for listeners/subscriptions.
