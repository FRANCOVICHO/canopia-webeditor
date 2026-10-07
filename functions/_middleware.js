// Middleware para canopia-webeditor
//
// Patrón correcto para Cloudflare Pages Functions:
//
//   ❌  new Response(response.body, { status, headers: newHeaders })
//       → reconstruye el objeto desde cero, puede sobreescribir el
//         Content-Type del handler y corromper el body stream.
//
//   ✅  new Response(response.body, response)
//       → copia status + statusText + headers originales del handler,
//         luego se mutan solo los headers de CORS/seguridad necesarios.
//
// Referencia: https://developers.cloudflare.com/pages/how-to/add-custom-http-headers/

const ALLOWED_ORIGINS = [
  "https://canopia-webeditor.pages.dev",
  // Agregá tu dominio personalizado aquí si lo tenés configurado
];

export async function onRequest(context) {
  const { request, next } = context;

  const origin  = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const securityHeaders = {
    "Access-Control-Allow-Origin":      allowed,
    "Access-Control-Allow-Methods":     "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":     "Content-Type, x-admin-password, ADMIN_TOKEN, Authorization, Cf-Access-Jwt-Assertion",
    "Access-Control-Allow-Credentials": "true",
    "Strict-Transport-Security":        "max-age=31536000; includeSubDomains; preload",
    "X-Frame-Options":                  "DENY",
    "X-Content-Type-Options":           "nosniff",
  };

  // Preflight CORS
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: securityHeaders });
  }

  // Trace ID para logs (solo en catch — no se asigna al Request inmutable)
  const traceId = request.headers.get("cf-ray") || crypto.randomUUID();

  // Session timeout: el frontend envía X-Last-Active con el timestamp de
  // última actividad. Si pasaron más de 30 minutos, rechazamos el request.
  const lastActive = request.headers.get("X-Last-Active");
  if (lastActive) {
    const elapsed = Date.now() - Number(lastActive);
    if (elapsed > 30 * 60 * 1000) {
      return new Response(
        JSON.stringify({ error: "Sesión expirada por inactividad." }),
        { status: 401, headers: { ...securityHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // Ejecutar el handler de la ruta
  let response;
  try {
    response = await next();
  } catch (err) {
    console.error("[middleware] Excepción no capturada:", err.message);
    return new Response(
      JSON.stringify({ error: err.message, traceId }),
      { status: 500, headers: { ...securityHeaders, "Content-Type": "application/json" } }
    );
  }

  // Clonar la respuesta del handler y agregar headers de seguridad encima.
  // new Response(body, response) preserva status + statusText + todos los
  // headers originales del handler (Content-Type, etc.) sin tocarlos.
  const newResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(securityHeaders)) {
    newResponse.headers.set(key, value);
  }

  return newResponse;
}
