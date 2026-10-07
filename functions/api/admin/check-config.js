/**
 * GET /api/admin/check-config
 *
 * Verifica que las variables de entorno de Supabase estén configuradas
 * y que la conexión al bucket sea válida.
 *
 * Nunca devuelve el valor de la service role key.
 */

import { assertAdmin } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  const denied = assertAdmin(request, env);
  if (denied) return denied;

  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  const BUCKET       = "product-images";

  const checks = [];

  // ── 1. SUPABASE_URL ────────────────────────────────────────────────────
  if (!SUPABASE_URL) {
    checks.push({
      key:     "SUPABASE_URL",
      status:  "missing",
      message: "No configurada. Ir a Cloudflare Pages → Settings → Environment Variables.",
    });
  } else {
    const isValidUrl = SUPABASE_URL.startsWith("https://") && SUPABASE_URL.includes(".supabase.co");
    checks.push({
      key:     "SUPABASE_URL",
      status:  isValidUrl ? "ok" : "warning",
      message: isValidUrl
        ? `Configurada: ${SUPABASE_URL}`
        : `Valor inusual: "${SUPABASE_URL}". Debería ser https://<project>.supabase.co`,
    });
  }

  // ── 2. SUPABASE_SERVICE_ROLE_KEY ───────────────────────────────────────
  if (!SUPABASE_KEY) {
    checks.push({
      key:     "SUPABASE_SERVICE_ROLE_KEY",
      status:  "missing",
      message: "No configurada. Agregar como variable Encrypted en Cloudflare Pages → Settings → Environment Variables → Production.",
    });
  } else {
    checks.push({
      key:     "SUPABASE_SERVICE_ROLE_KEY",
      status:  "ok",
      message: "Configurada (valor oculto por seguridad).",
    });
  }

  // ── 3. Verificar acceso real al bucket ─────────────────────────────────
  // Supabase Storage requiere AMBOS headers: Authorization y apikey.
  // Sin apikey la API devuelve 400 aunque el token sea válido.
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, {
        headers: {
          Authorization:  `Bearer ${SUPABASE_KEY}`,
          apikey:          SUPABASE_KEY,
          "Content-Type": "application/json",
        },
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        checks.push({
          key:     "bucket",
          status:  "ok",
          message: `Bucket "${BUCKET}" accesible. Público: ${data.public ? "sí ✓" : "no — configurarlo como público en Supabase Dashboard → Storage → product-images → Policies → New policy → Allow public read"}.`,
          public:  data.public,
        });
      } else if (res.status === 404) {
        checks.push({
          key:     "bucket",
          status:  "error",
          message: `Bucket "${BUCKET}" no existe. Crearlo en Supabase Dashboard → Storage → New bucket → nombre: product-images → Public.`,
        });
      } else if (res.status === 401 || res.status === 403) {
        checks.push({
          key:     "bucket",
          status:  "error",
          message: "Sin permisos para acceder al bucket. Verificar que la service role key sea la correcta (Supabase Dashboard → Settings → API → service_role).",
        });
      } else {
        const body = await res.json().catch(() => ({}));
        checks.push({
          key:     "bucket",
          status:  "error",
          message: `Supabase respondió HTTP ${res.status}: ${body.message || body.error || "sin detalle"}.`,
        });
      }
    } catch (err) {
      checks.push({
        key:     "bucket",
        status:  "error",
        message: `No se pudo conectar con Supabase: ${err.message}`,
      });
    }
  }

  // ── 4. ADMIN_PASSWORD ──────────────────────────────────────────────────
  checks.push({
    key:     "ADMIN_PASSWORD",
    status:  env.ADMIN_PASSWORD ? "ok" : "warning",
    message: env.ADMIN_PASSWORD
      ? "Configurada como variable de entorno."
      : "Usando contraseña hardcodeada. Recomendado: configurarla como variable Encrypted.",
  });

  // ── Resultado global ───────────────────────────────────────────────────
  const hasErrors  = checks.some((c) => c.status === "error");
  const hasMissing = checks.some((c) => c.status === "missing");
  const allOk      = !hasErrors && !hasMissing;

  return Response.json({
    ok:      allOk,
    status:  hasErrors ? "error" : hasMissing ? "incomplete" : "ok",
    summary: allOk
      ? `✓ Supabase configurado correctamente. Las imágenes se subirán al bucket "${BUCKET}".`
      : hasErrors
        ? "✕ Hay errores de configuración. Las subidas a Supabase fallarán."
        : "⚠ Configuración incompleta.",
    checks,
    storage: {
      url:        SUPABASE_URL || null,
      bucket:     BUCKET,
      publicBase: SUPABASE_URL ? `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/` : null,
    },
  });
}
