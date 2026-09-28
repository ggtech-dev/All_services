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
