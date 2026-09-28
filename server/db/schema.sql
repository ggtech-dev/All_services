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
