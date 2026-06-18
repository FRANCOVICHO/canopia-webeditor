export function assertAdmin(request, env) {
  const expected = env.ADMIN_PASSWORD || "CanopiaAdmin2026!";
  const password = request.headers.get("x-admin-password") || "";
  if (password !== expected) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  return null;
}
