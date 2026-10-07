import { assertAdmin } from "./_auth.js";
import { logAuditEvent, sanitizeHtml } from "./_log.js";

/**
 * Campos que se leen de la base de datos.
 * El campo "image" almacena: string URL simple O JSON array de URLs.
 * El frontend siempre envía el campo "image" serializado (string o JSON array).
 * Así mantenemos compatibilidad total con productos existentes.
 */
const productFields = `
  id, name, category, description, price, tag, image, featured, visible, stock, updated_at
`;

// ── Migración transparente: convierte imageUrl → images[0] si viene del legacy ──
function normalizeImageField(product) {
  // Si el cliente envió explícitamente "images" (array), serializamos como JSON
  if (Array.isArray(product.images)) {
    const clean = product.images.map((u) => String(u).trim()).filter(Boolean);
    if (clean.length === 0) return "";
    if (clean.length === 1) return clean[0];
    return JSON.stringify(clean);
  }

  // Soporte legacy: si vino "imageUrl" (campo antiguo) lo convertimos
  if (product.imageUrl && !product.image) {
    return String(product.imageUrl).trim();
  }

  // Campo "image" ya viene serializado correctamente desde el frontend
  return String(product.image || "").trim();
}

export async function onRequestGet({ request, env }) {
  const denied = assertAdmin(request, env);
  if (denied) return denied;

  const { results } = await env.canopia_db
    .prepare(`SELECT ${productFields} FROM products ORDER BY visible DESC, name ASC`)
    .all();

  return Response.json({
    products: results.map((product) => ({
      ...product,
      featured: Boolean(product.featured),
      visible:  Boolean(product.visible),
      // Exponer también el array parsed para clientes modernos
      images: parseImagesServer(product.image),
    })),
  });
}

export async function onRequestPost({ request, env }) {
  const denied = assertAdmin(request, env);
  if (denied) return denied;

  const product = await request.json().catch(() => null);
  const id          = String(product?.id || "").trim();
  const name        = String(product?.name || "").trim();
  const category    = sanitizeHtml(String(product?.category || "").trim());
  const description = sanitizeHtml(String(product?.description || "").trim());

  if (!id || !name || !category) {
    return Response.json({ error: "Faltan ID, nombre o categoria." }, { status: 400 });
  }

  const imageValue = normalizeImageField(product);
  const oldRecord  = await env.canopia_db
    .prepare("SELECT * FROM products WHERE id = ?")
    .bind(id)
    .first();

  await env.canopia_db
    .prepare(
      `INSERT INTO products
        (id, name, category, description, price, tag, image, featured, visible, stock, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
        name        = excluded.name,
        category    = excluded.category,
        description = excluded.description,
        price       = excluded.price,
        tag         = excluded.tag,
        image       = excluded.image,
        featured    = excluded.featured,
        visible     = excluded.visible,
        stock       = excluded.stock,
        updated_at  = CURRENT_TIMESTAMP`,
    )
    .bind(
      id,
      name,
      category,
      description,
      Math.max(0, Number(product.price || 0)),
      sanitizeHtml(String(product.tag || "Producto").trim()),
      imageValue,
      product.featured ? 1 : 0,
      product.visible === false ? 0 : 1,
      Math.max(0, Number(product.stock || 0)),
    )
    .run();

  const newRecord = await env.canopia_db
    .prepare("SELECT * FROM products WHERE id = ?")
    .bind(id)
    .first();

  await logAuditEvent(
    env, request,
    oldRecord ? "UPDATE_PRODUCT" : "CREATE_PRODUCT",
    `products:${id}`,
    oldRecord,
    newRecord
  );

  return Response.json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  const denied = assertAdmin(request, env);
  if (denied) return denied;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Falta ID." }, { status: 400 });

  const oldRecord = await env.canopia_db
    .prepare("SELECT * FROM products WHERE id = ?")
    .bind(id)
    .first();

  await env.canopia_db
    .prepare("DELETE FROM products WHERE id = ?")
    .bind(id)
    .run();

  await logAuditEvent(env, request, "DELETE_PRODUCT", `products:${id}`, oldRecord, null);

  return Response.json({ ok: true });
}

// ── Helper server-side: igual que parseImages en frontend ─────────────────
function parseImagesServer(raw) {
  if (!raw) return [];
  const s = String(raw).trim();
  if (s.startsWith("[")) {
    try { return JSON.parse(s).filter(Boolean); } catch { return [s]; }
  }
  return [s];
}
