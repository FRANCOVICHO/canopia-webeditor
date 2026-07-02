import { assertAdmin } from "./_auth.js";

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

  if (!id || !["confirm", "reject"].includes(action)) {
    return Response.json({ error: "Accion o ID invalido." }, { status: 400 });
  }

  // Fetch the order
  const order = await env.canopia_db
    .prepare("SELECT id, status, items_json FROM orders WHERE id = ?")
    .bind(id)
    .first();

  if (!order) return Response.json({ error: "Pedido no encontrado." }, { status: 404 });
  if (order.status !== "pendiente") {
    return Response.json({ error: `El pedido ya fue ${order.status}.` }, { status: 409 });
  }

  if (action === "reject") {
    await env.canopia_db
      .prepare("UPDATE orders SET status = 'rechazado' WHERE id = ?")
      .bind(id)
      .run();
    return Response.json({ ok: true, status: "rechazado" });
  }

  // action === "confirm" → discount stock atomically
  const items = JSON.parse(order.items_json || "[]");

  const statements = items.map((item) =>
    env.canopia_db
      .prepare("UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stock >= ?")
      .bind(item.quantity, item.id, item.quantity),
  );

  statements.push(
    env.canopia_db
      .prepare("UPDATE orders SET status = 'confirmado' WHERE id = ?")
      .bind(id),
  );

  await env.canopia_db.batch(statements);

  return Response.json({ ok: true, status: "confirmado" });
}
