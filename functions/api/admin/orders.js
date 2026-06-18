import { assertAdmin } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  const denied = assertAdmin(request, env);
  if (denied) return denied;

  const { results } = await env.canopia_db
    .prepare(
      `SELECT id, customer_name, customer_phone, customer_note, total, status, items_json, created_at
       FROM orders
       ORDER BY id DESC
       LIMIT 80`,
    )
    .all();

  return Response.json({ orders: results });
}
