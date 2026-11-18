const encoder = new TextEncoder();
export const PUBLIC_ACCOUNT = 'id,username,name,phone,email,zone,vehicle,active,can_update_status,can_view_phone,session_hours,version';
export const ADMIN_ACCOUNT = `${PUBLIC_ACCOUNT},notes,access_key,created_at,updated_at`;
export function dbFor(env) {
  if (!env.canopia_db) throw new Error('COURIER_CONFIGURATION');
  return env.canopia_db.withSession?.('first-primary') || env.canopia_db;
}
export function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
export function failure(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export function configuration(env) {
  if (typeof env.COURIER_SECRET !== 'string' || env.COURIER_SECRET.length < 32) throw new Error('COURIER_CONFIGURATION');
}
export function errorResponse(error) {
  if (error.status) return json({ error: error.message }, error.status);
  // Never return SQL, credentials, addresses or stack traces to the browser.
  console.error('Courier operation unavailable', error.message === 'COURIER_CONFIGURATION' ? 'configuration' : 'storage');
  return json({ error: 'Repartidores no está disponible. Revisá la configuración y la migración antes de usarlo.' }, 503);
}
export async function bodyJson(request) {
  const origin = request.headers.get('Origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') failure('Origen no permitido.', 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) failure('Se requiere JSON.', 415);
  if (Number(request.headers.get('Content-Length') || 0) > 20000) failure('Formulario demasiado grande.', 413);
  const raw = await request.text();
  if (raw.length > 20000) failure('Formulario demasiado grande.', 413);
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch { /* handled below */ }
  failure('Formulario inválido.');
}
export function field(body, key, max, required = false) {
  const value = body[key] === undefined ? '' : body[key];
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) failure(`Revisá el campo ${key}.`);
  return value.trim();
}
export function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join(''); }
export async function digest(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), n => n.toString(16).padStart(2,'0')).join(''); }
function equal(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
async function derive(password, salt, secret) {
  // The pepper protects password hashes independently of a database export.
  const pepperKey = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const peppered = await crypto.subtle.sign('HMAC', pepperKey, encoder.encode(password));
  const key = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100000 }, key, 256);
  return Array.from(new Uint8Array(bits), n => n.toString(16).padStart(2,'0')).join('');
}
export async function hashPassword(password, env) {
  configuration(env);
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) failure('La contraseña debe tener entre 12 y 128 caracteres.');
  const salt = randomToken();
  return `pbkdf2-sha256$100000$${salt}$${await derive(password, salt, env.COURIER_SECRET)}`;
}
export async function verifyPassword(password, stored, env) {
  const parts = (stored || '').split('$');
  const valid = parts.length === 4 && parts[0] === 'pbkdf2-sha256' && parts[1] === '100000';
  const actual = await derive(password, valid ? parts[2] : 'unregistered-courier-dummy-salt', env.COURIER_SECRET);
  return valid && equal(actual, parts[3]);
}
export function cookies(request) {
  return Object.fromEntries((request.headers.get('Cookie') || '').split(';').map(s => s.trim().split('=')).filter(([k]) => k));
}
export function cookie(request, name, value, seconds) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; SameSite=Strict${secure}`;
}
export async function getSession(request, db) {
  const token = cookies(request).canopia_courier_session;
  if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
  return db.prepare(`SELECT c.* FROM couriers c JOIN courier_sessions s ON s.courier_id=c.id
    WHERE s.token_hash=? AND s.expires_at>? AND c.active=1`).bind(await digest(token), Date.now()).first();
}
export function publicAccount(account) { return Object.fromEntries(PUBLIC_ACCOUNT.split(',').map(key => [key, account[key]])); }
export function assertChanged(db) { return db.prepare('SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END AS changed'); }
export async function atomic(db, statements) {
  try { return await db.batch(statements); }
  catch(error) { if (/integer overflow/i.test(error.message)) failure('Los datos cambiaron. Actualizá antes de guardar.',409); throw error; }
}
export function deliveryEvent(db, id, actor, action, before, after, note='') {
  return db.prepare('INSERT INTO delivery_events (delivery_id,actor,action,old_status,new_status,note) VALUES (?,?,?,?,?,?)').bind(id,actor,action,before,after,note);
}
export const statuses = ['pendiente','en_camino','entregado','no_entregado','cancelado'];
