# VAMS V2 Architecture

This project follows a layered structure:

- Core: shared app shell, routing, theme, notifications
- Components: reusable UI building blocks
- Services: Firebase and business logic
- Models: data structures
- Modules: feature-specific pages

---

## Development Log

### 2026-07-26 00:09:29
- Added a progress tracking convention to the architecture document.
- Confirmed completed core tasks:
  - Refactored `core/layout.js` into the application shell and content area.
  - Created `shared/routes.js` as the module manifest.
  - Updated `js/router.js` to load module HTML, CSS, and JS dynamically.
  - Added `components/Button/button.js` and `components/Card/card.js` with shared UI styles.
- Confirmed project structure now supports adding future modules via the shared router manifest.
- Added a timestamped log entry for ongoing build tracking.

### Notes
- Future changes will be appended here with date/time and description.
- Use this log to inspect what has been completed and what is next.

### 2026-07-26 00:24:00
- Fixed shell rendering by adding `#view` inside `#app-view` so modules load into the shared content area.
- Updated `js/router.js` to highlight the current sidebar route and support module load failure gracefully.
- Added shell styling for `.vs-shell`, `.vs-sidebar`, and `.vs-app-view` in `css/main.css`.
- Verified auth flow toggles between login UI and app shell using `showLanding()` / `showAppShell()`.
- Added active route display in the topbar and dynamic browser title updates during navigation.

## Decisions & Guidelines

### App architecture
- The app is a modular single-page application using a shared shell and dynamic module loader.
- `core/` owns common behavior: layout, theme, notifications, and global UI shell.
- `shared/routes.js` defines the route manifest; modules register there with HTML, JS, CSS, and fallback content.
- Modules remain isolated and only update the content area (`#view`).
- A consistent `components/` library will provide reusable UI primitives.

### Authentication
- Authentication is handled through Firebase Authentication.
- User profiles are stored in Firestore under `users/{uid}`.
- Auth UI must remain separate from the main app shell and only show after successful sign-in.
- Current auth flow includes sign in, register, and password recovery.

### Styles and UI
- Use `css/main.css` for global styles, themes, and shared component styling.
- Shared components should follow consistent naming: `vs-button`, `vs-card`, etc.
- Module-specific CSS should be loaded dynamically by the router and isolated per module.
- Maintain a clean, modern aviation management visual style with blue accents, white surfaces, and soft shadows.

### Feature scope for now
- Core platform shell with route-based module loading.
- Authentication + workspace registration.
- Dashboard, Crew, and Aircraft as the first modules.
- Keep the first version lightweight: focus on structure and extensibility.

### Future guardrails
- Do not bulge `app.js` or `auth.js` with feature-specific logic.
- Keep modules small: HTML + module-specific JS + optional CSS.
- Add shared helpers to `shared/` for constants, routes, permissions, and events.
- Prefer reusable components over ad-hoc UI in module files.
