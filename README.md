# All Services

A local services super-app: customers browse service categories (home services, groceries, health, vehicle, personal, recycling, logistics), book a service, and admins assign a partner who completes the job.

**Stack:** React (Vite) · Node.js (Express) · PostgreSQL

```
All_Services/
├── client/   React app (login, register, categories, services)
└── server/   Express API + PostgreSQL schema/seed
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
   npm run db:setup          # creates tables, seeds 7 categories / 81 services, creates the admin user
   npm run dev               # http://localhost:5000
   ```

3. **Client**
   ```bash
   cd client
   npm install
   npm run dev               # http://localhost:5173  (proxies /api to the server)
   ```

Default admin login: `admin` / `Admin@123` (set `ADMIN_PASSWORD` before the first `db:setup` to change it).

## Service images

The photos are Creative Commons images from [Openverse](https://openverse.org), cached in `server/db/images.json` with their attribution. The ⓘ icon on each card shows the credit. To refresh an image, delete its entry and run `npm run db:images`, then `npm run db:setup`.

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | – | API + DB status |
| POST | `/api/auth/register` | – | `{ username, password, fullName?, phone? }` → `{ token, user }` |
| POST | `/api/auth/login` | – | `{ username, password }` → `{ token, user }` |
| GET | `/api/auth/me` | Bearer | Current user |
| GET | `/api/categories` | – | Categories with service counts |
| GET | `/api/categories/:slug` | – | Category + its services |

## Roadmap

- [x] Login / register (username + password, JWT)
- [x] Categories and services with images
- [ ] Booking flow (address, time slot, notes)
- [ ] Admin dashboard: view bookings, assign partners
- [ ] Partner app: accept and complete jobs
- [ ] Booking status tracking
