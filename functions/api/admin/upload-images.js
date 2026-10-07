/**
 * POST /api/admin/upload-images
 *
 * Recibe uno o varios archivos (multipart/form-data, campo "files"),
 * los valida y los sube al bucket "product-images" de Supabase Storage.
 * Devuelve las URLs públicas al frontend.
 *
 * Variables de entorno requeridas (Cloudflare Pages → Settings → Variables):
 *   SUPABASE_URL              → ej: https://xyzxyz.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY → service_role JWT (marcar como Encrypted)
 *
 * La service role key NUNCA llega al frontend.
 */

import { assertAdmin } from "./_auth.js";
import { logAuditEvent } from "./_log.js";

// ── Configuración ──────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const BUCKET        = "product-images";
const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

// ── Inferir MIME por extensión cuando file.type llega vacío ────────────────
// Safari iOS y drag desde Windows Explorer no siempre populan file.type.
function mimeFromFilename(filename) {
  const ext = String(filename || "").split(".").pop().toLowerCase();
  const map  = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
  return map[ext] || "";
}

function resolveFileMime(file) {
  return (file.type || "").toLowerCase() || mimeFromFilename(file.name);
}

// ── Generar nombre único para evitar colisiones ────────────────────────────
function generateFilename(originalName, mime) {
  const extMap = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp" };
  const ext    = extMap[mime] || originalName.split(".").pop().toLowerCase() || "jpg";
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
      { error: "SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configurados en Cloudflare Pages → Settings → Environment Variables." },
      { status: 500 }
    );
  }

  // Parsear multipart/form-data
  let formData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.error("[upload] Error parseando FormData:", err.message);
    return Response.json(
      { error: "No se pudo leer el formulario. Verificá que el Content-Type sea multipart/form-data." },
      { status: 400 }
    );
  }

  const files = formData.getAll("files");
  if (!files || files.length === 0) {
    return Response.json({ error: "No se enviaron archivos. El campo debe llamarse 'files'." }, { status: 400 });
  }

  // ── LOG DIAGNÓSTICO TEMPORAL ──────────────────────────────────────────
  console.log("[upload-diag] files.length:", files.length);
  files.forEach((f, i) => {
    console.log(`[upload-diag] files[${i}]:`, {
      typeof:    typeof f,
      toString:  Object.prototype.toString.call(f),
      constructor: f?.constructor?.name ?? "null",
      name:      f?.name,
      size:      f?.size,
      type:      f?.type,
    });
  });
  // ─────────────────────────────────────────────────────────────────────

  const results  = []; // { url, filename, original }
  const failures = []; // { filename, error }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    // Duck-typing — instanceof File falla en Cloudflare Workers runtime
    const isFilelike =
      file !== null &&
      typeof file === "object" &&
      typeof file.name        === "string" &&
      typeof file.size        === "number" &&
      typeof file.arrayBuffer === "function";

    if (!isFilelike) {
      console.warn(`[upload] Imagen ${i + 1}: no es un archivo — typeof="${typeof file}"`);
      failures.push({ filename: String(file), error: "Se esperaba un archivo." });
      continue;
    }

    const originalName = file.name || `imagen-${i + 1}`;
    const mimeType     = resolveFileMime(file);
    const sizeKB       = Math.round(file.size / 1024);

    console.log(`[upload] ${i + 1}/${files.length}: name="${originalName}" mime="${mimeType}" ${sizeKB} KB`);

    // ── Validaciones ──────────────────────────────────────────────────────
    if (!ALLOWED_TYPES.has(mimeType)) {
      failures.push({ filename: originalName, error: `Formato no permitido: ${mimeType || originalName.split(".").pop()}. Solo JPG, PNG o WEBP.` });
      continue;
    }
    if (file.size > MAX_FILE_SIZE) {
      failures.push({ filename: originalName, error: `Supera el límite de ${MAX_FILE_SIZE / 1024 / 1024} MB.` });
      continue;
    }
    if (file.size === 0) {
      failures.push({ filename: originalName, error: "El archivo está vacío." });
      continue;
    }

    // ── Leer bytes ────────────────────────────────────────────────────────
    let arrayBuffer;
    try {
      arrayBuffer = await file.arrayBuffer();
    } catch (err) {
      failures.push({ filename: originalName, error: `No se pudo leer el archivo: ${err.message}` });
      continue;
    }

    // ── Subir a Supabase Storage ──────────────────────────────────────────
    const uniqueName = generateFilename(originalName, mimeType);

    try {
      const url = await uploadToSupabase({
        buffer:      arrayBuffer,
        filename:    uniqueName,
        mimeType,
        supabaseUrl: SUPABASE_URL,
        serviceKey:  SUPABASE_KEY,
        bucket:      BUCKET,
      });
      console.log(`[upload] "${originalName}" → ${url}`);
      results.push({ url, filename: uniqueName, original: originalName, ok: true });
    } catch (err) {
      console.error(`[upload] "${originalName}": error —`, err.message);
      failures.push({ filename: originalName, error: err.message });
    }
  }

  // Audit log — no bloquea si D1 falla
  try {
    await logAuditEvent(
      env, request, "UPLOAD_IMAGES",
      `supabase:${BUCKET}`,
      null,
      { uploaded: results.length, failed: failures.length, files: results.map((r) => r.filename) }
    );
  } catch (logErr) {
    console.warn("[upload] Audit log falló:", logErr.message);
  }

  console.log(`[upload] Finalizado: ${results.length} subidas, ${failures.length} errores`);

  return Response.json({
    ok:       results.length > 0,
    uploaded: results.length,
    failed:   failures.length,
    urls:     results.map((r) => r.url),
    results,
    failures,
  });
}

// ── Subir un archivo a Supabase Storage ───────────────────────────────────
// Usa la REST API de Storage directamente (sin SDK) para no añadir
// dependencias externas incompatibles con el runtime de Cloudflare Workers.
//
// Endpoint: PUT /storage/v1/object/{bucket}/{filename}
// Auth: Authorization: Bearer <service_role_key>
// Docs: https://supabase.com/docs/reference/javascript/storage-from-upload
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
      throw new Error("SUPABASE_SERVICE_ROLE_KEY inválida o sin permisos en el bucket product-images.");
    }
    if (response.status === 404) {
      throw new Error(`Bucket "${bucket}" no encontrado. Crealo en Supabase Dashboard → Storage.`);
    }
    if (response.status === 409) {
      throw new Error(`Conflicto: el archivo "${filename}" ya existe. Esto no debería ocurrir con nombres únicos.`);
    }
    throw new Error(`Supabase Storage respondió ${response.status}: ${msg}`);
  }

  // URL pública del bucket (el bucket debe estar configurado como público)
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${filename}`;
}
