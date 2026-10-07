/**
 * POST /api/admin/upload-images
 *
 * Recibe UN archivo por request como JSON:
 *   { name: string, type: string, size: number, data: number[] }
 *
 * El campo "data" es un Array.from(new Uint8Array(buffer)) serializado.
 * Este enfoque evita el parser multipart de Cloudflare Workers, que
 * convierte partes sin filename a string en lugar de File.
 *
 * Variables de entorno requeridas:
 *   SUPABASE_URL              → https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY → service_role JWT (Encrypted)
 *
 * La service role key NUNCA llega al frontend.
 */

import { assertAdmin } from "./_auth.js";
import { logAuditEvent } from "./_log.js";

// ── Configuración ──────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const BUCKET        = "product-images";
const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

// ── Inferir MIME por extensión cuando type llega vacío ─────────────────────
function mimeFromFilename(filename) {
  const ext = String(filename || "").split(".").pop().toLowerCase();
  const map  = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
  return map[ext] || "";
}

function resolveFileMime(name, type) {
  return (type || "").toLowerCase() || mimeFromFilename(name);
}

// ── Generar nombre único ───────────────────────────────────────────────────
function generateFilename(originalName, mime) {
  const extMap = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp" };
  const ext    = extMap[mime] || String(originalName).split(".").pop().toLowerCase() || "jpg";
  const now    = new Date();
  const date   = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time   = now.toISOString().slice(11, 19).replace(/:/g, "");
  const rand   = Math.random().toString(36).slice(2, 8);
  return `producto-${date}-${time}-${rand}.${ext}`;
}

// ── Handler principal ──────────────────────────────────────────────────────
export async function onRequestPost({ request, env }) {
  const denied = assertAdmin(request, env);
  if (denied) return denied;

  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return Response.json(
      { error: "SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configurados." },
      { status: 500 }
    );
  }

  // Parsear JSON
  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return Response.json(
      { error: "No se pudo parsear el JSON del request." },
      { status: 400 }
    );
  }

  const { name: originalName, type: declaredType, size: declaredSize, data: byteArray } = payload;

  // Validar campos obligatorios
  if (!originalName || !Array.isArray(byteArray) || byteArray.length === 0) {
    return Response.json(
      { error: "Faltan campos requeridos: name, data (array de bytes)." },
      { status: 400 }
    );
  }

  const mimeType = resolveFileMime(originalName, declaredType);
  const sizeKB   = Math.round(byteArray.length / 1024);

  console.log(`[upload] name="${originalName}" mime="${mimeType}" ${sizeKB} KB`);

  // Validaciones
  if (!ALLOWED_TYPES.has(mimeType)) {
    return Response.json({
      ok: false, uploaded: 0, failed: 1, urls: [],
      failures: [{ filename: originalName, error: `Formato no permitido: ${mimeType || originalName.split(".").pop()}. Solo JPG, PNG o WEBP.` }],
    });
  }

  if (byteArray.length > MAX_FILE_SIZE) {
    return Response.json({
      ok: false, uploaded: 0, failed: 1, urls: [],
      failures: [{ filename: originalName, error: `Supera el límite de ${MAX_FILE_SIZE / 1024 / 1024} MB.` }],
    });
  }

  // Reconstruir ArrayBuffer desde el array de bytes
  const uint8 = new Uint8Array(byteArray);
  const buffer = uint8.buffer;

  // Subir a Supabase Storage
  const uniqueName = generateFilename(originalName, mimeType);

  let url;
  try {
    url = await uploadToSupabase({
      buffer,
      filename:    uniqueName,
      mimeType,
      supabaseUrl: SUPABASE_URL,
      serviceKey:  SUPABASE_KEY,
      bucket:      BUCKET,
    });
    console.log(`[upload] "${originalName}" → ${url}`);
  } catch (err) {
    console.error(`[upload] "${originalName}": error —`, err.message);

    try {
      await logAuditEvent(env, request, "UPLOAD_IMAGE_FAILED", `supabase:${BUCKET}`, null,
        { filename: originalName, error: err.message });
    } catch { /* silencioso */ }

    return Response.json({
      ok: false, uploaded: 0, failed: 1, urls: [],
      failures: [{ filename: originalName, error: err.message }],
    });
  }

  // Audit log
  try {
    await logAuditEvent(env, request, "UPLOAD_IMAGE", `supabase:${BUCKET}`, null,
      { filename: uniqueName, original: originalName });
  } catch { /* silencioso */ }

  return Response.json({
    ok:       true,
    uploaded: 1,
    failed:   0,
    urls:     [url],
    results:  [{ url, filename: uniqueName, original: originalName, ok: true }],
    failures: [],
  });
}

// ── Subir a Supabase Storage vía REST ─────────────────────────────────────
async function uploadToSupabase({ buffer, filename, mimeType, supabaseUrl, serviceKey, bucket }) {
  const endpoint = `${supabaseUrl}/storage/v1/object/${bucket}/${filename}`;

  const response = await fetch(endpoint, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${serviceKey}`,
      apikey:          serviceKey,
      "Content-Type": mimeType,
      "x-upsert":     "false",
    },
    body: buffer,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const msg  = body.error || body.message || `HTTP ${response.status}`;

    if (response.status === 401 || response.status === 403) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY inválida o sin permisos en el bucket.");
    }
    if (response.status === 404) {
      throw new Error(`Bucket "${bucket}" no encontrado. Crealo en Supabase Dashboard → Storage.`);
    }
    if (response.status === 409) {
      throw new Error(`El archivo "${filename}" ya existe. Esto no debería ocurrir con nombres únicos.`);
    }
    throw new Error(`Supabase Storage respondió ${response.status}: ${msg}`);
  }

  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${filename}`;
}
