-- Email OTP login, forgot password and email verification. Re-runnable.
-- Codes are generated and hashed in Node (crypto); the database only ever sees the hash.
-- Error codes as elsewhere: 22023 = validation (400), 55000 = conflict / locked (409), P0002 = not found (404).

CREATE TABLE IF NOT EXISTS auth_otps (
  id           BIGSERIAL PRIMARY KEY,
  email        VARCHAR(120) NOT NULL,          -- lower-cased address the code was sent to
  purpose      VARCHAR(20)  NOT NULL CHECK (purpose IN ('login', 'reset', 'verify_email')),
  user_id      INT REFERENCES users(id) ON DELETE CASCADE,
  code_hash    CHAR(64)     NOT NULL,          -- sha256 hex of (email, purpose, code, server secret)
  attempts     INT          NOT NULL DEFAULT 0,
  max_attempts INT          NOT NULL DEFAULT 5,
  expires_at   TIMESTAMPTZ  NOT NULL,
  consumed_at  TIMESTAMPTZ,
  request_ip   VARCHAR(64),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_otps_lookup_idx ON auth_otps (email, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_otps_ip_idx ON auth_otps (request_ip, created_at DESC);

-- Security log: logins, failed attempts, codes sent, password changes.
CREATE TABLE IF NOT EXISTS auth_audit_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  email      VARCHAR(120),
  event      VARCHAR(40) NOT NULL,
  detail     TEXT,
  ip         VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_audit_created_idx ON auth_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS auth_audit_user_idx ON auth_audit_log (user_id, created_at DESC);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at   TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
-- One account per email address (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_valid_email(p_email TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(p_email, '') ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' AND length(p_email) <= 120
$$;

CREATE OR REPLACE PROCEDURE sp_auth_log(p_user_id INT, p_email TEXT, p_event TEXT, p_detail TEXT, p_ip TEXT)
LANGUAGE sql SET search_path FROM CURRENT AS $$
  INSERT INTO auth_audit_log (user_id, email, event, detail, ip)
  VALUES (p_user_id, lower(p_email), p_event, p_detail, p_ip);
$$;

-- Asks for a new code.
--   login / reset:  finds the account by email. If there is none, returns user_id NULL (the API still says
--                   "if this email is registered, we sent a code" so it never reveals who has an account).
--   verify_email:   p_user_id is the logged-in user who wants to use p_email; it must not belong to someone else.
-- Rate limits: 30 s between codes and 5 per hour per email, 20 per hour per IP.
-- Any earlier unused code for the same email + purpose stops working.
CREATE OR REPLACE FUNCTION fn_otp_request(
  p_email TEXT, p_purpose TEXT, p_code_hash TEXT, p_user_id INT, p_ip TEXT, p_ttl_minutes INT DEFAULT 10
) RETURNS TABLE (otp_id BIGINT, user_id INT, full_name TEXT, role TEXT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_email TEXT := lower(trim(coalesce(p_email, '')));
  v_user  users;
  v_last  TIMESTAMPTZ;
  v_id    BIGINT;
BEGIN
  IF NOT fn_valid_email(v_email) THEN
    RAISE EXCEPTION 'Enter a valid email address' USING ERRCODE = '22023';
  END IF;
  IF p_purpose NOT IN ('login', 'reset', 'verify_email') THEN
    RAISE EXCEPTION 'Unknown code type' USING ERRCODE = '22023';
  END IF;

  SELECT max(o.created_at) INTO v_last FROM auth_otps o WHERE o.email = v_email AND o.purpose = p_purpose;
  IF v_last > now() - interval '30 seconds' THEN
    RAISE EXCEPTION 'Please wait % seconds before asking for another code',
      ceil(30 - extract(epoch FROM now() - v_last))::int USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM auth_otps o WHERE o.email = v_email AND o.created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Too many codes requested for this email. Try again in an hour.' USING ERRCODE = '55000';
  END IF;
  IF p_ip IS NOT NULL AND (SELECT count(*) FROM auth_otps o WHERE o.request_ip = p_ip AND o.created_at > now() - interval '1 hour') >= 20 THEN
    RAISE EXCEPTION 'Too many requests. Try again later.' USING ERRCODE = '55000';
  END IF;

  IF p_purpose = 'verify_email' THEN
    SELECT * INTO v_user FROM users u WHERE u.id = p_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Account not found' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = v_email AND u.id <> p_user_id) THEN
      RAISE EXCEPTION 'This email is already used by another account' USING ERRCODE = '55000';
    END IF;
  ELSE
    SELECT * INTO v_user FROM users u WHERE lower(u.email) = v_email;
  END IF;

  UPDATE auth_otps o SET consumed_at = now()
   WHERE o.email = v_email AND o.purpose = p_purpose AND o.consumed_at IS NULL;

  INSERT INTO auth_otps (email, purpose, user_id, code_hash, expires_at, request_ip)
  VALUES (v_email, p_purpose, v_user.id, p_code_hash, now() + make_interval(mins => p_ttl_minutes), p_ip)
  RETURNING id INTO v_id;

  CALL sp_auth_log(v_user.id, v_email, 'otp_requested',
    p_purpose || CASE WHEN v_user.id IS NULL THEN ' (no account with this email)' ELSE '' END, p_ip);

  RETURN QUERY SELECT v_id, v_user.id, v_user.full_name::text, v_user.role::text;
END $$;

-- Checks a code. Wrong codes count towards the limit; after 5 the code is locked.
-- On success the code is used up, the email is marked verified and the user row is returned.
-- The wrong-code count must survive the error, so this function returns a status instead of raising for it.
CREATE OR REPLACE FUNCTION fn_otp_check(p_email TEXT, p_purpose TEXT, p_code_hash TEXT, p_ip TEXT)
RETURNS TABLE (status TEXT, user_id INT, attempts_left INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_email TEXT := lower(trim(coalesce(p_email, '')));
  o auth_otps;
BEGIN
  SELECT * INTO o FROM auth_otps a
   WHERE a.email = v_email AND a.purpose = p_purpose AND a.consumed_at IS NULL
   ORDER BY a.created_at DESC LIMIT 1
   FOR UPDATE;

  IF NOT FOUND OR o.user_id IS NULL THEN
    CALL sp_auth_log(NULL, v_email, 'otp_failed', p_purpose || ': no active code', p_ip);
    RETURN QUERY SELECT 'no_code'::text, NULL::int, 0;
    RETURN;
  END IF;
  IF o.expires_at < now() THEN
    UPDATE auth_otps SET consumed_at = now() WHERE id = o.id;
    RETURN QUERY SELECT 'expired'::text, NULL::int, 0;
    RETURN;
  END IF;
  IF o.attempts >= o.max_attempts THEN
    RETURN QUERY SELECT 'locked'::text, NULL::int, 0;
    RETURN;
  END IF;

  IF o.code_hash <> p_code_hash THEN
    UPDATE auth_otps SET attempts = attempts + 1 WHERE id = o.id;
    CALL sp_auth_log(o.user_id, v_email, 'otp_failed', p_purpose || ': wrong code', p_ip);
    RETURN QUERY SELECT CASE WHEN o.attempts + 1 >= o.max_attempts THEN 'locked' ELSE 'wrong' END,
                        NULL::int, o.max_attempts - o.attempts - 1;
    RETURN;
  END IF;

  UPDATE auth_otps SET consumed_at = now(), attempts = attempts + 1 WHERE id = o.id;
  IF p_purpose = 'verify_email' THEN
    UPDATE users SET email = v_email, email_verified_at = now() WHERE id = o.user_id;
  ELSE
    UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = o.user_id;
  END IF;
  CALL sp_auth_log(o.user_id, v_email, 'otp_verified', p_purpose, p_ip);
  RETURN QUERY SELECT 'ok'::text, o.user_id, o.max_attempts - o.attempts - 1;
END $$;

-- Sets a new password (after a verified reset code, or a correct current password — checked in the API).
CREATE OR REPLACE PROCEDURE sp_set_password(p_user_id INT, p_password_hash TEXT, p_reason TEXT, p_ip TEXT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_email TEXT;
BEGIN
  UPDATE users SET password_hash = p_password_hash, password_changed_at = now() WHERE id = p_user_id
  RETURNING email INTO v_email;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found' USING ERRCODE = 'P0002';
  END IF;
  -- Any other outstanding reset codes for this account stop working.
  UPDATE auth_otps SET consumed_at = now() WHERE user_id = p_user_id AND purpose = 'reset' AND consumed_at IS NULL;
  CALL sp_auth_log(p_user_id, v_email, 'password_changed', p_reason, p_ip);
END $$;

-- Housekeeping: codes older than a day are deleted, audit entries are kept for a year.
CREATE OR REPLACE PROCEDURE sp_auth_cleanup()
LANGUAGE sql SET search_path FROM CURRENT AS $$
  DELETE FROM auth_otps WHERE created_at < now() - interval '1 day';
  DELETE FROM auth_audit_log WHERE created_at < now() - interval '365 days';
$$;

-- ============ sign-up with email verification ============
-- The account is only created after the code sent to the email is entered.
-- Until then the sign-up details (with the already-hashed password) wait in auth_otps.payload.
ALTER TABLE auth_otps ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE auth_otps DROP CONSTRAINT IF EXISTS auth_otps_purpose_check;
ALTER TABLE auth_otps ADD CONSTRAINT auth_otps_purpose_check CHECK (purpose IN ('login', 'reset', 'verify_email', 'register'));

-- Step 1: check the details and store a code. Username / email already taken → clear error, no code sent.
CREATE OR REPLACE FUNCTION fn_register_start(
  p_username TEXT, p_email TEXT, p_password_hash TEXT, p_full_name TEXT, p_phone TEXT, p_code_hash TEXT, p_ip TEXT
) RETURNS BIGINT
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_email TEXT := lower(trim(coalesce(p_email, '')));
  v_user  TEXT := lower(trim(coalesce(p_username, '')));
  v_last  TIMESTAMPTZ;
  v_id    BIGINT;
BEGIN
  IF v_user !~ '^[a-z0-9_.]{3,30}$' THEN
    RAISE EXCEPTION 'Username must be 3-30 letters, numbers, _ or .' USING ERRCODE = '22023';
  END IF;
  IF NOT fn_valid_email(v_email) THEN
    RAISE EXCEPTION 'Enter a valid email address' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE username = v_user) THEN
    RAISE EXCEPTION 'That username is already taken' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE lower(email) = v_email) THEN
    RAISE EXCEPTION 'An account with this email already exists. Try logging in with an email code.' USING ERRCODE = '55000';
  END IF;

  SELECT max(created_at) INTO v_last FROM auth_otps WHERE email = v_email AND purpose = 'register';
  IF v_last > now() - interval '30 seconds' THEN
    RAISE EXCEPTION 'Please wait % seconds before asking for another code',
      ceil(30 - extract(epoch FROM now() - v_last))::int USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM auth_otps WHERE email = v_email AND created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Too many codes requested for this email. Try again in an hour.' USING ERRCODE = '55000';
  END IF;
  IF p_ip IS NOT NULL AND (SELECT count(*) FROM auth_otps WHERE request_ip = p_ip AND created_at > now() - interval '1 hour') >= 20 THEN
    RAISE EXCEPTION 'Too many requests. Try again later.' USING ERRCODE = '55000';
  END IF;

  UPDATE auth_otps SET consumed_at = now() WHERE email = v_email AND purpose = 'register' AND consumed_at IS NULL;
  INSERT INTO auth_otps (email, purpose, code_hash, expires_at, request_ip, payload)
  VALUES (v_email, 'register', p_code_hash, now() + interval '10 minutes', p_ip,
          jsonb_build_object('username', v_user, 'password_hash', p_password_hash,
                             'full_name', nullif(trim(p_full_name), ''), 'phone', nullif(trim(p_phone), '')))
  RETURNING id INTO v_id;
  CALL sp_auth_log(NULL, v_email, 'otp_requested', 'register', p_ip);
  RETURN v_id;
END $$;

-- Step 2: check the code and create the account (email already verified). Returns a status and the new user id.
CREATE OR REPLACE FUNCTION fn_register_complete(p_email TEXT, p_code_hash TEXT, p_ip TEXT)
RETURNS TABLE (status TEXT, user_id INT, attempts_left INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_email TEXT := lower(trim(coalesce(p_email, '')));
  o auth_otps;
  v_id INT;
BEGIN
  SELECT * INTO o FROM auth_otps a
   WHERE a.email = v_email AND a.purpose = 'register' AND a.consumed_at IS NULL
   ORDER BY a.created_at DESC LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'no_code'::text, NULL::int, 0; RETURN;
  END IF;
  IF o.expires_at < now() THEN
    UPDATE auth_otps SET consumed_at = now() WHERE id = o.id;
    RETURN QUERY SELECT 'expired'::text, NULL::int, 0; RETURN;
  END IF;
  IF o.attempts >= o.max_attempts THEN
    RETURN QUERY SELECT 'locked'::text, NULL::int, 0; RETURN;
  END IF;
  IF o.code_hash <> p_code_hash THEN
    UPDATE auth_otps SET attempts = attempts + 1 WHERE id = o.id;
    CALL sp_auth_log(NULL, v_email, 'otp_failed', 'register: wrong code', p_ip);
    RETURN QUERY SELECT CASE WHEN o.attempts + 1 >= o.max_attempts THEN 'locked' ELSE 'wrong' END,
                        NULL::int, o.max_attempts - o.attempts - 1;
    RETURN;
  END IF;

  -- Someone may have taken the username / email while the code was pending.
  IF EXISTS (SELECT 1 FROM users WHERE username = o.payload->>'username') THEN
    UPDATE auth_otps SET consumed_at = now() WHERE id = o.id;
    RETURN QUERY SELECT 'username_taken'::text, NULL::int, 0; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE lower(email) = v_email) THEN
    UPDATE auth_otps SET consumed_at = now() WHERE id = o.id;
    RETURN QUERY SELECT 'email_taken'::text, NULL::int, 0; RETURN;
  END IF;

  INSERT INTO users (username, password_hash, full_name, phone, email, email_verified_at)
  VALUES (o.payload->>'username', o.payload->>'password_hash', o.payload->>'full_name', o.payload->>'phone', v_email, now())
  RETURNING id INTO v_id;
  UPDATE auth_otps SET consumed_at = now(), attempts = attempts + 1, user_id = v_id, payload = NULL WHERE id = o.id;
  CALL sp_auth_log(v_id, v_email, 'registered', 'email verified by code', p_ip);
  RETURN QUERY SELECT 'ok'::text, v_id, 0;
END $$;
