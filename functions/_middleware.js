// Middleware para canopia-webeditor
//
// IMPORTANTE — patrón correcto para Cloudflare Pages Functions:
//
//   ❌  new Response(response.body, { status, headers: newHeaders })
//       → reconstruye el objeto desde cero. Puede sobreescribir el
//         Content-Type del handler (ej: application/json del upload),
//         corromper el body stream si ya fue parcialmente consumido,
//         y causar 502 en respuestas grandes o de subida de archivos.
//
//   ✅  new Response(response.body, response)
//       → copia status + statusText + headers originales del handler,
//         luego se mutan solo los headers de CORS/seguridad necesarios.
//         El body stream se transfiere sin buffering adicional.
//
// Referencia: https://developers.cloudflare.com/pages/how-to/add-custom-http-headers/

const ALLOWED_ORIGINS = [
  "https://canopia-webeditor.pages.dev",
  // Agregá tu dominio personalizado aquí si lo tenés configurado
];

export async function onRequest(context) {
  const { request, env, next } = context;

  const origin  = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  // Headers de CORS y seguridad que se agregan/sobreescriben en TODA respuesta.
  // Estos se aplican ENCIMA de lo que el handler devuelva — no lo reemplazan.
  const securityHeaders = {
    "Access-Control-Allow-Origin":      allowed,
    "Access-Control-Allow-Methods":     "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":     "Content-Type, x-admin-password, ADMIN_TOKEN, Authorization, Cf-Access-Jwt-Assertion",
    "Access-Control-Allow-Credentials": "true",
    "Strict-Transport-Security":        "max-age=31536000; includeSubDomains; preload",
    "X-Frame-Options":                  "DENY",
    "X-Content-Type-Options":           "nosniff",
  };

  // Preflight CORS — responder directamente sin pasar al handler
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: securityHeaders });
  }

  // Trace ID para correlacionar logs (NO se asigna a request — es inmutable)
  const traceId = request.headers.get("cf-ray") || crypto.randomUUID();

  // Session timeout: el frontend envía X-Last-Active con el timestamp de
  // última actividad. Si pasaron más de 30 minutos, rechazamos el request.
  const lastActive = request.headers.get("X-Last-Active");
  if (lastActive) {
    const elapsed = Date.now() - Number(lastActive);
    if (elapsed > 30 * 60 * 1000) {
      return new Response(
        JSON.stringify({ error: "Sesión expirada por inactividad." }),
        {
          status: 401,
          headers: { ...securityHeaders, "Content-Type": "application/json" },
        }
      );
    }
  }

  // Ejecutar el handler de la ruta
  let response;
  try {
    response = await next();
  } catch (err) {
    // Excepción no capturada en el handler → 500 con JSON legible
    console.error("[middleware] Excepción no capturada:", err.message, err.stack);
    return new Response(
      JSON.stringify({ error: err.message, traceId }),
      {
        status: 500,
        headers: { ...securityHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // ── Agregar headers de CORS/seguridad a la respuesta del handler ──────────
  //
  // Patrón correcto (documentación oficial Cloudflare):
  //   1. new Response(response.body, response)
  //      → clona status + statusText + todos los headers originales del handler
  //      → transfiere el body stream sin buffering adicional
  //   2. newResponse.headers.set(...)
  //      → muta solo los headers que queremos agregar/sobreescribir
  //
  // Esto preserva el Content-Type del handler (application/json, etc.)
  // y no toca el body stream, lo que evita el 502 en respuestas de upload.
  const newResponse = new Response(response.body, response);

  for (const [key, value] of Object.entries(securityHeaders)) {
    newResponse.headers.set(key, value);
  }

  return newResponse;
}
