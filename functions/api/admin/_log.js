// Helper para guardar logs de auditoría

export async function logAuditEvent(env, request, action, resource, oldValue, newValue) {
  try {
    await env.canopia_db.prepare(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT,
        ip TEXT,
        action TEXT,
        resource TEXT,
        old_value TEXT,
        new_value TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    const traceId = request.traceId || request.headers.get("cf-ray") || "unknown";
    const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";

    await env.canopia_db.prepare(`
      INSERT INTO audit_logs (trace_id, ip, action, resource, old_value, new_value)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      traceId,
      ip,
      action,
      resource,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null
    ).run();
  } catch (err) {
    // Falla de log no debería romper el flujo principal
    console.error("Error al guardar audit log:", err);
  }
}

// Helper para sanitizar strings (prevenir XSS)
export function sanitizeHtml(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/on\w+="[^"]*"/gi, "")
    .replace(/on\w+='[^']*'/gi, "")
    .replace(/on\w+=\w+/gi, "")
    .replace(/javascript:/gi, "");
}
