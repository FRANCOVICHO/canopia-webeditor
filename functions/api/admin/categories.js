import { assertAdmin } from "./_auth.js";
import { logAuditEvent, sanitizeHtml } from "./_log.js";

export async function onRequestGet({ request, env }) {
  const denied = assertAdmin(request, env);
  if (denied) return denied;

  const { results } = await env.canopia_db
    .prepare("SELECT name, description, sort_order FROM categories ORDER BY sort_order ASC, name ASC")
    .all();

  return Response.json({ categories: results });
}

export async function onRequestPost({ request, env }) {
  const denied = assertAdmin(request, env);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const name = sanitizeHtml(String(body?.name || "").trim());
  const description = sanitizeHtml(String(body?.description || "").trim());
  const sort_order = Number(body?.sort_order || 0);

  if (!name) return Response.json({ error: "Falta el nombre." }, { status: 400 });

  const oldRecord = await env.canopia_db.prepare("SELECT * FROM categories WHERE name = ?").bind(name).first();

  await env.canopia_db
    .prepare(`
      INSERT INTO categories (name, description, sort_order)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        description = excluded.description,
        sort_order  = excluded.sort_order
    `)
    .bind(name, description, sort_order)
    .run();

  const newRecord = await env.canopia_db.prepare("SELECT * FROM categories WHERE name = ?").bind(name).first();
  await logAuditEvent(env, request, oldRecord ? "UPDATE_CATEGORY" : "CREATE_CATEGORY", `categories:${name}`, oldRecord, newRecord);

  return Response.json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  const denied = assertAdmin(request, env);
  if (denied) return denied;

  const name = new URL(request.url).searchParams.get("name");
  if (!name) return Response.json({ error: "Falta el nombre." }, { status: 400 });

  const oldRecord = await env.canopia_db.prepare("SELECT * FROM categories WHERE name = ?").bind(name).first();

  await env.canopia_db.prepare("DELETE FROM categories WHERE name = ?").bind(name).run();

  await logAuditEvent(env, request, "DELETE_CATEGORY", `categories:${name}`, oldRecord, null);

  return Response.json({ ok: true });
}
