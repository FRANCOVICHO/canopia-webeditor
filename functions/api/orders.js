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

export async function onRequestPost({ request, env }) {
  const payload = await request.json().catch(() => null);
  if (!payload?.items?.length) {
    return Response.json({ error: "El carrito esta vacio." }, { status: 400, headers: corsHeaders });
  }

  const customerName = String(payload.customer?.name || "").trim();
  const customerPhone = String(payload.customer?.phone || "").trim();
  const customerNote = String(payload.customer?.note || "").trim();

  if (!customerName || !customerPhone) {
    return Response.json({ error: "Falta nombre o telefono." }, { status: 400, headers: corsHeaders });
  }

  const items = payload.items
    .map((item) => ({
      id: String(item.id || "").trim(),
      quantity: Math.max(1, Number(item.quantity || 1)),
    }))
    .filter((item) => item.id);

  if (!items.length) {
    return Response.json({ error: "El carrito esta vacio." }, { status: 400, headers: corsHeaders });
  }

  const ids = items.map((item) => item.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results: products } = await env.canopia_db
    .prepare(`SELECT id, name, price, stock FROM products WHERE id IN (${placeholders}) AND visible = 1`)
    .bind(...ids)
    .all();

  const productMap = new Map(products.map((product) => [product.id, product]));
  const enrichedItems = [];
  let total = 0;

  for (const item of items) {
    const product = productMap.get(item.id);
    if (!product) {
      return Response.json({ error: `Producto no disponible: ${item.id}` }, { status: 400, headers: corsHeaders });
    }
    if (product.stock < item.quantity) {
      return Response.json(
        { error: `Stock insuficiente para ${product.name}. Disponible: ${product.stock}` },
        { status: 409, headers: corsHeaders },
      );
    }
    const subtotal = product.price * item.quantity;
    total += subtotal;
    enrichedItems.push({
      id: product.id,
      name: product.name,
      price: product.price,
      quantity: item.quantity,
      subtotal,
    });
  }

  const statements = enrichedItems.map((item) =>
    env.canopia_db
      .prepare("UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stock >= ?")
      .bind(item.quantity, item.id, item.quantity),
  );

  statements.push(
    env.canopia_db
      .prepare(
        `INSERT INTO orders (customer_name, customer_phone, customer_note, total, items_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(customerName, customerPhone, customerNote, total, JSON.stringify(enrichedItems)),
  );

  await env.canopia_db.batch(statements);

  return Response.json(
    {
      ok: true,
      total,
      items: enrichedItems,
      customer: { name: customerName, phone: customerPhone, note: customerNote },
    },
    { headers: corsHeaders },
  );
}
