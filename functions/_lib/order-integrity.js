const maxLines = 40;
const maxQuantity = 999;

export function cartItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > maxLines) return null;

  const totals = new Map();
  for (const item of items) {
    if (typeof item?.id !== "string" || !item.id.trim() || item.id.length > 256) return null;
    const id = item.id.trim();
    const quantity = typeof item.quantity === "string" && /^\d+$/.test(item.quantity)
      ? Number(item.quantity) : item.quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 1) return null;
    const total = (totals.get(id) || 0) + quantity;
    if (total > maxQuantity) return null;
    totals.set(id, total);
  }
  return [...totals].map(([id, quantity]) => ({ id, quantity }));
}

export async function changePendingOrder(db, order, status) {
  const id = order.id;
  if (status === "rechazado") {
    const result = await db.prepare("UPDATE orders SET status = ? WHERE id = ? AND status = 'pendiente'")
      .bind(status, id).run();
    return result.meta.changes === 1;
  }

  let items;
  try { items = cartItems(JSON.parse(order.items_json)); } catch { return false; }
  if (!items) return false;

  // An UPDATE of zero rows succeeds in SQLite. Force an error in that case
  // so D1 rolls back the entire batch, including every prior stock deduction.
  const assertChanged = () => db.prepare(
    "SELECT CASE WHEN changes() = 1 THEN 1 ELSE abs(-9223372036854775808) END AS updated"
  );
  const statements = [
    db.prepare("UPDATE orders SET status = 'confirmado' WHERE id = ? AND status = 'pendiente'").bind(id),
    assertChanged(),
  ];
  for (const { id: productId, quantity } of items) {
    statements.push(
      db.prepare("UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stock >= ?")
        .bind(quantity, productId, quantity),
      assertChanged(),
    );
  }

  try {
    await db.batch(statements);
    return true;
  } catch (error) {
    if (/integer overflow/i.test(error.message)) return false;
    throw error;
  }
}
