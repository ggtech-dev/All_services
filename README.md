# All Services

A local services super-app for Telangana, launching in **Siddipet**: customers browse service categories (home services, groceries, health, vehicle, personal, recycling, logistics), shop products inside services (milk, kirana, vegetables…) and book services; admins manage the whole catalog, products, prices, photos and home page from an admin panel.

**Stack:** React (Vite) · Node.js (Express) · PostgreSQL (business logic in functions/procedures)

```
All_Services/
├── client/          React app
│   └── src/admin/   Admin panel (dashboard, services, categories, pricing, settings, activity)
└── server/          Express API
    ├── db/          schema.sql, functions.sql, seed catalog, setup + image scripts
    └── uploads/     Images uploaded from the admin panel (not committed)
```

## Setup

1. **Database.** Create the database and user in PostgreSQL:
   ```sql
   CREATE DATABASE all_services;
   CREATE USER all_services_user WITH PASSWORD '<password>';
   GRANT CREATE ON DATABASE all_services TO all_services_user;
   ```
   The app keeps its tables in its own `all_services` schema.

2. **Server**
   ```bash
   cd server
   npm install
   cp .env.example .env      # then fill in PGPASSWORD and JWT_SECRET
   npm run db:setup          # tables, functions, 7 categories / 81 services, admin user
   npm run dev               # http://localhost:5000
   ```

3. **Client**
   ```bash
   cd client
   npm install
   npm run dev               # http://localhost:5173  (proxies /api and /uploads to the server)
   ```

## Who uses what

| Who | URL | What they do |
|---|---|---|
| Customer | http://localhost:5173/login (👤 User) | Shop products, book services, checkout (cash on delivery), track orders live with a delivery OTP |
| Delivery agent | http://localhost:5173/login?as=agent (🛵 Agent) | Go online, see open orders nearest first, accept, mark picked up, deliver with the customer's OTP, see today's deliveries, wallet and reports |
| New agent | http://localhost:5173/agent/apply | Public application: details, vehicle, Aadhaar / PAN / driving licence upload. Can log in only after an admin approves |
| Admin | http://localhost:5173/login?as=admin (🛡️ Admin) | Everything below |

## Logging in

The login page has a **User / Agent / Admin** switch.

- **User**: customers log in or register and browse services.
- **Agent**: approved delivery agents; they land on `/agent`. Pending, rejected or suspended agents get a clear message instead.
- **Admin**: only accounts with the `admin` role can log in here; they land on `/admin`.

Default admin: `admin` / `Admin@123` (set `ADMIN_PASSWORD` before the first `db:setup` to change it). **Change it before going live.**

## Admin panel

| Page | What the admin can do |
|---|---|
| Dashboard | Counts, services per category, recent changes |
| **Manage orders** | Every order with customer, items, total, status (waiting → assigned → on the way → delivered / cancelled) and agent. Filters, search, date. Order detail: timeline, OTP, assign / re-assign to a free agent (nearest first), cancel |
| **Manage agents** | Filter by type of work; edit an agent's types.  All agents with live state (🟢 free, 🔵 on delivery, ⚪ offline), today's and total deliveries, wallet, cash in hand. Applications tab: view uploaded documents, approve / reject. Add agent directly, copy the apply link, suspend / re-activate. Agent detail: 7-day report, recent orders, wallet (pay agent, cash received, bonus) |
| Services | Add / edit / delete services, click a price to edit it, click a photo to upload a new one, show/hide (Live switch) |
| Products | Items inside a service (e.g. Milk Delivery → Vijaya Toned Milk 500 ml): add / edit / delete, price & MRP edited in place, photo upload, in-stock and Live switches |
| Categories | Add / edit / delete categories, icon, colour, image, show/hide |
| Prices & items | One page with every product and service: edit any price or photo in the row, add new products/services, bulk % change (products, services or both) with full preview, price history |
| **Delivery charges** | Company UPI QR (upload / scan; the UPI ID is read from the QR), free deliveries for new customers, and the delivery charge of every service (click to edit, or "set all" per category) |
| **Service areas** | The areas customers choose at checkout: add (tap the map for the location), rename, move, switch off. Areas are never deleted — old orders keep them |
| Site settings | Home banner, announcement strip, city, support phone, agent pay per delivery, orders an agent can carry at once, delivery OTP on/off |
| Activity log | Every admin change: who, what, old → new |

Everything saves immediately and customers see it on their next page load.

## Database logic

All writes from the admin panel go through PostgreSQL functions/procedures in [`server/db/functions.sql`](server/db/functions.sql):

| Object | Purpose |
|---|---|
| `fn_save_service`, `fn_save_category`, `fn_save_product` | Validate + create/update, generate unique slugs |
| `fn_set_service_price`, `fn_set_product_price` | Quick price / MRP edit |
| `sp_set_product_flag`, `sp_delete_product` | In-stock / Live switches, delete |
| `sp_set_image` | One-click photo change for a category, service or product |
| `sp_bulk_update_prices` | % price change for services, products or both, with rounding; free items stay free, products never exceed MRP |
| `sp_set_service_active`, `sp_delete_service`, `sp_delete_category` | Show/hide and safe delete (a category with services can't be deleted) |
| `sp_save_settings` | Upsert home page settings |
| `fn_admin_stats` | Dashboard numbers in one call |
| `fn_place_order`, `sp_cancel_order` | Validated order placement with DB prices, delivery fee, OTP; cancellation rules |
| `fn_create_agent`, `sp_review_agent`, `sp_set_agent_status`, `sp_set_agent_online` | Agent applications (Aadhaar/PAN/DL validation), approval, suspend, online/offline |
| `fn_agent_accept_order`, `fn_admin_assign_order`, `sp_agent_release_order`, `fn_agent_update_order` | Race-safe accept, assignment, pickup, OTP delivery with wallet credit |
| `fn_clean_skills`, `sp_set_agent_skills`, `sp_set_service_skill`, `fn_save_service_type`, `fn_service_type_overview` | Agent types: validation, editing, coverage report |
| `sp_wallet_entry`, `fn_agent_stats`, `fn_order_stats`, `v_agents` | Wallet (payout ≤ balance), agent reports, live free/busy/offline state |
| triggers | price history for services and products, `admin_audit_log` on every category/service/product change, `updated_at`, and a check that a product's selling price is never above its MRP |

The API tags each admin transaction with the admin's user id (`SET LOCAL app.user_id`), so the triggers record who made each change. Every function pins its `search_path` to the app schema, so the triggers also work when data is edited directly in psql or pgAdmin.

Seed products are Telangana staples (Vijaya & Heritage dairy, Sona Masoori rice, Guntur chilli powder, gongura, Osmania biscuits, murrel…). Products start with an emoji tile; admins upload real photos from the admin panel.

`npm run db:setup` is safe to re-run: it upgrades the schema and adds missing seed rows but never overwrites changes made in the admin panel.

## Agent types (who gets which orders)

Every **service** has one type of work (`services.skill_code`) and every **agent** has one or more (`agents.skills`), from the `service_types` table:

- **Regular agents** (`delivery`): all food & grocery, plus everyday delivery jobs (water cans, empty-can pickup, laundry, ironing).
- **Home services** (`home_service`): plumbers, electricians, painters, carpenters, AC/appliance repair, cleaning, pest control, tank cleaning, RO service.
- Other types: Beauty, Vehicle, Health & care, Mobile & laptop repair, Tutoring, Pet care, Scrap & recycling, Moving, General help.

- An order gets the type of its service (`orders.skill_code`); product orders go to Delivery agents.
- Agents only **see and can accept** orders of their types. Admin can only assign an order to an agent of the right type.
- Admin → **Agent types** shows, per type, how many services, agents (free now) and waiting orders — with a warning when a type has services but no agents.
- Change a service's type in **Services** (dropdown in the row); change an agent's types in **Manage agents** → agent → *Types of work*. New applicants choose their types on the apply page.
- Customers see the right word: “Your plumber”, “Your electrician”, “Your delivery partner”.

## Buying at a shop (shop bill + UPI to the shop)

For item orders the agent can buy from a local shop and let the customer pay the shop directly:

1. **Agent** (order accepted, at the shop): *Add shop bill* → bill amount, bill photo (📷 Camera or 🖼️ Gallery), and the shop's UPI QR:
   - **🔳 Scan shop's UPI QR (live camera)** — point the phone at the shop's scanner; it is read automatically and that frame is kept as the QR photo, or
   - take / choose a photo of the QR — the app **reads the QR** and fills the UPI ID and shop name. (Or *I paid cash* if the shop has no UPI.)

   Live scanning needs camera permission and a secure page (https, or localhost). On plain http over Wi-Fi the Camera / Gallery buttons still work.
2. **Customer** sees the bill photo and amount, taps **Pay with UPI app** (opens GPay / PhonePe / Paytm with shop and amount filled), or scans the QR / copies the UPI ID, then uploads the payment screenshot from the Gallery (or Camera) (+ optional UTR).
3. **Agent** sees the screenshot, checks with the shopkeeper → **Shop received payment**. Pick-up is locked until then. At the door the agent collects only what is still due (the bill in cash when the agent paid the shop; the delivery charge goes to the company UPI — see below).
4. After delivery or cancellation the **shop's QR photo and UPI ID are deleted**; the bill photo and payment screenshot stay as records.

Photos are stored in `server/private_uploads/orders` and only served to that order's customer, its agent and admins. Logic: `fn_agent_upload_bill`, `fn_customer_payment_proof`, `sp_agent_confirm_payment`, `fn_clear_shop_payment_details` in [`server/db/shop_bill.sql`](server/db/shop_bill.sql).

## Daily services: fresh vegetables, meat & fish, milk

Three regular-agent services, highlighted on the home page (**🌅 Daily fresh**), first in their category, and in the promotions carousel + tiles:

| Service | Delivery time | Price | Customer chooses |
|---|---|---|---|
| **Fresh Vegetables** | 6 AM – 10 AM | as per shop bill | kg in 250 g steps (leafy greens by bunch) |
| **Daily Fresh Meat & Fish** | any time | as per shop bill | kg + cutting instructions per item (curry cut, boneless, fry pieces… or own words) |
| **Fresh Milk** | 6 AM – 9 AM | fixed (admin edits) | organic milk in litres (500 ml steps), packet milk by count |

- **Price as per shop bill**: no prices are shown; the agent buys at the market, uploads the bill (photo + amount, shop UPI QR or cash) and **cannot pick up until the bill is added**. The customer pays the bill amount; the delivery charge still goes to the company UPI.
- **Delivery window**: checkout offers 1-hour slots for today and tomorrow inside the window (a slot can be chosen until 45 min before it ends); the server only accepts those slots. A cart mixing windows uses their overlap (vegetables + milk → 6–9 AM); windows that don't overlap must be ordered separately.
- **Admin**: Services → edit → *Daily service* (delivery from/until, price as per shop bill, highlight on home page). Products → edit → *Customer chooses* (packs / kg / litres / bunches / pieces) and *Cutting options*.
- Item photos: Wikimedia Commons (free licences, credited on each photo), checked by hand; 4 items without a good photo show an emoji tile — upload one from Admin → Products.

Logic: `fn_qty_ok`, `fn_item_label`, `fn_delivery_slots`, `fn_cart_window`, `sp_set_service_options`, `sp_set_product_selling` in [`server/db/daily_fresh.sql`](server/db/daily_fresh.sql); ordering rules in `fn_place_order` / `fn_agent_update_order`.

## Delivery charges (paid to the company UPI QR)

- **Per service.** Admin → *Delivery charges* sets a charge for each service (shops started at ₹30, bookings at ₹0). A cart from several shops pays the **highest** charge among them (one trip). Each customer's first N orders are free (N set on the same page). Distance-based charges can come later.
- **Company UPI QR.** The admin uploads (or scans) the company's UPI QR on the same page; the UPI ID is read from the QR. Every agent has a **🔳 Pay QR** tab showing it.
- **At the door.** The agent sees *Delivery charge ₹40* → **Show company QR to customer** → the customer scans, pays and shows the success screen → agent taps **✅ Received on company UPI** (or *Customer paid in cash instead*). **Mark delivered stays locked until then.** The customer's order page also has a **📱 Pay ₹40 with UPI app** button once the order is on the way.
- **Money.** A charge paid to the company UPI is *not* counted as cash with the agent; paid in cash, it is. Every confirmation is on the order timeline and in the admin order detail.

Logic: `fn_delivery_quote`, `sp_set_service_delivery_fee`, `fn_set_category_delivery_fee`, `sp_agent_fee_received`, `fn_save_locality` in [`server/db/delivery.sql`](server/db/delivery.sql); the "confirm before delivered" rule is in `fn_agent_update_order`.

## Reports

Admin → **📈 Reports** (date range: today, yesterday, 7 / 30 days, this / last month, custom — India time):

- Headline numbers with change vs the previous period: orders, delivered, revenue, average order value, average time to deliver, cancelled, customers ordering / new sign-ups, agent pay.
- Charts (hover for details): orders per day, revenue per day, busy hours.
- Tables: agent performance (delivered, in progress, released, avg. minutes, order value, earnings, cash in hand — sortable), by agent type, by category, top areas, top selling items, top customers, cancellation reasons. Every table has a CSV download, plus **Download all orders (CSV)** for Excel.
- Database: `fn_report` and `fn_report_kpis` in [`server/db/reports.sql`](server/db/reports.sql).

Delivery confirmation: by default the agent just taps **Mark delivered**. Turn on **Site settings → Ask customer OTP on delivery** to require the customer's 4-digit code instead.

## Promotions (home page ads)

- Customers see a **big sliding banner** (auto-slides every 5 s, arrows, dots, swipe on phones) and a row of **small offer tiles** below the welcome banner.
- Admin → **📢 Promotions**: add / edit / delete, image (upload or URL), title and description (optional), button text, link to a category, a service/shop or a website, colours, big banner or tile, start/end date (festival offers), on/off switch, ▲▼ order, live preview, and views / clicks / click-rate per promotion.
- Database: `promotions` table and `fn_save_promotion`, `fn_promotion_state`, `sp_move_promotion`, `sp_set_promotion_active`, `sp_delete_promotion`, `sp_promotion_views`, `sp_promotion_click` in [`server/db/promotions.sql`](server/db/promotions.sql). Links are validated (existing category/service, https only).

## Email login codes & forgot password (free)

- **Customers and agents** can log in with **🔑 Password** (username *or* email) or **📧 Email code**: enter email → a 6-digit code is emailed → type it → logged in.
- **Forgot password?** on the login page: email → code → new password.
- **My account** (customers) and **Profile** (agent app): add / change email (confirmed with a code sent to the new address) and change password.
- **Sign-up verifies the email first**: details → 6-digit code to the email → the account is created only after the code is entered (`fn_register_start`, `fn_register_complete`). Taken usernames/emails are refused before any code is sent. Agents give an email when applying. Admins log in with password only.
- Security: codes are random, stored only as a keyed SHA-256 hash, expire in 10 minutes, can be used once, lock after 5 wrong tries; one code per 30 s and max 5 per hour per email (20 per hour per IP); the API never reveals whether an email is registered; every login, failed attempt and password change is written to `auth_audit_log`.
- Database: `auth_otps`, `auth_audit_log`, `fn_otp_request`, `fn_otp_check`, `sp_set_password`, `sp_auth_log`, `sp_auth_cleanup` in [`server/db/auth.sql`](server/db/auth.sql).

### Sending real emails

Until SMTP is configured the app runs in **test mode**: codes are printed in the server terminal and shown in a yellow box on the screen. To send real emails, fill these in `server/.env` and restart the server:

```
SMTP_HOST=smtp-relay.brevo.com   # Brevo free plan (~300 emails/day) — or smtp.gmail.com with a Gmail App Password
SMTP_PORT=587
SMTP_USER=your-login
SMTP_PASS=your-smtp-key
MAIL_FROM=All Services <no-reply@yourdomain.in>
```

## Live GPS tracking (free)

- **Agent app**: while an agent is online, the phone's GPS (browser Geolocation API) is sent to the server every ~10 s, with a "📍 Live location on" indicator. The agent must allow location access and keep the app open (browsers pause GPS in the background).
- **Customer**: on an assigned / on-the-way order, the tracking page shows a map with the agent 🛵, their home 🏠, the path, distance and an estimated arrival time. Only for their own order, and only until it is delivered.
- **Checkout**: "📍 Use my current location" pins the exact door point (and picks the nearest area automatically).
- **Admin**: **📍 Live map** with every agent (🟢 free, 🔵 on delivery, grey = position older than 3 min); click an agent for their trail, current order, distance and ETA. The agent detail and order detail also show maps.
- "Orders near you" and the admin's nearest-agent list use live GPS when it is fresh, otherwise the chosen area.
- Maps: [Leaflet](https://leafletjs.com) + OpenStreetMap tiles, **no API key or payment**. For heavy traffic switch the tile URL in `client/src/components/MapView.jsx` to a free-tier provider (MapTiler, Stadia).
- Production needs **HTTPS** for browser GPS (localhost works for testing). Trail points older than 3 days are pruned.

## How an order flows

1. Customer places an order (prices are recalculated in the database, never trusted from the browser). A 4-digit **delivery OTP** is created.
2. Online agents see it in *Orders near you*, sorted by distance from their area. Customer phone/address stay hidden until an agent accepts.
3. The first agent to tap **Accept** gets it (safe even if two tap at the same moment). An agent carries one order at a time by default, so they show as *busy*.
4. Agent taps **Picked up**, reaches the customer, confirms the delivery charge (**Received on company UPI** or cash) and taps **Delivered** (plus the customer's OTP, if the admin switched that on). The agent earns the per-delivery pay in their wallet and any cash collected is recorded as *cash in hand*. The agent is *free* again.
5. Customers can cancel until pickup; admins until delivery. Agents can release an order they can't do; it goes back to the open list.

Identity documents are stored in `server/private_uploads` (never served publicly, only streamed to logged-in admins). Only the last 4 digits of Aadhaar are kept.

## Service images

Seed photos are Creative Commons images (mostly from India) found through [Openverse](https://openverse.org) and cached in `server/db/images.json` with their attribution; the ⓘ on each card shows the credit. Admins can replace any image from the admin panel.

To re-fetch seed photos: delete entries from `images.json`, run `npm run db:images`, then `npm run db:setup -- --refresh-images` (this resets seeded categories/services to the cached photos).

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register/start`, `/register/verify` | – | Sign-up: emails a 6-digit code, then creates the account |
| POST | `/api/auth/login` | – | `{ username, password, portal: 'user' \| 'admin' }` |
| GET | `/api/auth/me` | user | Current user |
| GET | `/api/categories`, `/api/categories/:slug` | – | Live categories / services |
| GET | `/api/services/:slug` | – | A service with its live products |
| GET | `/api/settings` | – | Home page settings |
| GET | `/api/admin/stats`, `/api/admin/activity` | admin | Dashboard |
| GET/POST/PUT/DELETE | `/api/admin/services[/:id]` | admin | Manage services |
| PATCH | `/api/admin/services/:id/price`, `/:id/active` | admin | Quick price edit, show/hide |
| GET/POST/PUT/DELETE | `/api/admin/products[/:id]` | admin | Manage products (`?service=`, `?category=`) |
| PATCH | `/api/admin/products/:id/price`, `/:id/flag` | admin | `{field: price\|mrp, value}`, `{flag: in_stock\|is_active, value}` |
| PATCH | `/api/admin/{categories,services,products}/:id/image` | admin | Replace a photo |
| GET/POST/PUT/DELETE | `/api/admin/categories[/:id]` | admin | Manage categories |
| POST | `/api/admin/prices/bulk` · GET `/api/admin/prices/history` | admin | Bulk pricing |
| PUT | `/api/admin/settings` | admin | Save home page settings |
| POST | `/api/admin/upload` | admin | Upload image (JPG/PNG/WEBP/GIF, ≤ 5 MB) |
| GET | `/api/orders/quote?products=1,2` · `?service=7` | user | Delivery charge for this cart / booking |
| POST | `/api/agent/orders/:id/fee-received` | agent | `{ mode: 'company_upi' \| 'cash' }` at the door |
| GET | `/api/admin/delivery-charges` · PATCH `/api/admin/services/:id/delivery-fee` · POST `/api/admin/delivery-charges/category` | admin | Charges per service |
| GET/POST/PUT | `/api/admin/localities[/:id]` | admin | Service areas |

## Roadmap

- [x] Login / register, User vs Admin portal
- [x] Categories and services with images
- [x] Admin panel: services, categories, pricing, settings, activity log
- [x] Products inside services, editable prices/MRP/photos/stock
- [x] Cart & checkout, service booking, live order tracking with delivery OTP
- [x] Delivery agents: apply with documents, admin approval, agent app, wallet & reports
- [x] Admin: manage orders, manage agents
- [x] Delivery charge per service, paid to the company UPI QR at the door
- [ ] Distance-based delivery charges
- [ ] Online payments (UPI / Razorpay)
- [ ] SMS / push notifications for new orders
- [x] Live GPS tracking (agent → customer & admin maps)
- [ ] Customer ratings for agents

