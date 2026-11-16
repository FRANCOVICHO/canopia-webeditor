import { assertAdmin } from "./_auth.js";
import { changePendingOrder } from "../../_lib/order-integrity.js";
import { logAuditEvent } from "./_log.js";

// GET /api/admin/orders?status=pendiente   → filtra por estado
// GET /api/admin/orders                    → todos (últimos 100)
export async function onRequestGet({ request, env }) {
  const denied = assertAdmin(request, env);
  if (denied) return denied;

  const status = new URL(request.url).searchParams.get("status");

  const query = status
    ? `SELECT id, customer_name, customer_phone, customer_note, total, status, items_json, created_at
       FROM orders WHERE status = ? ORDER BY id DESC LIMIT 100`
    : `SELECT id, customer_name, customer_phone, customer_note, total, status, items_json, created_at
       FROM orders ORDER BY id DESC LIMIT 100`;

  const { results } = status
    ? await env.canopia_db.prepare(query).bind(status).all()
    : await env.canopia_db.prepare(query).all();

  return Response.json({ orders: results });
}

// POST /api/admin/orders?action=confirm    → descuenta stock y confirma
// POST /api/admin/orders?action=reject     → rechaza sin tocar stock
export async function onRequestPost({ request, env }) {
  const denied = assertAdmin(request, env);
  if (denied) return denied;

  const action = new URL(request.url).searchParams.get("action");
  const body   = await request.json().catch(() => null);
  const id     = Number(body?.id);

  if (!Number.isSafeInteger(id) || id < 1 || !["confirm", "reject"].includes(action)) {
    return Response.json({ error: "Accion o ID invalido." }, { status: 400 });
  }

  // Fetch the order
  const order = await env.canopia_db
    .prepare("SELECT * FROM orders WHERE id = ?")
    .bind(id)
    .first();

  if (!order) return Response.json({ error: "Pedido no encontrado." }, { status: 404 });
  if (order.status !== "pendiente") {
    return Response.json({ error: `El pedido ya fue ${order.status}.` }, { status: 409 });
  }

  const finalStatus = action === "confirm" ? "confirmado" : "rechazado";
  if (!await changePendingOrder(env.canopia_db, order, finalStatus)) {
    return Response.json({ error: "El pedido cambió de estado o ya no hay stock suficiente." }, { status: 409 });
  }

  const newRecord = await env.canopia_db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  await logAuditEvent(env, request, `ORDER_${action.toUpperCase()}`, `orders:${id}`, order, newRecord);

  return Response.json({ ok: true, status: finalStatus });
}
