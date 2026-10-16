# Cake Galerie · Pet Café

A Studio Ghibli themed pet café reservation and ordering system, built with **HTML, CSS, and vanilla JavaScript**. A JavaScript Node.js server supplies the course project's REST API, authentication, relational SQLite database, file uploads, and map integrations.

This is an independent student concept, not the official website of Cake Galerie or Studio Ghibli. Prices, menu items, pet profiles, map pin, and operating rules are sample configuration. Genuine official Studio Ghibli film stills provide the visual theme; menu and pet images are illustrations, not real product or animal photos. See [asset credits](docs/ASSET-CREDITS.md).

## Features

- Gentle scroll reveals, staggered page entrances, card hover effects, native-dialog transitions, toast entrances, and basket feedback. Respects reduced-motion settings and keeps background refreshes steady.
- Browse and filter the menu, manage a cart, and order for pickup or delivery in Philippine pesos.
- Choose a delivery pin on an OpenStreetMap map, search an address, and request a road route estimate.
- Follow an order timeline and view the last rider location entered by staff.
- Book one-hour pet café visits, select a sample pet, and check remaining guest capacity.
- Register, sign in, and see your own reservations and orders.
- Administrator and staff dashboards with role-based access.
- Administrators add, edit, and delete menu items and pets, upload image files, and manage user roles.
- Staff and administrators update reservations and orders and view reports.
- Image selection uses a **file picker**, with a preview. JPG, PNG, and WebP up to 3 MB; no photo URL form fields.

## Choose how to run it

| Mode | Storage and login | Suitable use |
|---|---|---|
| Node.js server | Shared SQLite database, hashed passwords, server-enforced roles, cookie sessions, filesystem image uploads | Full project demonstration and a starting point for a hosted application |
| GitHub Pages | Browser `localStorage`; illustrative demo accounts and roles | Public portfolio/demo of the interface |

**GitHub Pages hosts static files. It cannot run this Node.js API or SQLite database.** In Pages demo mode, records and uploads belong to the current browser only; another browser or device cannot see those orders. Demo login and role checks are not security. Use invented data in the public demo.

## Quick preview

With Node.js 24+ installed, run `npm run demo` and open [http://127.0.0.1:4174](http://127.0.0.1:4174). This serves the same browser-local demo published to GitHub Pages. No installation or administrator setup is needed for this preview. Use the sample accounts below. Open the app through HTTP, rather than double-clicking an HTML file, because it uses JavaScript modules.

## Full system: run locally

Requirements: **Node.js 24 or newer**, npm, and a modern browser. Internet access is needed for map tiles, address search, and road routing. There are no npm runtime dependencies and no separate database installation.

1. Download or clone this repository and open a terminal in its root folder.
2. Copy `.env.example` to `.env`.
3. Edit `.env`. Set your own `ADMIN_EMAIL` and `ADMIN_PASSWORD` of at least **12 characters**. Replace the example password; the server rejects that placeholder.
4. Start the application:

   ```sh
   npm start
   ```

5. Open [http://localhost:3000](http://localhost:3000). Sign in with the administrator credentials from `.env`, then open the management dashboard at `/admin.html`.
6. Register a separate customer account to demonstrate the customer journey. Customer passwords require at least 10 characters.

`npm start` loads `.env` automatically. Alternatively, set the environment variables in your shell and run `npm start`, or run `node --env-file=.env server.mjs` directly. The initial administrator is created only when the database has no administrator. Editing the bootstrap password later does not reset an existing account password.

First startup creates `data/cafe.sqlite`, its SQLite support files, and `data/uploads/`, then seeds eight menu items and four fictional pets from `public/seed.json`. Changing the seed file later does not overwrite existing database records. Use the dashboard to update them.

### Configuration

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port; default 3000 |
| `HOST` | Bind address; default `127.0.0.1`. Your hosting provider may require `0.0.0.0`. |
| `DATA_DIR` | Writable persistent directory for SQLite and uploads |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Initial administrator bootstrap |
| `NODE_ENV` | Set `production` when hosted behind HTTPS; enables secure cookies |
| `TRUST_PROXY` | Set `true` only behind a trusted proxy that controls forwarded protocol headers |
| `FRONTEND_ORIGIN` | Optional exact HTTPS origin for a separately hosted frontend; no path or trailing slash |
| `GEOCODE_USER_AGENT` | Identifying user agent for Nominatim requests |

Do not commit `.env`, the database, or uploaded customer files. They are ignored by Git. Back up the data directory using an appropriate SQLite backup procedure or while the application is stopped.

## Publish the demo on GitHub Pages

1. Create a GitHub repository and upload the complete project, including the `.github` folder. Do not upload `.env` or `data/`.
2. Use `main` as your repository branch, or change the branch in `.github/workflows/pages.yml`.
3. In the repository, open **Settings → Pages → Build and deployment → Source → GitHub Actions**.
4. Push a change to `main`, or run **Actions → Deploy café demo to GitHub Pages → Run workflow**.
5. When deployment completes, open the URL shown in the deployment job.

The workflow publishes only the `public/` folder. The default `public/config.js` works both with the local server and Pages. For a host with an unusual API fallback, explicitly set `mode: 'demo'` in that file to select the browser demo.

### Browser demo accounts only

| Role | Email | Demo password |
|---|---|---|
| Administrator | `admin@cakegalerie.test` | `Admin123!` |
| Staff | `staff@cakegalerie.test` | `Staff123!` |
| Customer | `guest@cakegalerie.test` | `Guest123!` |

These credentials apply only to the browser-local demo. The Node server does not create them. Clearing the site's browser storage removes local demo changes and resets its sample data.

## Host the full system

Use a host that runs Node.js 24 and supplies a **persistent writable disk**. Deploy the repository, provide environment variables, and run `npm start`. Serve the application and API together behind HTTPS; this avoids cross-site session limitations. Set `DATA_DIR` to the persistent disk, `NODE_ENV=production`, and the appropriate `HOST`/`PORT`. Configure your trusted reverse proxy before setting `TRUST_PROXY=true`.

To connect a separately hosted Pages frontend to an API:

1. Deploy the Node server at an HTTPS address, such as `https://api.example.com`.
2. Set server `FRONTEND_ORIGIN=https://yourname.github.io` (origin only, without the repository path) and `NODE_ENV=production`.
3. Set the frontend configuration in `public/config.js`:

   ```js
   window.CAFE_CONFIG = { mode: 'auto', apiBase: 'https://api.example.com' };
   ```

4. Republish the frontend. Confirm login, cookie persistence, uploads, and record access in the browsers you will support.

The server allows credentialed CORS for the exact configured frontend origin. Cross-site sessions use `SameSite=None; Secure` cookies, which browser third-party-cookie restrictions may block. Hosting the UI and API on one origin is the recommended deployment. A configured remote API failure displays an error; it does not silently switch into demo storage.

## Operating rules and limits

- Sample café sessions: Wednesday–Saturday, starting each hour from 12:00 through 18:00, ending by 19:00, Philippine time. Shared capacity is 16 guests per session; selecting a pet is a preference, not an exclusive pet booking.
- Delivery eligibility uses a 15 km straight-line radius from the sample café pin. Road distance may be longer. Delivery fee is a flat ₱60; pickup is free.
- Payments are **cash on delivery or pay at pickup**. There is no payment gateway.
- Tracking shows staff-entered status and the last manually entered rider coordinates. It is not live GPS and there is no rider mobile app. Route duration is an estimate, not an arrival promise.
- Stock is deducted when an order is placed and restored once if it is cancelled. Customers can cancel only their own newly placed orders. Staff advance fulfillment one step at a time.
- Reports count all orders/reservations and customer accounts. Revenue includes only delivered or collected orders; it is a simple operational total, not an audited financial ledger.
- No password reset, email verification, SMS notifications, refunds, multi-branch management, or automated pet welfare scheduling is implemented.
- Public mapping services may rate-limit or become unavailable. Clicking the map still permits destination selection when address search fails; the UI reports route failures.

## Check and demonstrate

```sh
npm run check
npm test
```

See [testing and UAT](docs/TESTING.md) for the manual checks to record on your own environment, [API reference](docs/API.md), and [nine-chapter project documentation](docs/PROJECT-DOCUMENTATION.md). Verification on 16 October 2026 using Node.js 24.19.0: **44 automated tests/subtests passed, 0 failed**, including real HTTP backend integration and browser-demo behavior. Desktop/mobile browser checks and live map requests were also performed; see the recorded evidence in `docs/TESTING.md`. Complete the remaining evaluator sign-off with your own group.

## Supplied logo

The user-provided Totoro drawing is used as the café mark, with a transparent background and moss-green lines. The supplied drawing is embedded in the SVG; it is not newly generated art. `public/assets/logo-lockup.svg` and `.png` contain the wordmark, while `logo-mark.svg` and `.png` contain the illustration alone.

## Project files

```text
public/                 HTML, CSS, JavaScript, configuration, demo seed, assets
server.mjs              HTTP server, REST API, SQLite access, upload handling
tests/                  Backend integration and browser-demo unit tests
.env.example            Environment template without real secrets
.github/workflows/      GitHub Pages publication and Node.js test workflows
docs/                   Project chapters, API reference, UAT, asset credits
data/                   Runtime database and uploads (not committed)
```

The interface uses locally vendored Leaflet. Map data comes from OpenStreetMap, address results from Nominatim, and road routes from OSRM. The external services require internet access and are subject to their respective usage policies. See [credits and source links](docs/ASSET-CREDITS.md).
