# All Services

A local services super-app for India: customers browse service categories (home services, groceries, health, vehicle, personal, recycling, logistics) and book a service; admins manage the whole catalog, prices and home page from an admin panel.

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

## Logging in

The login page has a **User / Admin** switch.

- **User**: customers log in or register and browse services.
- **Admin**: only accounts with the `admin` role can log in here; they land on `/admin`.

Default admin: `admin` / `Admin@123` (set `ADMIN_PASSWORD` before the first `db:setup` to change it). **Change it before going live.**

## Admin panel

| Page | What the admin can do |
|---|---|
| Dashboard | Counts, services per category, recent changes |
| Services | Add / edit / delete services, change image (upload or URL), click a price to edit it in place, show/hide (Live switch) |
| Categories | Add / edit / delete categories, icon, colour, image, show/hide |
| Pricing | Raise/lower prices by % for one category or everything, with preview and rounding; full price history |
| Site settings | Home banner title/subtitle, announcement strip, city, support phone (live preview) |
| Activity log | Every admin change: who, what, old → new |

Everything saves immediately and customers see it on their next page load.

## Database logic

All writes from the admin panel go through PostgreSQL functions/procedures in [`server/db/functions.sql`](server/db/functions.sql):

| Object | Purpose |
|---|---|
| `fn_save_service`, `fn_save_category` | Validate + create/update, generate unique slugs |
| `fn_set_service_price` | Quick price edit |
| `sp_bulk_update_prices` | % price change with rounding; free services stay free |
| `sp_set_service_active`, `sp_delete_service`, `sp_delete_category` | Show/hide and safe delete (a category with services can't be deleted) |
| `sp_save_settings` | Upsert home page settings |
| `fn_admin_stats` | Dashboard numbers in one call |
| triggers | `service_price_history` on every price change, `admin_audit_log` on every category/service change, `updated_at` |

The API tags each admin transaction with the admin's user id (`SET LOCAL app.user_id`), so the triggers record who made each change.

`npm run db:setup` is safe to re-run: it upgrades the schema and adds missing seed rows but never overwrites changes made in the admin panel.

## Service images

Seed photos are Creative Commons images (mostly from India) found through [Openverse](https://openverse.org) and cached in `server/db/images.json` with their attribution; the ⓘ on each card shows the credit. Admins can replace any image from the admin panel.

To re-fetch seed photos: delete entries from `images.json`, run `npm run db:images`, then `npm run db:setup -- --refresh-images` (this resets seeded categories/services to the cached photos).

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | – | `{ username, password, fullName?, phone? }` |
| POST | `/api/auth/login` | – | `{ username, password, portal: 'user' \| 'admin' }` |
| GET | `/api/auth/me` | user | Current user |
| GET | `/api/categories`, `/api/categories/:slug` | – | Live categories / services |
| GET | `/api/settings` | – | Home page settings |
| GET | `/api/admin/stats`, `/api/admin/activity` | admin | Dashboard |
| GET/POST/PUT/DELETE | `/api/admin/services[/:id]` | admin | Manage services |
| PATCH | `/api/admin/services/:id/price`, `/:id/active` | admin | Quick price edit, show/hide |
| GET/POST/PUT/DELETE | `/api/admin/categories[/:id]` | admin | Manage categories |
| POST | `/api/admin/prices/bulk` · GET `/api/admin/prices/history` | admin | Bulk pricing |
| PUT | `/api/admin/settings` | admin | Save home page settings |
| POST | `/api/admin/upload` | admin | Upload image (JPG/PNG/WEBP/GIF, ≤ 5 MB) |

## Roadmap

- [x] Login / register, User vs Admin portal
- [x] Categories and services with images
- [x] Admin panel: services, categories, pricing, settings, activity log
- [ ] Booking flow (address, time slot, notes)
- [ ] Admin: view bookings, assign partners
- [ ] Partner app: accept and complete jobs
- [ ] Booking status tracking
