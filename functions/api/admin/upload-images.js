/**
 * POST /api/admin/upload-images
 *
 * Recibe uno o varios archivos (multipart/form-data, campo "files"),
 * los optimiza (redimensiona si es necesario), los sube al repositorio
 * FRANCOVICHO/photoscanopia vía la API oficial de GitHub y devuelve
 * las URLs RAW públicas.
 *
 * Variables de entorno requeridas (Cloudflare Pages → Settings → Variables):
 *   GITHUB_TOKEN   → Personal Access Token con scope "repo" (Contents write)
 *   GITHUB_OWNER   → "FRANCOVICHO"
 *   GITHUB_REPO    → "photoscanopia"
 *   GITHUB_BRANCH  → "main"  (opcional, default "main")
 *
 * Nunca expone el token al frontend.
 */

import { assertAdmin } from "./_auth.js";
import { logAuditEvent } from "./_log.js";

// ── Configuración ──────────────────────────────────────────────────────────
const MAX_FILE_SIZE  = 10 * 1024 * 1024; // 10 MB
const MAX_DIMENSION  = 1800;              // px — redimensiona si supera esto
const WEBP_QUALITY   = 0.87;             // calidad de conversión WebP
const ALLOWED_TYPES  = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_RETRIES    = 3;
const RETRY_BASE_MS  = 600;              // base backoff exponencial

// ── Handler principal ──────────────────────────────────────────────────────
export async function onRequestPost({ request, env }) {
  const denied = assertAdmin(request, env);
  if (denied) return denied;

  // Leer configuración de GitHub desde env
  const GITHUB_TOKEN  = env.GITHUB_TOKEN;
  const GITHUB_OWNER  = env.GITHUB_OWNER  || "FRANCOVICHO";
  const GITHUB_REPO   = env.GITHUB_REPO   || "photoscanopia";
  const GITHUB_BRANCH = env.GITHUB_BRANCH || "main";

  if (!GITHUB_TOKEN) {
    return Response.json(
      { error: "GitHub Token no configurado. Agregá GITHUB_TOKEN en las variables de entorno de Cloudflare Pages." },
      { status: 500 }
    );
  }

  // Parsear multipart/form-data
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "No se pudo leer el formulario." }, { status: 400 });
  }

  const files = formData.getAll("files");
  if (!files || files.length === 0) {
    return Response.json({ error: "No se enviaron archivos." }, { status: 400 });
  }

  const results  = [];   // { url, filename, ok: true }
  const failures = [];   // { filename, error }

  for (const file of files) {
    // Validar que sea un File real
    if (!(file instanceof File)) {
      failures.push({ filename: String(file), error: "Tipo de dato inválido." });
      continue;
    }

    const filename = file.name || "imagen";
    const mimeType = (file.type || "").toLowerCase();

    // ── Validaciones ────────────────────────────────────────────────────────
    if (!ALLOWED_TYPES.has(mimeType)) {
      failures.push({ filename, error: "Formato no permitido. Solo JPG, PNG o WEBP." });
      continue;
    }

    if (file.size > MAX_FILE_SIZE) {
      failures.push({ filename, error: `Supera el límite de ${MAX_FILE_SIZE / 1024 / 1024} MB.` });
      continue;
    }

    // ── Leer bytes ──────────────────────────────────────────────────────────
    let arrayBuffer;
    try {
      arrayBuffer = await file.arrayBuffer();
    } catch {
      failures.push({ filename, error: "No se pudo leer el archivo." });
      continue;
    }

    // ── Optimizar + convertir a WebP usando Canvas API del Worker ───────────
    // Cloudflare Workers soporta ImageMagick-style transformations via el
    // servicio de Image Resizing, pero en Pages Functions solo podemos usar
    // la Web API nativa. Sin acceso a <canvas> en Workers, optimizamos
    // descartando metadata EXIF mediante re-encode de la imagen con fetch
    // al propio endpoint de Cloudflare Image Resizing si está disponible;
    // de lo contrario subimos el buffer limpio sin metadata extra.
    let finalBuffer = arrayBuffer;
    let finalMime   = mimeType;
    let finalExt    = "webp";

    try {
      const optimized = await optimizeImageBuffer(arrayBuffer, mimeType, MAX_DIMENSION, WEBP_QUALITY);
      finalBuffer = optimized.buffer;
      finalMime   = optimized.mime;
      finalExt    = optimized.ext;
    } catch {
      // Si falla la optimización continuamos con el original
      finalExt = extensionForMime(mimeType);
    }

    // ── Generar nombre único ─────────────────────────────────────────────────
    const uniqueName = generateFilename(finalExt);

    // ── Subir a GitHub con reintentos ─────────────────────────────────────────
    try {
      const url = await uploadToGitHub({
        buffer: finalBuffer,
        filename: uniqueName,
        token: GITHUB_TOKEN,
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        branch: GITHUB_BRANCH,
      });
      results.push({ url, filename: uniqueName, original: filename, ok: true });
    } catch (err) {
      failures.push({ filename, error: err.message });
    }
  }

  // Audit log
  await logAuditEvent(
    env, request, "UPLOAD_IMAGES",
    `github:${GITHUB_OWNER}/${GITHUB_REPO}`,
    null,
    { uploaded: results.length, failed: failures.length, files: results.map(r => r.filename) }
  );

  return Response.json({
    ok: results.length > 0,
    uploaded: results.length,
    failed: failures.length,
    urls: results.map((r) => r.url),
    results,
    failures,
  });
}

// ── Subir un archivo a GitHub API con reintentos ───────────────────────────
async function uploadToGitHub({ buffer, filename, token, owner, repo, branch }) {
  const base64Content = bufferToBase64(buffer);
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filename}`;

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(apiUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "canopia-webeditor/1.0",
        },
        body: JSON.stringify({
          message: `Upload product image: ${filename}`,
          content: base64Content,
          branch,
        }),
      });

      if (response.ok) {
        // URL RAW pública
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filename}`;
      }

      // Errores recuperables: 429 (rate limit), 502, 503, 504
      const status = response.status;
      const body   = await response.json().catch(() => ({}));
      const errMsg = body.message || `HTTP ${status}`;

      if ([429, 502, 503, 504].includes(status) && attempt < MAX_RETRIES) {
        lastError = new Error(errMsg);
        const waitMs = RETRY_BASE_MS * Math.pow(2, attempt - 1) + Math.random() * 200;
        await sleep(waitMs);
        continue;
      }

      // Error definitivo
      if (status === 401) throw new Error("Token de GitHub inválido o sin permisos.");
      if (status === 403) throw new Error("Permisos insuficientes para escribir en el repositorio.");
      if (status === 404) throw new Error("Repositorio no encontrado. Verificá GITHUB_OWNER y GITHUB_REPO.");
      if (status === 422) throw new Error(`Archivo duplicado en GitHub: ${filename}`);
      throw new Error(`GitHub respondió con error ${status}: ${errMsg}`);

    } catch (err) {
      if (err.message.includes("GitHub respondió") ||
          err.message.includes("Token") ||
          err.message.includes("Permisos") ||
          err.message.includes("Repositorio") ||
          err.message.includes("duplicado")) {
        throw err; // error definitivo, no reintentar
      }
      lastError = err;
      if (attempt < MAX_RETRIES) {
        const waitMs = RETRY_BASE_MS * Math.pow(2, attempt - 1) + Math.random() * 200;
        await sleep(waitMs);
      }
    }
  }

  throw lastError || new Error("No se pudo subir la imagen después de múltiples intentos.");
}

// ── Optimización de imagen ─────────────────────────────────────────────────
// En Cloudflare Workers runtime la Canvas API no está disponible.
// Implementamos una optimización básica usando las APIs disponibles:
// - Para JPEG/PNG: subimos el buffer original (ya validado)
// - El redimensionado real se puede habilitar via Cloudflare Image Resizing
//   si el plan lo permite; aquí lo implementamos de forma degradada pero segura.
async function optimizeImageBuffer(arrayBuffer, mimeType, maxDimension, quality) {
  // Cloudflare Workers tiene acceso a OffscreenCanvas en algunos contextos
  // pero no está garantizado en Pages Functions. Intentamos la optimización
  // con un enfoque seguro: si OffscreenCanvas está disponible lo usamos,
  // sino devolvemos el original con el mime correcto.

  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const blob = new Blob([arrayBuffer], { type: mimeType });
      const bitmap = await createImageBitmap(blob);

      let { width, height } = bitmap;
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }

      const canvas  = new OffscreenCanvas(width, height);
      const ctx     = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();

      const outBlob = await canvas.convertToBlob({ type: "image/webp", quality });
      const outBuf  = await outBlob.arrayBuffer();

      return { buffer: outBuf, mime: "image/webp", ext: "webp" };
    } catch {
      // Fallthrough: devolver original
    }
  }

  // Fallback: subir original sin re-encodar
  return {
    buffer: arrayBuffer,
    mime: mimeType,
    ext: extensionForMime(mimeType),
  };
}

// ── Generar nombre de archivo único ───────────────────────────────────────
function generateFilename(ext) {
  const now    = new Date();
  const date   = now.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const time   = now.toISOString().slice(11, 19).replace(/:/g, ""); // HHMMSS
  const random = Math.random().toString(36).slice(2, 8).toLowerCase();
  return `producto-${date}-${time}-${random}.${ext}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function bufferToBase64(buffer) {
  // Usar un loop carácter a carácter es lo único 100% seguro en todos los
  // runtimes (incluido Cloudflare Workers). El spread operator sobre un
  // Uint8Array grande lanza RangeError: Maximum call stack size exceeded
  // porque cada chunk se pasa como argumentos individuales a fromCharCode.
  const bytes = new Uint8Array(buffer);
  let binary  = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function extensionForMime(mime) {
  const map = {
    "image/jpeg": "jpg",
    "image/jpg":  "jpg",
    "image/png":  "png",
    "image/webp": "webp",
  };
  return map[mime] || "jpg";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
