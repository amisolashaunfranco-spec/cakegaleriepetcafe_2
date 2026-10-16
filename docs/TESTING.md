# Verification and user acceptance record

Run the following commands using Node.js 24+ from the repository root:

```sh
npm run check
npm test
```

## Recorded verification — 16 October 2026

Node.js **24.19.0**, Windows. Command: `node --test tests/*.test.mjs`. **44 tests/subtests passed, 0 failed, 0 skipped.** The backend suite exercised real HTTP on ephemeral local ports; public mapping responses are stubbed only within those automated tests. The demo suite used isolated browser-storage mocks. Frontend/server JavaScript syntax checks passed.

Browser checks in the Codex in-app browser confirmed customer registration, real session login, a delivery pin and order, a future two-guest reservation, admin login, menu and pet creation using actual file pickers, and staff changes to preparing/out-for-delivery with rider coordinates. Customer and management layouts were checked at 390 px with no horizontal overflow. The static Pages preview loaded and displayed its browser-local mode label.

Live external requests returned HTTP 200: Nominatim found SM City Davao; OSRM returned a 2.66 km road route and a 5-minute driving estimate for a sample Davao destination. These checks are separate from stubbed automated tests.

Screenshots: [home](screenshots/home.jpg), [phone home](screenshots/home-mobile.jpg), [phone management](screenshots/management-mobile.jpg). All displayed people, contact details, and transactions are invented test data.

The remaining matrix below is an evaluator checklist; a Pending entry is not a claim that an untested manual step passed. Fill it in during your group demonstration.

Tester: __________  Date: __________  Browser / version: __________  Node version: __________  Deployment mode: __________

## Manual test matrix

| ID | Test | Expected result | Actual result / evidence |
|---|---|---|---|
| U01 | Open home/menu on desktop and a narrow screen | Content and controls remain usable without horizontal overflow | Pending |
| U02 | Register a unique customer with a valid password | Account created, signed-in state shown | Pending |
| U03 | Register duplicate email or short password | Friendly error; no second/invalid account | Pending |
| U04 | Sign in with incorrect password; then valid credentials | Invalid attempt rejected; valid account succeeds | Pending |
| U05 | Customer directly requests admin catalog write | Server returns `403` | Pending |
| U06 | Admin creates a menu item with file photo, edits it, then deletes it | Saved fields/image appear; update persists; deletion removes record | Pending |
| U07 | Upload wrong file type, fake image, or image over 3 MB | Friendly validation error; no accepted invalid photo | Pending |
| U08 | Add/edit/delete an unreferenced pet; mark it unavailable | CRUD works; unavailable profile cannot be selected for a new booking | Pending |
| U09 | Select a closed day, invalid date, or past time | Booking rejected with useful guidance | Pending |
| U10 | Create valid booking; try to exceed shared slot capacity | Valid booking saved; excess seats rejected | Pending |
| U11 | Customer cancels own booking and attempts to change another customer's booking | Own cancellation works; other record protected | Pending |
| U12 | Place pickup order | Server-calculated total; no delivery fee; stock reduced | Pending |
| U13 | Place delivery with destination map pin in radius | Address/pin saved; ₱60 fee added; order visible to staff | Pending |
| U14 | Try out-of-radius delivery pin or invalid coordinates | Rejected; no order/stock changes | Pending |
| U15 | Request more stock than available | Order rejected; inventory remains consistent | Pending |
| U16 | Cancel a placed order; try cancelling it again | Stock restored once; closed order cannot be cancelled again | Pending |
| U17 | Staff advances delivery and pickup flows | Correct sequence enforced; skipping steps rejected | Pending |
| U18 | Enter rider coordinates while out for delivery | Customer map shows the last staff-entered point | Pending |
| U19 | Search a real Davao address and request a route | External service returns address options and road route/estimate | Pending |
| U20 | Disconnect internet or simulate mapping failure | Friendly failure shown; no misleading route/GPS claim | Pending |
| U21 | Review revenue before and after delivered/collected status | Only completed fulfillment contributes to revenue | Pending |
| U22 | Promote account to staff, sign in again, try admin-only functions | Staff transaction/report access works; catalog/user writes forbidden | Pending |
| U23 | Attempt self-demotion/deletion or remove last administrator | Server rejects the action | Pending |
| U24 | Delete account with transactions or pet with booking | Server rejects deletion; history retained | Pending |
| U25 | Restart server and sign in again | Catalog, orders, bookings, and uploaded images persist | Pending |
| U26 | Open Pages demo in two different browsers | Each has separate local records; demo label is visible | Pending |
| U27 | Sign out and reopen protected management page | Protected data is unavailable until authorized sign-in | Pending |

Real external-service checks need internet access and must be recorded separately from tests that stub service responses. Route estimates and staff-entered rider positions are not live delivery telemetry.

## Suggested defense sequence

1. Show the Node server, current environment mode, and health response.
2. Register a customer, browse menu/pets, and book a future session.
3. Place a delivery order with a map destination.
4. Sign in as staff/admin, update the order one step at a time, and enter rider coordinates.
5. Return to the customer's account and show the updated timeline/marker.
6. Show menu/pet CRUD and a real image file upload.
7. Show a forbidden customer admin request and an invalid input response.
8. Inspect the SQLite tables/keys, then restart and demonstrate persistence.
9. Show the external request/JSON response in developer tools or an API client.
10. Explain why the Pages demo uses browser storage while the full server provides shared database/authentication.

Capture screenshots without passwords, session cookies, or real customer data. Obtain actual evaluator feedback and record remaining issues below.

## Acceptance sign-off

Evaluator: __________  Date: __________  Accepted / needs revision: __________

Open issues and evidence: __________

Team contributions: __________

### Browser preview limitation

The in-app browser later reported a renderer crash during an additional console-log inspection. The functional checks and screenshots listed above had already completed. A complete cross-browser release check and the remaining evaluator matrix are still required before a real café launch.

## Smooth animation update

Added shared `public/motion.js` and `public/motion.css` to customer and management pages. JavaScript syntax checks passed for motion, app, and admin modules; CSS and asset links were inspected. An independent code review checked quiet polling, filter replacement, reduced-motion changes, keyboard focus, map exclusions, and observer cleanup. The browser security policy blocked access to the existing preview, so the new animation timing was not visually rechecked in this update. The earlier 44-test application verification above predates this presentation change.
