# REST API reference

The full server exposes JSON endpoints under `/api`. The browser-local demo mimics these operations in JavaScript; it is not a server REST API. All examples below refer to the Node server. No API key is required. Protected operations use the `cafe_session` HttpOnly cookie set by register/login. Use a cookie jar in an API testing tool. JSON requests require `Content-Type: application/json`.

## Response conventions

- `GET` and successful updates: `200`.
- Successful `POST`: `201`, including login and logout in this implementation.
- Successful `DELETE`: `204` with no response body.
- Errors: `{ "error": "A message suitable for the user." }`.
- Common errors: `400` invalid input, `401` no valid login, `403` forbidden, `404` absent record/route, `409` conflict, `413` oversized request, `415` wrong content type, `429` throttled, `500` unexpected server error, `502` external map service failure.

Identifiers are opaque strings. Times in `createdAt`/history are ISO timestamps. Reservation dates and slot times use the café's Philippine time. Customer list endpoints return only the signed-in customer's records; staff and administrators see all transaction records. Password hashes and session tokens never appear in user resources.

## Resource shapes

Fields shown here describe the resources returned by the endpoint tables. Array endpoints return arrays of these resources directly.

```js
// User
{ id, name, email, role: 'admin' | 'staff' | 'customer' }

// Product: price is PHP; stock is a nonnegative integer
{ id, name, category, description, price, stock, image, available }

// Pet: age is returned as descriptive text; available is boolean
{ id, name, species, breed, age, personality, description, image, available }

// Reservation
{ id, userId, date, time, guests, petId, notes, status,
  createdAt, customerName, petName }

// Order
{ id, userId, items: [{ productId, name, price, quantity }],
  subtotal, deliveryFee, total, fulfillment, address, lat, lng,
  status, createdAt, history: [{ status, at }], driverLat,
  driverLng, customerName, phone, notes }
```

The code blocks above are shape notation, not literal JSON. Request examples below are valid JSON. Image values are server-returned `uploads/...` paths or bundled `assets/...` paths, never external photo URLs.

## Health, configuration, and accounts

| Method and endpoint | Access / purpose | Request | Success response |
|---|---|---|---|
| `GET /api/health` | Public; server health | None | `200 {"ok":true}` |
| `GET /api/config` | Public; café operating rules | None | `200` configuration object described below |
| `GET /api/auth/me` | Public; current session | None | `200 {"user":User}` or `{"user":null}` |
| `POST /api/auth/register` | Public; customer account and session | `{"name":"Ana Cruz","email":"ana@example.test","password":"a-unique-customer-password"}` | `201 {"user":User}` and session cookie |
| `POST /api/auth/login` | Public; start session | `{"email":"ana@example.test","password":"a-unique-customer-password"}` | `201 {"user":User}` and session cookie |
| `POST /api/auth/logout` | End current session | No body required | `201 {"user":null}` and cleared cookie |

Configuration:

```json
{
  "name": "Cake Galerie / Pet Café",
  "capacity": 16,
  "openDays": [3, 4, 5, 6],
  "openTime": "12:00",
  "closeTime": "19:00",
  "cafe": {
    "lat": 7.05372,
    "lng": 125.58987,
    "address": "1st Avenue, Tulip Drive, Juna Subdivision, Matina, Davao City"
  },
  "deliveryRadiusKm": 15,
  "deliveryFee": 60
}
```

Registration requires a name of 2–100 characters, a syntactically valid unique email, and a 10–128 character password. Login attempts and registration are throttled. Bootstrap administrator configuration is separate from registration and requires a unique password of at least 12 characters.

## Menu items and pets

| Method and endpoint | Access / purpose | Request | Success response |
|---|---|---|---|
| `GET /api/products` | Public; list catalog | None | `200 Product[]` |
| `POST /api/products` | Admin; create menu item | Product fields below, without `id` | `201 Product` |
| `PUT /api/products/{id}` | Admin; update menu item | Changed product fields | `200 Product` |
| `DELETE /api/products/{id}` | Admin; delete menu item | None | `204` |
| `GET /api/pets` | Public; list pet profiles | None | `200 Pet[]` |
| `POST /api/pets` | Admin; create pet | Pet fields below, without `id` | `201 Pet` |
| `PUT /api/pets/{id}` | Admin; update pet | Changed pet fields | `200 Pet` |
| `DELETE /api/pets/{id}` | Admin; delete unreferenced pet | None | `204`; `409` if reservations reference the pet |
| `POST /api/uploads` | Admin; upload image file | Upload envelope below | `201 {"image":"uploads/generated-id.jpg"}` |

Create product:

```json
{
  "name": "Chocolate Cake",
  "category": "Cakes",
  "description": "A chocolate cake slice.",
  "price": 185,
  "stock": 18,
  "image": "assets/menu-cake.jpg",
  "available": true
}
```

Create pet:

```json
{
  "name": "Mochi",
  "species": "Cat",
  "breed": "Domestic shorthair",
  "age": "2 years",
  "personality": "Calm and curious",
  "description": "A sample café companion.",
  "image": "assets/pet-muta.jpg",
  "available": true
}
```

`PUT` merges supplied fields with the existing resource. Price is a number from 0 to 100,000; stock is a whole number in that range. Availability is a boolean. New records require a nonempty name and an accepted image path. The admin UI obtains image paths from file uploads.

The upload UI reads a selected file and sends a JSON envelope:

```json
{ "filename": "mochi.jpg", "type": "image/jpeg", "data": "BASE64_BYTES_WITHOUT_A_DATA_URL_PREFIX" }
```

Replace the example `data` value with actual base64-encoded file bytes. Accepted file types are JPEG, PNG, and WebP; decoded size must be at most 3 MB. The server checks image signatures and MIME agreement, generates a filename, and writes to the uploads directory. It does not fetch photo URLs. Replacing an image does not automatically remove the old uploaded file.

## Reservations

| Method and endpoint | Access / purpose | Request | Success response |
|---|---|---|---|
| `GET /api/availability?date=2027-01-06` | Public; capacity by session | Valid today/future `YYYY-MM-DD` query | `200 {"slots":[{"time":"12:00","remaining":16}, ...]}`; closed days have `[]` |
| `GET /api/reservations` | Signed in; scoped list | None | `200 Reservation[]` |
| `POST /api/reservations` | Signed in; reserve seats | Body below | `201 Reservation` |
| `PUT /api/reservations/{id}` | Owner cancellation, or staff/admin completion/cancellation | `{"status":"cancelled"}` or team `{"status":"completed"}` | `200 Reservation` |

```json
{
  "date": "2027-01-06",
  "time": "14:00",
  "guests": 2,
  "petId": "pet-muta",
  "notes": "A quiet table, please."
}
```

Use an actual future Wednesday–Saturday when trying this example. Dates may be booked up to two years ahead; the start time must still be in the future. Sessions start at `12:00` through `18:00`. Guest count is 1–6; all reservations share 16 seats per slot. A selected pet must be available. `petId` can be empty/null to express no preference. A pet choice does not reserve exclusive access to that animal. Capacity is checked in a database transaction. A closed reservation cannot be updated again.

## Orders and tracking

| Method and endpoint | Access / purpose | Request | Success response |
|---|---|---|---|
| `GET /api/orders` | Signed in; scoped order list | None | `200 Order[]` |
| `POST /api/orders` | Signed in; create an order | Order body below | `201 Order` |
| `PUT /api/orders/{id}` | Team fulfillment/tracking updates; owner may cancel a placed order | Status, optionally rider coordinates | `200 Order` |

Delivery request:

```json
{
  "items": [{ "productId": "prd-cake", "quantity": 2 }],
  "fulfillment": "delivery",
  "address": "Sample destination, Matina, Davao City",
  "lat": 7.055,
  "lng": 125.5905,
  "phone": "09123456789",
  "notes": "Please call on arrival."
}
```

For pickup, use `"fulfillment":"pickup"`; address and coordinates are unnecessary. Phone is required for both methods. Each quantity must be 1–100; one order accepts up to 50 input item entries. Duplicate product IDs are aggregated, with a maximum of 100 per product. Products must exist, be available, and have enough stock.

The server reads current catalog prices and calculates subtotal and total. Client-supplied prices/totals are ignored. Delivery adds ₱60 and requires a destination within a 15 km straight-line radius; pickup adds no fee. Stock changes and order creation occur in a transaction. Cancellation restores existing product stock once. Product names and prices are stored as order snapshots.

Allowed fulfillment flows:

```text
delivery: placed → preparing → out_for_delivery → delivered
pickup:   placed → preparing → ready_for_pickup → collected
```

Team members advance one step at a time or cancel an open order. Customers can only cancel their own order while it is `placed`. Closed orders cannot be changed. Staff can update the last known rider point while the order is out for delivery:

```json
{ "status": "out_for_delivery", "driverLat": 7.054, "driverLng": 125.5902 }
```

Coordinates must be valid and within the delivery area. This is a manual update, not GPS tracking. Marking delivery complete sets the rider marker to the destination. Status changes append timestamps to `history`.

## Administration and reports

| Method and endpoint | Access / purpose | Request | Success response |
|---|---|---|---|
| `GET /api/users` | Admin; account list | None | `200 User[]` |
| `PUT /api/users/{id}` | Admin; name/role update | `{"name":"Ana Cruz","role":"staff"}`; either field may be omitted | `200 User` |
| `DELETE /api/users/{id}` | Admin; remove unreferenced account | None | `204` |
| `GET /api/reports` | Staff/admin; operational summary | None | `200` report object below |

```json
{ "revenue": 0, "orders": 0, "reservations": 0, "customers": 1, "lowStock": [] }
```

Revenue counts delivered and collected orders only. Counts include all order/reservation statuses; `customers` counts customer-role accounts. `lowStock` contains product resources with stock at or below five. Administrators cannot delete/demote themselves or remove the last administrator, and cannot delete users with transaction records. Role changes invalidate that account's existing sessions.

## External map services

| Method and endpoint | Access / purpose | Request | Success response |
|---|---|---|---|
| `GET /api/geocode?q=Matina` | Public; address search through Nominatim | Query text, 3–200 characters | `200 [{"displayName":"...","lat":7.05,"lng":125.59}]` |
| `GET /api/route?lat=7.055&lng=125.5905` | Public; road estimate through OSRM | Valid destination in delivery area | `200 {"coordinates":[[7.05372,125.58987],...],"distanceKm":1.2,"durationMinutes":4}` |

Search results are restricted to the Davao area and delivery radius. Address queries are cached for 24 hours in server memory and uncached requests are spaced by at least 1.1 seconds. Map requests are throttled. External calls have an 8-second timeout and return friendly `502` errors when unavailable. Route coordinates are `[latitude, longitude]` for Leaflet; OSRM's source coordinates are converted by the server.

Map imagery is loaded by the browser from OpenStreetMap tiles. Address/route estimates are external data; they do not validate a customer's entered street address or guarantee arrival time.

## Testing with an API client

1. Start the server with your `.env` credentials.
2. Send `POST /api/auth/login` with the administrator JSON; retain the response cookie.
3. Exercise catalog create/read/update/delete and confirm the documented status codes.
4. Register/sign in as a different customer and try an admin write; expect `403`.
5. Submit malformed JSON, a negative stock value, an invalid date, and an out-of-radius delivery point; expect friendly errors.
6. Record screenshots and actual responses in your project appendix. Never include session cookies or real passwords in screenshots.
