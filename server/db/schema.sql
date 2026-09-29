-- Runs inside the app schema (search_path is set by setup.js).

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(30)  NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  full_name     VARCHAR(100),
  phone         VARCHAR(20),
  role          VARCHAR(20)  NOT NULL DEFAULT 'customer'
                CHECK (role IN ('customer', 'partner', 'admin')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  slug        VARCHAR(60)  NOT NULL UNIQUE,
  name        VARCHAR(100) NOT NULL,
  icon        VARCHAR(10),
  description TEXT,
  image_url   TEXT,
  color       VARCHAR(20),
  sort_order  INT          NOT NULL DEFAULT 0,
  is_active   BOOLEAN      NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS services (
  id               SERIAL PRIMARY KEY,
  category_id      INT          NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  slug             VARCHAR(80)  NOT NULL UNIQUE,
  name             VARCHAR(120) NOT NULL,
  description      TEXT,
  image_url        TEXT,
  base_price       NUMERIC(10,2),
  price_unit       VARCHAR(30),
  eta_minutes      INT,
  requires_license BOOLEAN      NOT NULL DEFAULT false,
  sort_order       INT          NOT NULL DEFAULT 0,
  is_active        BOOLEAN      NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS services_category_idx ON services(category_id);

-- Attribution text for Creative Commons images.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS image_credit TEXT;
ALTER TABLE services   ADD COLUMN IF NOT EXISTS image_credit TEXT;

ALTER TABLE categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE services   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Every price/unit change on a service (filled by a trigger).
CREATE TABLE IF NOT EXISTS service_price_history (
  id         SERIAL PRIMARY KEY,
  service_id INT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  old_price  NUMERIC(10,2),
  new_price  NUMERIC(10,2),
  old_unit   VARCHAR(30),
  new_unit   VARCHAR(30),
  changed_by INT REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_history_service_idx ON service_price_history(service_id, changed_at DESC);

-- Editable text shown on the customer pages (banner, announcement, support phone...).
CREATE TABLE IF NOT EXISTS site_settings (
  key        VARCHAR(60) PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Items sold inside a service, e.g. Milk Delivery -> "Vijaya Toned Milk 500 ml".
CREATE TABLE IF NOT EXISTS products (
  id           SERIAL PRIMARY KEY,
  service_id   INT          NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  slug         VARCHAR(140) NOT NULL UNIQUE,
  name         VARCHAR(120) NOT NULL,
  brand        VARCHAR(60),
  description  TEXT,
  icon         VARCHAR(10),
  image_url    TEXT,
  image_credit TEXT,
  unit         VARCHAR(30),
  price        NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  mrp          NUMERIC(10,2) CHECK (mrp IS NULL OR mrp >= 0),
  in_stock     BOOLEAN      NOT NULL DEFAULT true,
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  sort_order   INT          NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_service_idx ON products(service_id);

CREATE TABLE IF NOT EXISTS product_price_history (
  id         SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  old_price  NUMERIC(10,2),
  new_price  NUMERIC(10,2),
  old_mrp    NUMERIC(10,2),
  new_mrp    NUMERIC(10,2),
  changed_by INT REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_price_history_idx ON product_price_history(product_id, changed_at DESC);

-- Who changed what in the admin panel (filled by triggers).
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   INT REFERENCES users(id) ON DELETE SET NULL,
  entity     VARCHAR(30) NOT NULL,
  entity_id  INT,
  action     VARCHAR(20) NOT NULL,
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON admin_audit_log(created_at DESC);

-- ============ orders & delivery agents ============

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'partner', 'agent', 'admin'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(120);

-- Hyderabad areas with coordinates, used for addresses and "nearest agent / nearest order".
CREATE TABLE IF NOT EXISTS localities (
  id        SERIAL PRIMARY KEY,
  name      VARCHAR(80)  NOT NULL UNIQUE,
  pincode   VARCHAR(6),
  lat       NUMERIC(9,6) NOT NULL,
  lng       NUMERIC(9,6) NOT NULL,
  is_active BOOLEAN      NOT NULL DEFAULT true
);

-- One row per delivery agent (the login lives in users with role 'agent').
CREATE TABLE IF NOT EXISTS agents (
  user_id          INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'active', 'rejected', 'suspended')),
  vehicle_type     VARCHAR(20) NOT NULL DEFAULT 'bike'
                   CHECK (vehicle_type IN ('bike', 'scooter', 'bicycle', 'auto', 'van')),
  vehicle_number   VARCHAR(20),
  aadhaar_masked   VARCHAR(20),   -- only the last 4 digits are kept, e.g. XXXX XXXX 1234
  pan_number       VARCHAR(10),
  dl_number        VARCHAR(20),
  aadhaar_doc      TEXT,          -- file names inside server/private_uploads (never public)
  pan_doc          TEXT,
  dl_doc           TEXT,
  photo_doc        TEXT,
  locality_id      INT REFERENCES localities(id),
  is_online        BOOLEAN NOT NULL DEFAULT false,
  last_seen_at     TIMESTAMPTZ,
  rejection_reason TEXT,
  reviewed_by      INT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id             SERIAL PRIMARY KEY,
  customer_id    INT NOT NULL REFERENCES users(id),
  kind           VARCHAR(10) NOT NULL CHECK (kind IN ('products', 'service')),
  status         VARCHAR(20) NOT NULL DEFAULT 'placed'
                 CHECK (status IN ('placed', 'assigned', 'picked_up', 'delivered', 'cancelled')),
  contact_name   VARCHAR(100) NOT NULL,
  contact_phone  VARCHAR(15)  NOT NULL,
  address_line   TEXT NOT NULL,
  landmark       TEXT,
  locality_id    INT NOT NULL REFERENCES localities(id),
  pincode        VARCHAR(6),
  slot           VARCHAR(40),
  notes          TEXT,
  subtotal       NUMERIC(10,2) NOT NULL,
  delivery_fee   NUMERIC(10,2) NOT NULL DEFAULT 0,
  total          NUMERIC(10,2) NOT NULL,
  payment_method VARCHAR(10) NOT NULL DEFAULT 'cod',
  delivery_otp   VARCHAR(4) NOT NULL,
  agent_id       INT REFERENCES agents(user_id),
  agent_earning  NUMERIC(10,2),
  cancel_reason  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_at    TIMESTAMPTZ,
  picked_up_at   TIMESTAMPTZ,
  delivered_at   TIMESTAMPTZ,
  cancelled_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS orders_status_idx   ON orders(status);
CREATE INDEX IF NOT EXISTS orders_agent_idx    ON orders(agent_id);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(customer_id);
CREATE INDEX IF NOT EXISTS orders_created_idx  ON orders(created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id         SERIAL PRIMARY KEY,
  order_id   INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id) ON DELETE SET NULL,
  service_id INT REFERENCES services(id) ON DELETE SET NULL,
  name       VARCHAR(160) NOT NULL,   -- copied at order time so later edits don't change old orders
  unit       VARCHAR(30),
  price      NUMERIC(10,2) NOT NULL,
  qty        INT NOT NULL CHECK (qty > 0),
  line_total NUMERIC(10,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);

-- Tracking timeline (filled by a trigger on every status change).
CREATE TABLE IF NOT EXISTS order_events (
  id         BIGSERIAL PRIMARY KEY,
  order_id   INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     VARCHAR(20) NOT NULL,
  note       TEXT,
  actor_id   INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events(order_id, created_at);

-- Agent money: earnings/bonus add to the wallet, payouts take from it.
-- cod_collected / cod_deposited track cash-on-delivery money the agent is holding for the company.
CREATE TABLE IF NOT EXISTS agent_wallet (
  id         BIGSERIAL PRIMARY KEY,
  agent_id   INT NOT NULL REFERENCES agents(user_id) ON DELETE CASCADE,
  type       VARCHAR(20) NOT NULL CHECK (type IN ('earning', 'bonus', 'payout', 'cod_collected', 'cod_deposited')),
  amount     NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  order_id   INT REFERENCES orders(id) ON DELETE SET NULL,
  note       TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_wallet_agent_idx ON agent_wallet(agent_id, created_at DESC);

-- ============ service types (skills) ============
-- Every service has one type; every agent has one or more. Orders only go to agents with the matching type,
-- e.g. "Plumber on Demand" (plumbing) is only offered to plumbing agents.
CREATE TABLE IF NOT EXISTS service_types (
  code        VARCHAR(30) PRIMARY KEY,
  name        VARCHAR(60) NOT NULL,
  agent_title VARCHAR(40) NOT NULL,          -- what customers see: "Your plumber", "Your delivery partner"
  icon        VARCHAR(10),
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true
);

-- skill_code is back-filled by setup.js for existing rows, then made NOT NULL.
ALTER TABLE services ADD COLUMN IF NOT EXISTS skill_code VARCHAR(30) REFERENCES service_types(code) ON UPDATE CASCADE;
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS skill_code VARCHAR(30) REFERENCES service_types(code) ON UPDATE CASCADE;
ALTER TABLE agents   ADD COLUMN IF NOT EXISTS skills TEXT[] NOT NULL DEFAULT '{delivery}';
CREATE INDEX IF NOT EXISTS orders_skill_idx ON orders(skill_code) WHERE status = 'placed';
CREATE INDEX IF NOT EXISTS agents_skills_idx ON agents USING gin (skills);

-- ============ live GPS ============
-- Latest position of each agent (sent by the agent app while online).
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_lat         NUMERIC(9,6);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_lng         NUMERIC(9,6);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_accuracy_m  INT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ;

-- Exact delivery point when the customer shares it at checkout (otherwise the area centre is used).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dest_lat NUMERIC(9,6);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dest_lng NUMERIC(9,6);

-- Short movement history, for the path drawn on the maps. Old points are pruned automatically.
CREATE TABLE IF NOT EXISTS agent_location_trail (
  id          BIGSERIAL PRIMARY KEY,
  agent_id    INT NOT NULL REFERENCES agents(user_id) ON DELETE CASCADE,
  order_id    INT REFERENCES orders(id) ON DELETE SET NULL,
  lat         NUMERIC(9,6) NOT NULL,
  lng         NUMERIC(9,6) NOT NULL,
  accuracy_m  INT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trail_agent_idx ON agent_location_trail(agent_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS trail_order_idx ON agent_location_trail(order_id, recorded_at);
