/**
 * GET  /api/admin/migrate-images
 *   Escanea todos los productos y devuelve los que tienen imágenes
 *   en URLs temporales/legacy (PocketBase, trycloudflare, etc.).
 *
 * POST /api/admin/migrate-images
 *   Recibe { productId, imageUrl } y re-sube esa imagen a GitHub
 *   descargándola desde la URL original, luego actualiza el producto.
 *   Devuelve la nueva URL permanente.
 *
 * Nunca borra la imagen original hasta que el admin confirme.
 */

import { assertAdmin } from "./_auth.js";
import { logAuditEvent } from "./_log.js";

// ── Patrones de URLs legacy a detectar ────────────────────────────────────
// Ampliar esta lista si hay más orígenes temporales en el futuro.
const LEGACY_PATTERNS = [
  /trycloudflare\.com/i,
  /pocketbase/i,
  /localhost/i,
  /127\.0\.0\.1/i,
  /\.ngrok\.io/i,
  /\.ngrok-free\.app/i,
  /\.loca\.lt/i,          // localtunnel
  /\.serveo\.net/i,
];

function isLegacyUrl(url) {
  if (!url || typeof url !== "string") return false;
  return LEGACY_PATTERNS.some((re) => re.test(url));
}

function parseImages(raw) {
  if (!raw) return [];
  const s = String(raw).trim();
  if (s.startsWith("[")) {
    try { return JSON.parse(s).filter(Boolean); } catch { return [s]; }
  }
  return s ? [s] : [];
}

// ── GET — escanear productos con imágenes legacy ───────────────────────────
export async function onRequestGet({ request, env }) {
  const denied = assertAdmin(request, env);
  if (denied) return denied;

  const { results } = await env.canopia_db
    .prepare("SELECT id, name, image FROM products ORDER BY name ASC")
    .all();

  const flagged = [];

  for (const product of results) {
    const images = parseImages(product.image);
    const legacyImages = images.filter(isLegacyUrl);

    if (legacyImages.length > 0) {
      flagged.push({
        id:           product.id,
        name:         product.name,
        totalImages:  images.length,
        legacyImages,
        allImages:    images,
        // ¿Todas las imágenes son legacy o solo algunas?
        fullyLegacy:  legacyImages.length === images.length,
      });
    }
  }

  return Response.json({
    ok:        true,
    total:     results.length,
    flagged:   flagged.length,
    clean:     results.length - flagged.length,
    products:  flagged,
    summary:   flagged.length === 0
      ? "✓ Todos los productos usan URLs permanentes. No hay imágenes legacy."
      : `⚠ ${flagged.length} producto${flagged.length !== 1 ? "s" : ""} con ${flagged.reduce((s, p) => s + p.legacyImages.length, 0)} imagen${flagged.reduce((s, p) => s + p.legacyImages.length, 0) !== 1 ? "es" : ""} en URLs temporales.`,
  });
}

// ── POST — re-subir una imagen específica a GitHub ─────────────────────────
export async function onRequestPost({ request, env }) {
  const denied = assertAdmin(request, env);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const productId = String(body?.productId || "").trim();
  const oldUrl    = String(body?.imageUrl   || "").trim();

  if (!productId || !oldUrl) {
    return Response.json({ error: "Falta productId o imageUrl." }, { status: 400 });
  }

  const GITHUB_TOKEN  = env.GITHUB_TOKEN;
  const GITHUB_OWNER  = env.GITHUB_OWNER  || "FRANCOVICHO";
  const GITHUB_REPO   = env.GITHUB_REPO   || "photoscanopia";
  const GITHUB_BRANCH = env.GITHUB_BRANCH || "main";

  if (!GITHUB_TOKEN) {
    return Response.json(
      { error: "GITHUB_TOKEN no configurado. Configuralo en Cloudflare Pages → Settings → Environment Variables." },
      { status: 500 }
    );
  }

  // Verificar que el producto existe
  const product = await env.canopia_db
    .prepare("SELECT id, name, image FROM products WHERE id = ?")
    .bind(productId)
    .first();

  if (!product) {
    return Response.json({ error: `Producto "${productId}" no encontrado.` }, { status: 404 });
  }

  // Descargar la imagen desde la URL legacy
  let imageBuffer;
  let mimeType;
  try {
    const fetchRes = await fetch(oldUrl, {
      headers: { "User-Agent": "canopia-webeditor/1.0 (image migration)" },
      signal: AbortSignal.timeout(15000), // 15s timeout
    });

    if (!fetchRes.ok) {
      return Response.json(
        { error: `No se pudo descargar la imagen (HTTP ${fetchRes.status}). La URL puede estar caída.` },
        { status: 422 }
      );
    }

    mimeType    = (fetchRes.headers.get("Content-Type") || "image/jpeg").split(";")[0].trim().toLowerCase();
    imageBuffer = await fetchRes.arrayBuffer();

    if (imageBuffer.byteLength === 0) {
      return Response.json({ error: "La imagen descargada está vacía." }, { status: 422 });
    }
  } catch (err) {
    return Response.json(
      { error: `Error al descargar la imagen: ${err.message}` },
      { status: 422 }
    );
  }

  // Determinar extensión
  const extMap = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  const ext    = extMap[mimeType] || "jpg";

  // Generar nombre único
  const now    = new Date();
  const date   = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time   = now.toISOString().slice(11, 19).replace(/:/g, "");
  const random = Math.random().toString(36).slice(2, 8).toLowerCase();
  const filename = `producto-${date}-${time}-${random}.${ext}`;

  // Convertir a base64 (loop seguro, sin spread)
  const bytes  = new Uint8Array(imageBuffer);
  let binary   = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64Content = btoa(binary);

  // Subir a GitHub con hasta 3 reintentos
  let newUrl;
  let lastError;
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filename}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const ghRes = await fetch(apiUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "canopia-webeditor/1.0",
        },
        body: JSON.stringify({
          message: `Migrate legacy image for product: ${productId}`,
          content: base64Content,
          branch:  GITHUB_BRANCH,
        }),
      });

      if (ghRes.ok) {
        newUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${filename}`;
        break;
      }

      const ghBody  = await ghRes.json().catch(() => ({}));
      const errMsg  = ghBody.message || `HTTP ${ghRes.status}`;

      if ([429, 502, 503, 504].includes(ghRes.status) && attempt < 3) {
        lastError = new Error(errMsg);
        await new Promise((r) => setTimeout(r, 600 * Math.pow(2, attempt - 1)));
        continue;
      }

      if (ghRes.status === 401) throw new Error("Token de GitHub inválido o expirado.");
      if (ghRes.status === 403) throw new Error("Sin permisos para escribir en el repositorio.");
      throw new Error(`GitHub: ${errMsg}`);

    } catch (err) {
      lastError = err;
      if (attempt < 3 && !err.message.includes("Token") && !err.message.includes("permisos")) {
        await new Promise((r) => setTimeout(r, 600 * Math.pow(2, attempt - 1)));
      } else {
        break;
      }
    }
  }

  if (!newUrl) {
    return Response.json(
      { error: `No se pudo subir a GitHub: ${lastError?.message || "error desconocido"}` },
      { status: 500 }
    );
  }

  // Actualizar el campo image del producto reemplazando la URL vieja por la nueva
  const currentImages = parseImages(product.image);
  const updatedImages = currentImages.map((url) => url === oldUrl ? newUrl : url);

  // Serializar (string si es una, JSON array si son varias)
  const serialized = updatedImages.length === 1
    ? updatedImages[0]
    : JSON.stringify(updatedImages);

  const oldRecord = { ...product };
  await env.canopia_db
    .prepare("UPDATE products SET image = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(serialized, productId)
    .run();

  const newRecord = await env.canopia_db
    .prepare("SELECT * FROM products WHERE id = ?")
    .bind(productId)
    .first();

  await logAuditEvent(
    env, request,
    "MIGRATE_IMAGE",
    `products:${productId}`,
    { ...oldRecord, migratedFrom: oldUrl },
    { ...newRecord, migratedTo: newUrl }
  );

  return Response.json({
    ok:       true,
    productId,
    oldUrl,
    newUrl,
    filename,
    message:  `Imagen migrada correctamente para "${product.name}".`,
  });
}
