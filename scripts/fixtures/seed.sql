-- Demo users, roles and objects for the harness and screenshots.
--   psql postgres://postgres:pw@localhost:5432/postgres -f scripts/fixtures/seed.sql
-- Drops and recreates everything it makes; roles are cluster-wide.

DROP SCHEMA IF EXISTS app CASCADE;
DROP SCHEMA IF EXISTS reporting CASCADE;
DO $$
DECLARE r text;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN
    ('app_owner', 'app_readers', 'app_writers', 'analysts', 'alice', 'bob', 'carol', 'dave', 'service_api', 'ci_deploy', 'legacy_report')
  LOOP
    EXECUTE format('DROP OWNED BY %I', r);
    EXECUTE format('DROP ROLE %I', r);
  END LOOP;
END $$;

CREATE ROLE app_owner NOLOGIN;
COMMENT ON ROLE app_owner IS 'Owns the application schema';
CREATE ROLE app_readers NOLOGIN;
COMMENT ON ROLE app_readers IS 'Read-only access to app';
CREATE ROLE app_writers NOLOGIN;
COMMENT ON ROLE app_writers IS 'Can change application data';
CREATE ROLE analysts NOLOGIN;
COMMENT ON ROLE analysts IS 'Reporting and analytics team';

CREATE ROLE alice LOGIN PASSWORD 'alice-pw' CONNECTION LIMIT 10;
COMMENT ON ROLE alice IS 'Alice Chen, data analyst';
CREATE ROLE bob LOGIN NOINHERIT PASSWORD 'bob-pw';
COMMENT ON ROLE bob IS 'Bob, support engineer';
CREATE ROLE carol LOGIN PASSWORD 'carol-pw' VALID UNTIL '2024-01-01';
COMMENT ON ROLE carol IS 'Contractor (ended)';
CREATE ROLE dave LOGIN;
CREATE ROLE service_api LOGIN PASSWORD 'api-pw' CONNECTION LIMIT 20;
COMMENT ON ROLE service_api IS 'Backend API service';
CREATE ROLE ci_deploy LOGIN CREATEROLE CREATEDB PASSWORD 'deploy-pw';
COMMENT ON ROLE ci_deploy IS 'Runs migrations from CI';
SET password_encryption = 'md5';
CREATE ROLE legacy_report LOGIN PASSWORD 'legacy-pw';
RESET password_encryption;
COMMENT ON ROLE legacy_report IS 'Old reporting tool';

GRANT app_readers TO analysts;
GRANT analysts TO alice;
GRANT app_writers TO bob;
GRANT app_readers TO service_api;
GRANT app_writers TO service_api;
GRANT app_owner TO ci_deploy;
GRANT analysts TO legacy_report;

CREATE SCHEMA app AUTHORIZATION app_owner;
CREATE SCHEMA reporting AUTHORIZATION app_owner;
SET ROLE app_owner;
CREATE TABLE app.customers (id serial PRIMARY KEY, name text NOT NULL, email text, created_at timestamptz DEFAULT now());
CREATE TABLE app.orders (id serial PRIMARY KEY, customer_id int REFERENCES app.customers, status text, total numeric(10, 2));
CREATE TABLE app.invoices (id serial PRIMARY KEY, order_id int REFERENCES app.orders, region text, amount numeric(10, 2));
CREATE TABLE app.audit_log (id bigserial PRIMARY KEY, actor text, action text, at timestamptz DEFAULT now());
CREATE VIEW app.open_orders AS SELECT * FROM app.orders WHERE status = 'open';
CREATE FUNCTION app.order_total(order_id int) RETURNS numeric LANGUAGE sql STABLE AS 'SELECT total FROM app.orders WHERE id = order_id';
CREATE MATERIALIZED VIEW reporting.daily_revenue AS SELECT date_trunc('day', now()) AS day, sum(total) AS revenue FROM app.orders;

GRANT USAGE ON SCHEMA app TO app_readers, app_writers;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO app_readers;
REVOKE SELECT ON app.audit_log FROM app_readers;
GRANT INSERT, UPDATE, DELETE ON app.customers, app.orders, app.invoices TO app_writers;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA app TO app_writers;
GRANT INSERT ON app.audit_log TO app_writers;
GRANT SELECT (id, actor, action) ON app.audit_log TO bob;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO app_readers;
GRANT USAGE ON SCHEMA reporting TO analysts;
GRANT SELECT ON reporting.daily_revenue TO analysts;

ALTER TABLE app.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY eu_only ON app.invoices FOR SELECT TO analysts USING (region = 'eu');
RESET ROLE;

ALTER ROLE alice SET search_path = reporting, app, public;
ALTER ROLE alice SET statement_timeout = '30s';
ALTER ROLE service_api SET idle_in_transaction_session_timeout = '60s';

INSERT INTO app.customers (name, email) VALUES ('Ann', 'ann@example.com'), ('Ben', 'ben@example.com');
INSERT INTO app.orders (customer_id, status, total) VALUES (1, 'open', 120), (2, 'paid', 80);
