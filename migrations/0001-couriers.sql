-- Apply ONCE to the shared canopia-db before deploying either application.
-- Additive and repeatable: does not change sales, customers or stock.
CREATE TABLE IF NOT EXISTS couriers (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  zone TEXT NOT NULL DEFAULT '',
  vehicle TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  can_update_status INTEGER NOT NULL DEFAULT 1 CHECK(can_update_status IN (0,1)),
  can_view_phone INTEGER NOT NULL DEFAULT 1 CHECK(can_view_phone IN (0,1)),
  session_hours INTEGER NOT NULL DEFAULT 12 CHECK(session_hours BETWEEN 1 AND 24),
  password_hash TEXT NOT NULL,
  access_key TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS courier_sessions (
  token_hash TEXT PRIMARY KEY,
  courier_id TEXT NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS courier_sessions_expiry ON courier_sessions(expires_at);
CREATE INDEX IF NOT EXISTS courier_sessions_account ON courier_sessions(courier_id);
CREATE TABLE IF NOT EXISTS courier_login_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS courier_limits_expiry ON courier_login_limits(expires_at);
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  order_id INTEGER UNIQUE REFERENCES orders(id),
  courier_id TEXT NOT NULL REFERENCES couriers(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  contents TEXT NOT NULL DEFAULT '',
  collect_cents INTEGER NOT NULL DEFAULT 0 CHECK(collect_cents >= 0),
  payment_method TEXT NOT NULL DEFAULT 'pagado' CHECK(payment_method IN ('pagado','efectivo','transferencia')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','urgente')),
  scheduled_at TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK(status IN ('pendiente','en_camino','entregado','no_entregado','cancelado')),
  result_note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS deliveries_courier_status ON deliveries(courier_id,status,created_at);
CREATE TABLE IF NOT EXISTS delivery_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS delivery_events_delivery ON delivery_events(delivery_id,id);
