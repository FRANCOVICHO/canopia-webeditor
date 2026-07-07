// Middleware para canopia-webeditor

const ALLOWED_ORIGINS = [
  "https://canopia-webeditor.pages.dev",
  // Agrega tu dominio personalizado aquí
];

export async function onRequest(context) {
  const { request, env, next } = context;
  const origin = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const corsHeaders = {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-password, ADMIN_TOKEN, Authorization, Cf-Access-Jwt-Assertion",
    "Access-Control-Allow-Credentials": "true",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // 1. Cloudflare Access Validation (Placeholder)
  // Cuando actives Cloudflare Access, el header Cf-Access-Jwt-Assertion estará presente.
  // const accessJwt = request.headers.get("Cf-Access-Jwt-Assertion");
  // if (env.ENFORCE_ACCESS && !accessJwt) {
  //   return new Response("Unauthorized", { status: 401 });
  // }

  // 2. Trace ID / Request ID
  const traceId = request.headers.get("cf-ray") || crypto.randomUUID();
  request.traceId = traceId;

  // 3. Session Timeout
  // Leemos la fecha de la última actividad enviada desde el front.
  // Si pasó más de 30 minutos (1800000 ms), rechazamos.
  const lastActive = request.headers.get("X-Last-Active");
  if (lastActive) {
    const elapsed = Date.now() - Number(lastActive);
    if (elapsed > 30 * 60 * 1000) {
      return Response.json({ error: "Sesión expirada por inactividad." }, { status: 401, headers: corsHeaders });
    }
  }

  try {
    const response = await next();
    const newHeaders = new Headers(response.headers);
    for (const [k, v] of Object.entries(corsHeaders)) {
      newHeaders.set(k, v);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  } catch (err) {
    return Response.json({ error: err.message, traceId }, { status: 500, headers: corsHeaders });
  }
}
