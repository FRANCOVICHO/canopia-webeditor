export function assertAdmin(request, env) {
  const expected = env.ADMIN_PASSWORD;
  const password = request.headers.get("x-admin-password") || "";
  if (!expected || password !== expected) {
    return Response.json({ error: "No autorizado." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return null;
}
