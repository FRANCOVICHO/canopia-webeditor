const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-password, ADMIN_TOKEN",
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// ── Parsear el campo image (string URL o JSON array serializado) ───────────
function parseImages(raw) {
  if (!raw) return [];
  const s = String(raw).trim();
  if (s.startsWith("[")) {
    try { return JSON.parse(s).filter(Boolean); } catch { return [s]; }
  }
  return s ? [s] : [];
}

function mapProduct(row) {
  const images = parseImages(row.image);
  return {
    id:          row.id,
    name:        row.name,
    category:    row.category,
    description: row.description,
    price:       row.price,
    tag:         row.tag,
    // image = primera URL o el valor original — mantener para backward compat
    image:       images[0] || row.image || "",
    // images[] = array completo ya parseado, nunca undefined
    images,
    featured:    Boolean(row.featured),
    visible:     Boolean(row.visible),
    stock:       row.stock,
    updated_at:  row.updated_at,
  };
}

async function getCatalogMeta(env) {
  const row = await env.canopia_db
    .prepare("SELECT MAX(updated_at) AS updatedAt FROM products")
    .first();
  return row?.updatedAt || null;
}

export async function onRequestGet({ env }) {
  const query = `SELECT id, name, category, description, price, tag, image, featured, visible, stock, updated_at
                 FROM products
                 WHERE visible = 1
                 ORDER BY featured DESC, name ASC`;

  const { results } = await env.canopia_db.prepare(query).all();

  return Response.json(
    {
      products:  results.map(mapProduct),
      updatedAt: await getCatalogMeta(env),
    },
    {
      headers: {
        ...corsHeaders,
        "Cache-Control": "no-store",
      },
    },
  );
}
