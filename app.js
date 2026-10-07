const sessionKey = "canopia_admin_password";
const CATS_KEY   = "canopia_categories";
const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

let products = [];
let orders   = [];

const PAGE_SIZE = 8;
let currentPage = 1;
let filteredProducts = [];
let activeSection = "products";

const sectionMeta = {
  dashboard:  { title: "Dashboard",                sub: "Resumen general del catálogo.",                 crumb: "Dashboard",      actions: false },
  products:   { title: "Editar catálogo",          sub: "Gestioná tus productos, precios, stock y más.", crumb: "Productos",      actions: true  },
  categories: { title: "Categorías",               sub: "Creá y administrá las categorías.",             crumb: "Categorías",     actions: false },
  orders:     { title: "Pedidos",                  sub: "Últimos pedidos confirmados desde la web.",     crumb: "Pedidos",        actions: false },
  recovery:   { title: "Códigos de recuperación",  sub: "Códigos de acceso pendientes de envío.",        crumb: "Recuperación",   actions: false },
  clients:    { title: "Clientes",                 sub: "Clientes que realizaron pedidos.",              crumb: "Clientes",       actions: false },
  inventory:  { title: "Inventario",               sub: "Stock actual de todos los productos.",          crumb: "Inventario",     actions: false },
  promos:     { title: "Promociones",              sub: "Gestión de promociones y descuentos.",          crumb: "Promociones",    actions: false },
  reports:    { title: "Reportes",                 sub: "Análisis de ventas, tráfico e inteligencia.",   crumb: "Reportes",       actions: false },
  config:     { title: "Notificaciones",           sub: "Alertas y avisos importantes del sistema.",     crumb: "Notificaciones", actions: false },
};

// ════════════════════════════════════════
//  CATEGORIES (localStorage)
// ════════════════════════════════════════
function getCategories() {
  try { return JSON.parse(localStorage.getItem(CATS_KEY) || "[]"); }
  catch { return []; }
}

function saveCategories(cats) {
  localStorage.setItem(CATS_KEY, JSON.stringify(cats));
}

function getCategoryNames() {
  // Merge: categories from localStorage + those already used in products (no duplicates)
  const stored = getCategories().map((c) => c.name);
  const fromProducts = [...new Set(products.map((p) => p.category).filter(Boolean))];
  const all = [...new Set([...stored, ...fromProducts])].sort((a, b) => a.localeCompare(b));
  return all;
}

// ════════════════════════════════════════
//  IMAGE GALLERY UPLOADER
//  Subida automática a Supabase Storage.
//  Drag & drop múltiple, reordenamiento,
//  progreso individual, reintentos, galería.
// ════════════════════════════════════════

// ── Configuración ────────────────────────
const IMG_MAX_SIZE_MB  = 10;
const IMG_MAX_SIZE     = IMG_MAX_SIZE_MB * 1024 * 1024;
const IMG_ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const IMG_UPLOAD_ENDPOINT = "/api/admin/upload-images";

// ── Estado del uploader ──────────────────
// Cada entrada: { url: string, status: "ready"|"uploading"|"done"|"error", name: string, error?: string, localPreview?: string }
let formImages = [];
let imgUploading = false;    // true mientras hay subidas en curso
let imgDragSrcIdx = null;    // índice origen del drag & drop de reordenamiento

// ── Serialización ────────────────────────
function parseImages(raw) {
  if (!raw) return [];
  const s = String(raw).trim();
  if (s.startsWith("[")) {
    try { return JSON.parse(s).filter(Boolean); } catch { return [s]; }
  }
  return s ? [s] : [];
}

function serializeImages(arr) {
  const clean = arr
    .filter((img) => img.status === "done" || img.status === "ready")
    .map((img) => img.url)
    .filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  return JSON.stringify(clean);
}

function syncImgHidden() {
  const h = document.querySelector("#img-hidden");
  if (h) h.value = serializeImages(formImages);
}

// ── Bloquear/desbloquear botón Guardar ───
function setGalleryUploading(active) {
  imgUploading = active;
  const saveBtn = document.querySelector("#product-form [type=submit]");
  if (saveBtn) {
    saveBtn.disabled = active;
    saveBtn.title = active ? "Esperá a que terminen las subidas…" : "";
  }
}

// ── Renderizar galería ───────────────────
function renderImgPreviews() {
  const wrap = document.querySelector("#img-gallery");
  if (!wrap) return;

  if (!formImages.length) {
    wrap.innerHTML = `<p class="img-gallery-empty">No hay imágenes. Arrastrá o seleccioná archivos arriba.</p>`;
    syncImgHidden();
    return;
  }

  wrap.innerHTML = formImages.map((img, i) => {
    const isMain     = i === 0;
    const isDone     = img.status === "done" || img.status === "ready";
    const isUploading = img.status === "uploading";
    const isError    = img.status === "error";
    const thumb      = img.localPreview || (isDone ? img.url : "");

    return `
      <div class="img-gallery-item ${isUploading ? "is-uploading" : ""} ${isError ? "is-error" : ""}"
           draggable="${isDone ? 'true' : 'false'}"
           data-idx="${i}"
           title="${escapeHtml(img.name || img.url || "")}">

        <div class="img-gallery-thumb">
          ${thumb
            ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy"
                    onerror="this.closest('.img-gallery-thumb').innerHTML='<span class=img-err-icon>🖼</span>'" />`
            : `<span class="img-err-icon">${isUploading ? "" : "🖼"}</span>`
          }
          ${isUploading ? `
            <div class="img-gallery-overlay">
              <div class="img-upload-spinner"></div>
            </div>` : ""}
          ${isError ? `
            <div class="img-gallery-overlay img-gallery-overlay--error">
              <span class="img-err-badge" title="${escapeHtml(img.error || 'Error')}">!</span>
            </div>` : ""}
        </div>

        <div class="img-gallery-info">
          ${isMain ? `<span class="img-gallery-main-badge">★ Principal</span>` : ""}
          ${isUploading ? `<span class="img-gallery-status uploading">Subiendo…</span>` : ""}
          ${isError ? `<span class="img-gallery-status error" title="${escapeHtml(img.error || '')}">${escapeHtml(img.error || 'Error').slice(0, 30)}</span>` : ""}
        </div>

        <div class="img-gallery-actions">
          ${isDone && i > 0
            ? `<button type="button" class="img-action-btn" data-make-main="${i}" title="Hacer principal">★</button>`
            : ""}
          ${isDone
            ? `<button type="button" class="img-action-btn" data-replace="${i}" title="Reemplazar imagen">↺</button>`
            : ""}
          ${isError
            ? `<button type="button" class="img-action-btn img-action-retry" data-retry="${i}" title="Reintentar">↻</button>`
            : ""}
          <button type="button" class="img-action-btn img-action-delete" data-remove="${i}" title="Eliminar">✕</button>
        </div>

        ${isDone && formImages.length > 1
          ? `<div class="img-gallery-drag-hint" title="Arrastrá para reordenar">⠿</div>`
          : ""}
      </div>`;
  }).join("");

  // ── Listeners de acciones ────────────────
  wrap.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.remove);
      const img = formImages[idx];
      if (img?.localPreview) URL.revokeObjectURL(img.localPreview);
      formImages.splice(idx, 1);
      syncImgHidden();
      renderImgPreviews();
    });
  });

  wrap.querySelectorAll("[data-make-main]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.makeMain);
      const [moved] = formImages.splice(idx, 1);
      formImages.unshift(moved);
      syncImgHidden();
      renderImgPreviews();
    });
  });

  wrap.querySelectorAll("[data-replace]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.replace);
      triggerReplaceFile(idx);
    });
  });

  wrap.querySelectorAll("[data-retry]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.retry);
      retryFailedImage(idx);
    });
  });

  // ── Drag & drop para reordenar ──────────
  wrap.querySelectorAll(".img-gallery-item[draggable=true]").forEach((item) => {
    item.addEventListener("dragstart", (e) => {
      imgDragSrcIdx = Number(item.dataset.idx);
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      wrap.querySelectorAll(".img-gallery-item").forEach((el) => el.classList.remove("drag-over-item"));
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      wrap.querySelectorAll(".img-gallery-item").forEach((el) => el.classList.remove("drag-over-item"));
      item.classList.add("drag-over-item");
    });
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation(); // evitar que archivos externos lleguen al zone handler
      // Si hay archivos reales del sistema (no drag interno), subirlos en lugar de reordenar
      const extFiles = [...(e.dataTransfer.files || [])].filter((f) => {
        const mime = resolveFileMime(f);
        return mime.startsWith("image/");
      });
      if (extFiles.length) {
        imgDragSrcIdx = null;
        uploadImages(extFiles);
        return;
      }
      const destIdx = Number(item.dataset.idx);
      if (imgDragSrcIdx === null || imgDragSrcIdx === destIdx) return;
      const [moved] = formImages.splice(imgDragSrcIdx, 1);
      formImages.splice(destIdx, 0, moved);
      imgDragSrcIdx = null;
      syncImgHidden();
      renderImgPreviews();
    });
  });

  syncImgHidden();
}

// ── Inferir MIME type por extensión cuando file.type viene vacío ─────────
// Algunos browsers (Safari iOS, drag desde Finder/Explorer) no populan
// file.type. La extensión del nombre es el fallback confiable.
function mimeFromExtension(filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  const map = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
  return map[ext] || "";
}

function resolveFileMime(file) {
  const declared = (file.type || "").toLowerCase();
  return declared || mimeFromExtension(file.name);
}

// ── Validar archivo antes de subir ───────
function validateImageFile(file) {
  if (!file || !(file instanceof File)) return "Archivo inválido.";
  const mime = resolveFileMime(file);
  if (!IMG_ALLOWED_TYPES.has(mime)) {
    const label = mime || `sin tipo (extensión: .${(file.name || "").split(".").pop()})`;
    return `Formato no permitido: ${label}. Solo JPG, PNG o WEBP.`;
  }
  if (file.size > IMG_MAX_SIZE) return `El archivo supera ${IMG_MAX_SIZE_MB} MB.`;
  return null; // ok
}

// ── Convertir ArrayBuffer a base64 sin bloquear el browser ───────────────
// Procesa en chunks de 32KB para evitar que btoa + string concatenation
// cause jank en el hilo principal con imágenes grandes.
function bufferToBase64Browser(buffer) {
  const bytes   = new Uint8Array(buffer);
  const CHUNK   = 32768;
  let   binary  = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// ── Enviar un archivo al backend como JSON con data en base64 ─────────────
// Base64 produce ~33% más de datos que el binario original pero es 3x
// más compacto que Array.from(Uint8Array) que serializa cada byte como número.
async function uploadFileAsJson(file) {
  const buffer = await file.arrayBuffer();
  const res = await fetch(IMG_UPLOAD_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type":     "application/json",
      "x-admin-password": localStorage.getItem(sessionKey) || "",
      "X-Last-Active":    localStorage.getItem("canopia_last_active") || Date.now().toString(),
    },
    body: JSON.stringify({
      name: file.name,
      type: resolveFileMime(file),
      size: file.size,
      data: bufferToBase64Browser(buffer),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error HTTP ${res.status}`);
  const urls = data.urls || [];
  if (!urls.length) throw new Error(data.failures?.[0]?.error || "No se obtuvo URL.");
  return urls[0];
}

// ── Detectar duplicados por nombre+tamaño ─
function isDuplicate(file) {
  return formImages.some((img) => img._originalName === file.name && img._originalSize === file.size);
}

// ── Subir un lote de archivos al backend ──
async function uploadImages(files) {
  if (!files.length) return;

  const statusEl  = document.querySelector("#img-upload-status");
  const progressEl = document.querySelector("#img-upload-progress");
  const zone      = document.querySelector("#img-drop-zone");

  // Pre-validar todos los archivos antes de empezar
  const validFiles   = [];
  const invalidFiles = [];

  for (const file of files) {
    const err = validateImageFile(file);
    if (err) {
      invalidFiles.push({ name: file.name, error: err });
      continue;
    }
    if (isDuplicate(file)) {
      invalidFiles.push({ name: file.name, error: "Imagen duplicada." });
      continue;
    }
    validFiles.push(file);
  }

  // Mostrar errores de validación
  if (invalidFiles.length) {
    const errMsg = invalidFiles.map((f) => `"${f.name}": ${f.error}`).join(" · ");
    showImgStatus(`⚠ ${errMsg}`, "warning");
  }

  if (!validFiles.length) return;

  // Crear entradas en estado "uploading" con preview local inmediato
  const newEntries = validFiles.map((file) => {
    const localPreview = URL.createObjectURL(file);
    return {
      url: "",
      status: "uploading",
      name: file.name,
      error: null,
      localPreview,
      _originalName: file.name,
      _originalSize: file.size,
      _file: file,
    };
  });

  formImages.push(...newEntries);
  renderImgPreviews();
  setGalleryUploading(true);
  if (zone) zone.classList.add("uploading");

  const total = validFiles.length;
  let done = 0;

  // Subir de a una para mostrar progreso individual (no saturar el backend)
  for (let i = 0; i < validFiles.length; i++) {
    const file      = validFiles[i];
    const entryIdx  = formImages.findIndex(
      (img) => img.status === "uploading" && img._originalName === file.name && img._originalSize === file.size
    );
    if (entryIdx === -1) continue;

    // Actualizar status visual
    done++;
    if (statusEl) {
      statusEl.textContent = `Subiendo imagen ${done} de ${total}… (${escapeHtml(file.name)})`;
      statusEl.className   = "img-upload-status-text uploading";
    }
    if (progressEl) {
      progressEl.style.display = "block";
      progressEl.querySelector(".img-progress-fill").style.width = `${Math.round(((done - 1) / total) * 100)}%`;
      progressEl.querySelector(".img-progress-label").textContent = `${done - 1} / ${total}`;
    }

    try {
      const url = await uploadFileAsJson(file);

      // Actualizar entrada a "done"
      const img = formImages[entryIdx];
      img.url    = url;
      img.status = "done";
    } catch (err) {
      const img = formImages[entryIdx];
      img.status = "error";
      img.error  = err.message;
    }

    renderImgPreviews();
  }

  // Barra final
  if (progressEl) {
    progressEl.querySelector(".img-progress-fill").style.width = "100%";
    progressEl.querySelector(".img-progress-label").textContent = `${total} / ${total}`;
    setTimeout(() => { progressEl.style.display = "none"; }, 1800);
  }

  const uploaded = formImages.filter((img) => img.status === "done").length;
  const errors   = formImages.filter((img) => img.status === "error").length;

  if (errors === 0) {
    showImgStatus(`✓ ${total} imagen${total !== 1 ? "es" : ""} subida${total !== 1 ? "s" : ""} correctamente`, "success");
  } else if (uploaded > 0) {
    showImgStatus(`✓ ${uploaded} subida${uploaded !== 1 ? "s" : ""} · ⚠ ${errors} con error`, "warning");
  } else {
    showImgStatus(`✕ No se pudo subir ninguna imagen`, "error");
  }

  setGalleryUploading(false);
  if (zone) zone.classList.remove("uploading");
  syncImgHidden();
}

// ── Reintentar una imagen fallida ─────────
async function retryFailedImage(idx) {
  const img = formImages[idx];
  if (!img || img.status !== "error" || !img._file) return;

  img.status = "uploading";
  img.error  = null;
  renderImgPreviews();
  setGalleryUploading(true);

  try {
    const url = await uploadFileAsJson(img._file);

    img.url    = url;
    img.status = "done";
    img.error  = null;
    showImgStatus("✓ Imagen resubida correctamente", "success");
  } catch (err) {
    img.status = "error";
    img.error  = err.message;
    showImgStatus(`✕ Error al reintentar: ${err.message}`, "error");
  }

  setGalleryUploading(false);
  renderImgPreviews();
  syncImgHidden();
}

// ── Reemplazar imagen individual ─────────
function triggerReplaceFile(idx) {
  const input = document.createElement("input");
  input.type  = "file";
  input.accept = "image/jpeg,image/jpg,image/png,image/webp";
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;

    const err = validateImageFile(file);
    if (err) { showImgStatus(`⚠ ${err}`, "warning"); return; }

    // Reemplazar en lugar
    const old = formImages[idx];
    if (old?.localPreview) URL.revokeObjectURL(old.localPreview);

    formImages[idx] = {
      url: "",
      status: "uploading",
      name: file.name,
      error: null,
      localPreview: URL.createObjectURL(file),
      _originalName: file.name,
      _originalSize: file.size,
      _file: file,
    };
    renderImgPreviews();
    setGalleryUploading(true);

    try {
      const url = await uploadFileAsJson(file);

      formImages[idx].url    = url;
      formImages[idx].status = "done";
      showImgStatus("✓ Imagen reemplazada correctamente", "success");
    } catch (err) {
      formImages[idx].status = "error";
      formImages[idx].error  = err.message;
      showImgStatus(`✕ Error al reemplazar: ${err.message}`, "error");
    }

    setGalleryUploading(false);
    renderImgPreviews();
    syncImgHidden();
  });
  input.click();
}

// ── Mostrar mensaje de estado ─────────────
let _statusTimer = null;
function showImgStatus(msg, type = "info") {
  const el = document.querySelector("#img-upload-status");
  if (!el) return;
  el.textContent = msg;
  el.className   = `img-upload-status-text ${type}`;
  clearTimeout(_statusTimer);
  if (type === "success") {
    _statusTimer = setTimeout(() => {
      el.textContent = "";
      el.className   = "img-upload-status-text";
    }, 3500);
  }
}

// ── Agregar URL externa manualmente ──────
function addImageUrl(url) {
  url = url.trim();
  if (!url) return;
  if (!url.startsWith("http")) return;
  if (formImages.some((img) => img.url === url)) return;
  formImages.push({ url, status: "ready", name: url.split("/").pop() || "imagen", error: null });
  syncImgHidden();
  renderImgPreviews();
}

// ── Inicializar zona de carga ─────────────
function setupImageZone() {
  const zone   = document.querySelector("#img-drop-zone");
  const fileIn = document.querySelector("#img-file-input");
  const urlIn  = document.querySelector("#img-url-input");
  const addBtn = document.querySelector("#img-url-add");

  if (zone && fileIn) {
    zone.addEventListener("click", (e) => {
      // No disparar si el clic fue en uno de los botones internos
      if (e.target.closest("button")) return;
      if (!imgUploading) fileIn.click();
    });

    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!imgUploading) zone.classList.add("drag-over");
    });

    zone.addEventListener("dragleave", (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove("drag-over");
    });

    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      if (imgUploading) return;
      // Solo procesar si hay archivos reales (no un reordenamiento interno)
      const files = [...(e.dataTransfer.files || [])].filter((f) => {
        const mime = resolveFileMime(f);
        return mime.startsWith("image/");
      });
      if (files.length) uploadImages(files);
    });

    fileIn.addEventListener("change", () => {
      const files = [...fileIn.files];
      fileIn.value = "";
      if (files.length) uploadImages(files);
    });
  }

  if (urlIn && addBtn) {
    function doAddUrl() {
      addImageUrl(urlIn.value);
      urlIn.value = "";
      urlIn.focus();
    }
    addBtn.addEventListener("click", doAddUrl);
    urlIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doAddUrl(); } });
    urlIn.addEventListener("paste", () =>
      setTimeout(() => { if (urlIn.value.trim().startsWith("http")) doAddUrl(); }, 60)
    );
  }
}

// ════════════════════════════════════════
//  STORAGE CONFIG CHECK
//  Verifica al iniciar el panel si las
//  variables de Supabase están configuradas.
// ════════════════════════════════════════

// Estado de configuración: "unknown" | "ok" | "warning" | "error"
let storageConfigStatus = "unknown";

async function checkStorageConfig() {
  const banner   = document.querySelector("#github-config-banner");
  const icon     = document.querySelector("#github-config-icon");
  const msg      = document.querySelector("#github-config-msg");
  const retryBtn = document.querySelector("#github-config-retry");
  if (!banner) return;

  banner.hidden    = false;
  banner.className = "github-config-banner loading";
  icon.textContent = "⟳";
  msg.textContent  = "Verificando configuración de Supabase…";
  if (retryBtn) retryBtn.hidden = true;

  try {
    const data = await api("/api/admin/check-config");

    storageConfigStatus = data.status;

    if (data.ok) {
      banner.className = "github-config-banner ok";
      icon.textContent = "✓";
      msg.textContent  = `Supabase conectado · imágenes se subirán al bucket "${data.storage?.bucket || "product-images"}"`;
      if (retryBtn) retryBtn.hidden = true;

      setTimeout(() => {
        if (storageConfigStatus === "ok") banner.hidden = true;
      }, 4000);

      scanLegacyImagesBackground();

    } else {
      banner.className = data.status === "error"
        ? "github-config-banner error"
        : "github-config-banner warning";

      const firstFail = (data.checks || []).find(
        (c) => c.status === "error" || c.status === "missing"
      );

      icon.textContent = data.status === "error" ? "✕" : "⚠";
      msg.textContent  = firstFail?.message || data.summary || "Configuración incompleta.";

      if (retryBtn) {
        retryBtn.hidden  = false;
        retryBtn.onclick = checkStorageConfig;
      }

      // Deshabilitar zona si faltan las variables críticas de Supabase
      const hasStorageError = (data.checks || []).some(
        (c) => (c.key === "SUPABASE_URL" || c.key === "SUPABASE_SERVICE_ROLE_KEY" || c.key === "bucket")
              && (c.status === "error" || c.status === "missing")
      );
      if (hasStorageError) {
        disableImageZone(firstFail?.message || "Configurá SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para subir imágenes.");
      }
    }
  } catch (err) {
    storageConfigStatus = "error";
    banner.className    = "github-config-banner error";
    icon.textContent    = "✕";
    msg.textContent     = `No se pudo verificar la configuración: ${err.message}`;
    if (retryBtn) {
      retryBtn.hidden  = false;
      retryBtn.onclick = checkStorageConfig;
    }
  }
}

// Deshabilitar visualmente la zona de drop con mensaje explicativo
function disableImageZone(reason) {
  const zone    = document.querySelector("#img-drop-zone");
  const fileIn  = document.querySelector("#img-file-input");
  if (!zone) return;

  zone.classList.add("disabled");
  zone.title = reason;
  // Reemplazar texto del hint
  const hint = zone.querySelector(".img-drop-hint");
  if (hint) hint.textContent = reason;
  // Deshabilitar el input de archivo
  if (fileIn) fileIn.disabled = true;
}

// Escanear en background y mostrar el panel solo si hay legacy
async function scanLegacyImagesBackground() {
  try {
    const data = await api("/api/admin/migrate-images");
    if (data.flagged > 0) {
      showMigrationPanel(true);
      const summary = document.querySelector("#migration-summary");
      const badge   = document.querySelector("#migration-count-badge");
      if (summary) summary.textContent = data.summary || "";
      if (badge)   { badge.textContent = data.flagged; badge.hidden = false; }
      // Trigger full render
      await scanLegacyImages();
    }
  } catch {
    // Silencioso — el escaneo background no debe interrumpir el flujo normal
  }
}

// ════════════════════════════════════════
function setupCatPicker() {
  const input    = document.querySelector("#cat-input");
  const dropdown = document.querySelector("#cat-dropdown");
  if (!input || !dropdown) return;

  function openDropdown() {
    const q    = input.value.toLowerCase();
    const cats = getCategoryNames().filter((c) => !q || c.toLowerCase().includes(q));
    if (!cats.length) { dropdown.hidden = true; return; }

    dropdown.innerHTML = cats.map((c) => `
      <div class="cat-dropdown-item" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</div>
    `).join("");

    dropdown.querySelectorAll(".cat-dropdown-item").forEach((item) => {
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = item.dataset.cat;
        dropdown.hidden = true;
      });
    });
    dropdown.hidden = false;
  }

  input.addEventListener("focus", openDropdown);
  input.addEventListener("input", openDropdown);
  input.addEventListener("blur", () => setTimeout(() => { dropdown.hidden = true; }, 150));
}

// ════════════════════════════════════════
//  API
// ════════════════════════════════════════
function updateLastActive() {
  localStorage.setItem("canopia_last_active", Date.now().toString());
}

document.addEventListener("click", updateLastActive);
document.addEventListener("keypress", updateLastActive);
document.addEventListener("scroll", updateLastActive, { passive: true });

const authHeaders = () => ({
  "Content-Type": "application/json",
  "x-admin-password": localStorage.getItem(sessionKey) || "",
  "X-Last-Active": localStorage.getItem("canopia_last_active") || Date.now().toString(),
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  
  if (response.status === 401 && data.error === "Sesión expirada por inactividad.") {
    localStorage.removeItem(sessionKey);
    alert("Tu sesión expiró por inactividad. Ingresá de nuevo.");
    location.reload();
  }
  
  if (!response.ok) throw new Error(data.error || "No se pudo completar la accion.");
  return data;
}

// ════════════════════════════════════════
//  ADMIN SHOW / LOAD
// ════════════════════════════════════════
function showAdmin() {
  document.querySelector("#login-card").hidden = true;
  document.querySelector("#admin").hidden = false;
  setupImageZone();
  setupCatPicker();
  checkStorageConfig();     // verificar configuración de Supabase al iniciar
  loadAll();
  refreshRecoveryBadge();
  setTimeout(loadNotifications, 1500); // cargar notifs después de que carguen los productos
}

async function loadAll() {
  await Promise.all([loadProducts(), loadOrders()]);
}

async function loadProducts() {
  const data = await api("/api/admin/products");
  products = data.products || [];
  applyFilter();
  renderStats();
  renderDashboard();
  renderCategoriesSection();
  renderInventory();
}

async function loadOrders() {
  const data = await api("/api/admin/orders");
  orders = data.orders || [];
  renderOrders();
  renderClients();
}

// ════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════
function navigateTo(section) {
  activeSection = section;
  document.querySelectorAll(".nav-item").forEach((n) =>
    n.classList.toggle("active", n.dataset.section === section)
  );
  document.querySelectorAll(".section-view").forEach((el) => {
    el.hidden = el.id !== `section-${section}`;
  });
  const meta = sectionMeta[section] || {};
  document.querySelector("#bc-section").textContent  = meta.crumb || section;
  document.querySelector("#page-title").textContent  = meta.title || section;
  document.querySelector("#page-sub").textContent    = meta.sub   || "";
  document.querySelector("#topbar-actions").style.display = meta.actions ? "" : "none";
  document.querySelector(".main-content").scrollTo({ top: 0, behavior: "smooth" });
}

// ════════════════════════════════════════
//  STATS
// ════════════════════════════════════════
function renderStats() {
  document.querySelector("#stat-total").textContent   = products.length;
  document.querySelector("#stat-stock").textContent   = products.reduce((s, p) => s + (Number(p.stock) || 0), 0).toLocaleString("es-AR");
  document.querySelector("#stat-cats").textContent    = new Set(products.map((p) => p.category).filter(Boolean)).size;
  document.querySelector("#stat-nostock").textContent = products.filter((p) => !Number(p.stock)).length;
}

// ════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════
function renderDashboard() {
  const el = document.querySelector("#dashboard-featured");
  if (!el) return;
  const featured = products.filter((p) => p.featured).slice(0, 6);
  if (!featured.length) { el.innerHTML = `<p class="muted-text" style="padding:12px 0">No hay productos destacados.</p>`; return; }
  el.innerHTML = `<div class="dash-grid">${featured.map((p) => {
    const imgs = p.images?.length ? p.images : parseImages(p.image);
    const thumb = imgs[0] || "";
    return `
    <div class="dash-card">
      <div class="dash-img">${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" />` : "🌿"}</div>
      <div class="dash-info"><strong>${escapeHtml(p.name)}</strong><span class="cat-badge">${escapeHtml(p.category)}</span></div>
      <div class="dash-meta"><span class="price-cell">${money.format(p.price)}</span><span class="${Number(p.stock) === 0 ? "stock-zero" : "muted-text"}">Stock: ${p.stock}</span></div>
    </div>`;
  }).join("")}</div>`;
}

// ════════════════════════════════════════
//  CATEGORIES SECTION
// ════════════════════════════════════════
function renderCategoriesSection() {
  renderCatList();
  renderCatProducts();
}

function renderCatList() {
  const wrap = document.querySelector("#cat-list-wrap");
  const label = document.querySelector("#cat-count-label");
  if (!wrap) return;

  const cats = getCategories();
  const allNames = getCategoryNames();

  if (label) label.textContent = `${allNames.length} categoría${allNames.length !== 1 ? "s" : ""}`;

  if (!allNames.length) {
    wrap.innerHTML = `<p class="muted-text" style="padding:12px 0">No hay categorías creadas todavía. Usá el formulario para agregar.</p>`;
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nombre</th><th>Descripción</th><th>Productos</th><th>Acciones</th></tr></thead>
        <tbody>
          ${allNames.map((name) => {
            const stored = cats.find((c) => c.name === name);
            const count  = products.filter((p) => p.category === name).length;
            return `
              <tr>
                <td><strong>${escapeHtml(name)}</strong></td>
                <td>${escapeHtml(stored?.desc || "—")}</td>
                <td>${count}</td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="action-btn" data-cat-edit="${escapeHtml(name)}" title="Editar">✏</button>
                    <button type="button" class="action-btn delete" data-cat-del="${escapeHtml(name)}" title="Eliminar">🗑</button>
                  </div>
                </td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;

  wrap.querySelectorAll("[data-cat-del]").forEach((btn) => {
    btn.addEventListener("click", () => deleteCat(btn.dataset.catDel));
  });
  wrap.querySelectorAll("[data-cat-edit]").forEach((btn) => {
    btn.addEventListener("click", () => editCat(btn.dataset.catEdit));
  });
}

function editCat(name) {
  const cats = getCategories();
  const stored = cats.find((c) => c.name === name);
  document.querySelector("#cat-edit-original").value    = name;
  document.querySelector("#cat-name-input").value       = name;
  document.querySelector("#cat-desc-input").value       = stored?.desc || "";
  document.querySelector("#cat-submit-btn").textContent = "Guardar cambios";
  document.querySelector("#cat-form").closest(".panel").querySelector(".panel-head h2").textContent = "Editar categoría";
  document.querySelector("#cat-name-input").focus();
}

function deleteCat(name) {
  if (!confirm(`¿Eliminar la categoría "${name}"?`)) return;
  const cats = getCategories().filter((c) => c.name !== name);
  saveCategories(cats);
  renderCatList();
  renderCatProducts();
}

function renderCatProducts() {
  const el = document.querySelector("#categories-body");
  if (!el) return;
  const map = {};
  products.forEach((p) => {
    const cat = p.category || "Sin categoría";
    if (!map[cat]) map[cat] = [];
    map[cat].push(p);
  });
  const cats = Object.keys(map).sort();
  if (!cats.length) { el.innerHTML = `<p class="muted-text" style="padding:12px 0">No hay productos.</p>`; return; }
  el.innerHTML = cats.map((cat) => `
    <div class="cat-group">
      <div class="cat-group-head">
        <span class="cat-badge">${escapeHtml(cat)}</span>
        <span class="muted-text">${map[cat].length} producto${map[cat].length !== 1 ? "s" : ""}</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Producto</th><th>Precio</th><th>Stock</th><th>Visible</th></tr></thead>
        <tbody>${map[cat].map((p) => `
          <tr>
            <td><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.id)}</small></td>
            <td class="price-cell">${money.format(p.price)}</td>
            <td class="${Number(p.stock) === 0 ? "stock-zero" : ""}">${p.stock}</td>
            <td>${p.visible ? `<span class="badge-green">Sí</span>` : `<span style="color:var(--muted)">No</span>`}</td>
          </tr>`).join("")}
        </tbody>
      </table></div>
    </div>`).join("");
}

// ════════════════════════════════════════
//  ORDERS / CLIENTS / INVENTORY
// ════════════════════════════════════════

// Active filter for the orders section
let ordersFilter = "todos";

async function loadOrders() {
  const status = ordersFilter === "todos" ? "" : ordersFilter;
  const url    = status ? `/api/admin/orders?status=${encodeURIComponent(status)}` : "/api/admin/orders";
  const data   = await api(url);
  orders = data.orders || [];
  renderOrders();
  renderClients();
  updateOrdersBadge();
}

async function updateOrdersBadge() {
  try {
    const data    = await api("/api/admin/orders?status=pendiente");
    const count   = (data.orders || []).length;
    const badge   = document.querySelector("#orders-badge");
    if (!badge) return;
    badge.textContent = count > 0 ? count : "";
    badge.hidden      = count === 0;
  } catch { /* silently ignore */ }
}

function renderOrders() {
  const list = document.querySelector("#orders-list");
  if (!list) return;

  // Render filter tabs
  const filtersHtml = ["todos","pendiente","confirmado","rechazado"].map((f) => `
    <button type="button" class="filter-tab ${ordersFilter === f ? "active" : ""}" data-filter="${f}">
      ${f.charAt(0).toUpperCase() + f.slice(1)}
    </button>
  `).join("");

  if (!orders.length) {
    list.innerHTML = `
      <div class="order-filters">${filtersHtml}</div>
      <p class="muted-text" style="padding:12px 0">No hay pedidos${ordersFilter !== "todos" ? ` con estado "${ordersFilter}"` : ""} todavía.</p>`;
  } else {
    list.innerHTML = `
      <div class="order-filters">${filtersHtml}</div>
      ${orders.map((order) => {
        const items  = JSON.parse(order.items_json || "[]");
        const status = order.status || "pendiente";
        const statusClass = { pendiente: "status-pending", confirmado: "status-confirmed", rechazado: "status-rejected" }[status] || "";
        const isPending = status === "pendiente";
        return `
          <article class="order-card order-card--${status}">
            <div class="order-card-head">
              <div>
                <strong>#${order.id} — ${escapeHtml(order.customer_name)}</strong>
                <span class="order-status ${statusClass}">${status}</span>
              </div>
              <small>${new Date(order.created_at).toLocaleString("es-AR")}</small>
            </div>
            <p>${escapeHtml(order.customer_phone)} · ${money.format(order.total)}</p>
            <p class="order-items">${items.map((i) => `${escapeHtml(i.name)} ×${i.quantity}`).join(" · ")}</p>
            ${order.customer_note ? `<p class="order-note">📝 ${escapeHtml(order.customer_note)}</p>` : ""}
            ${isPending ? `
              <div class="order-actions">
                <button type="button" class="btn-confirm" data-confirm="${order.id}">✓ Confirmar</button>
                <button type="button" class="btn-reject"  data-reject="${order.id}">✕ Rechazar</button>
              </div>` : ""}
          </article>`;
      }).join("")}`;
  }

  // Bind filter tabs
  list.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ordersFilter = btn.dataset.filter;
      loadOrders();
    });
  });

  // Bind confirm / reject
  list.querySelectorAll("[data-confirm]").forEach((btn) => {
    btn.addEventListener("click", () => actionOrder(Number(btn.dataset.confirm), "confirm"));
  });
  list.querySelectorAll("[data-reject]").forEach((btn) => {
    btn.addEventListener("click", () => actionOrder(Number(btn.dataset.reject), "reject"));
  });
}

async function actionOrder(id, action) {
  const label = action === "confirm" ? "confirmar" : "rechazar";
  if (!confirm(`¿${label.charAt(0).toUpperCase() + label.slice(1)} el pedido #${id}?`)) return;
  try {
    await api(`/api/admin/orders?action=${action}`, { method: "POST", body: JSON.stringify({ id }) });
    await loadOrders();
    if (action === "confirm") await loadProducts(); // refresh stock
  } catch (err) { alert(err.message); }
}

function renderClients() {
  const body = document.querySelector("#clients-body");
  if (!body) return;
  if (!orders.length) { body.innerHTML = `<tr><td colspan="5" class="muted-text" style="padding:16px">No hay clientes todavía.</td></tr>`; return; }
  body.innerHTML = orders.map((o) => `<tr>
    <td><strong>#${o.id}</strong></td>
    <td><strong>${escapeHtml(o.customer_name)}</strong></td>
    <td>${escapeHtml(o.customer_phone)}</td>
    <td class="price-cell">${money.format(o.total)}</td>
    <td><small>${new Date(o.created_at).toLocaleString("es-AR")}</small></td>
  </tr>`).join("");
}

function renderInventory() {
  const body = document.querySelector("#inventory-body");
  if (!body) return;
  const sorted = [...products].sort((a, b) => Number(a.stock) - Number(b.stock));
  if (!sorted.length) { body.innerHTML = `<tr><td colspan="5" class="muted-text" style="padding:16px">No hay productos.</td></tr>`; return; }
  body.innerHTML = sorted.map((p) => {
    const s = Number(p.stock);
    const badge = s === 0 ? ["Sin stock","color:var(--red)"] : s <= 5 ? ["Stock bajo","color:#f0a500"] : ["OK","color:var(--lime)"];
    const imgs  = p.images?.length ? p.images : parseImages(p.image);
    const thumb = imgs[0] || "";
    return `<tr>
      <td><div class="prod-cell">
        <div class="prod-img" style="display:inline-flex;align-items:center;justify-content:center;font-size:16px;">
          ${thumb ? `<img src="${escapeHtml(thumb)}" alt="" style="width:36px;height:36px;border-radius:6px;object-fit:cover;" loading="lazy" />` : "🌿"}
        </div>
        <div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.id)}</small></div>
      </div></td>
      <td><span class="cat-badge">${escapeHtml(p.category||"—")}</span></td>
      <td class="${s===0?"stock-zero":""}" style="font-weight:700">${s}</td>
      <td style="${badge[1]};font-weight:700">${badge[0]}</td>
      <td class="price-cell">${money.format(p.price)}</td>
    </tr>`;
  }).join("");
}

// ════════════════════════════════════════
//  PRODUCTS TABLE + FILTER
// ════════════════════════════════════════
function applyFilter(page = 1) {
  const q = (document.querySelector("#search-input")?.value || "").toLowerCase();
  filteredProducts = q
    ? products.filter((p) =>
        (p.name||"").toLowerCase().includes(q) ||
        (p.id||"").toLowerCase().includes(q) ||
        (p.category||"").toLowerCase().includes(q))
    : [...products];
  currentPage = page;
  renderProducts();
}

function renderProducts() {
  const body = document.querySelector("#products-body");
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredProducts.slice(start, start + PAGE_SIZE);

  body.innerHTML = pageItems.map((p) => {
    // Soportar campo images[] (nuevo) o image (legacy)
    const imgs = p.images?.length ? p.images : parseImages(p.image);
    const thumb = imgs[0] || "";
    const imgHtml = thumb
      ? `<img class="prod-img" src="${escapeHtml(thumb)}" alt="" loading="lazy" />`
      : `<div class="prod-img" style="display:inline-flex;align-items:center;justify-content:center;font-size:18px;">🌿</div>`;
    return `<tr>
      <td><div class="prod-cell">${imgHtml}<div>
        <strong>${escapeHtml(p.name)}</strong>
        <small>SKU: ${escapeHtml(p.id)}</small>
      </div></div></td>
      <td><span class="cat-badge">${escapeHtml(p.category||"—")}</span></td>
      <td class="price-cell">${money.format(p.price)}</td>
      <td class="${Number(p.stock)===0?"stock-zero":""}">${p.stock}</td>
      <td><label class="toggle"><input type="checkbox" data-toggle="${escapeHtml(p.id)}" ${p.visible?"checked":""}/><span class="toggle-track"><span class="toggle-thumb"></span></span></label></td>
      <td><div class="row-actions">
        <button type="button" class="action-btn" data-edit="${escapeHtml(p.id)}" title="Editar">✏</button>
        <button type="button" class="action-btn delete" data-delete="${escapeHtml(p.id)}" title="Borrar">🗑</button>
      </div></td>
    </tr>`;
  }).join("");

  const countEl = document.querySelector("#table-count");
  if (countEl) {
    const end = Math.min(start + PAGE_SIZE, filteredProducts.length);
    countEl.textContent = filteredProducts.length > 0 ? `Mostrando ${start+1} a ${end} de ${filteredProducts.length} productos` : "No hay productos";
  }
  renderPagination(totalPages);

  body.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => fillForm(products.find((p) => p.id === btn.dataset.edit)))
  );
  body.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => deleteProduct(btn.dataset.delete))
  );
  body.querySelectorAll("[data-toggle]").forEach((chk) =>
    chk.addEventListener("change", () => toggleVisible(chk.dataset.toggle, chk.checked))
  );
}

async function toggleVisible(id, visible) {
  const product = products.find((p) => p.id === id);
  if (!product) return;
  try {
    await api("/api/admin/products", { method: "POST", body: JSON.stringify({ ...product, visible }) });
    product.visible = visible;
  } catch (err) { alert(err.message); applyFilter(currentPage); }
}

function renderPagination(totalPages) {
  const container = document.querySelector("#pagination");
  if (!container) return;
  if (totalPages <= 1) { container.innerHTML = ""; return; }
  const pages = buildPageList(currentPage, totalPages);
  container.innerHTML = pages.map((p) => {
    if (p === "prev") return `<button class="page-btn" data-page="${currentPage-1}" ${currentPage===1?"disabled":""}>‹</button>`;
    if (p === "next") return `<button class="page-btn" data-page="${currentPage+1}" ${currentPage===totalPages?"disabled":""}>›</button>`;
    if (p === "...") return `<span class="page-btn dots">…</span>`;
    return `<button class="page-btn ${p===currentPage?"active":""}" data-page="${p}">${p}</button>`;
  }).join("");
  container.querySelectorAll("[data-page]").forEach((btn) =>
    btn.addEventListener("click", () => applyFilter(Number(btn.dataset.page)))
  );
}

function buildPageList(cur, total) {
  const list = ["prev"];
  if (total <= 7) { for (let i=1;i<=total;i++) list.push(i); }
  else {
    list.push(1);
    if (cur > 3) list.push("...");
    for (let i=Math.max(2,cur-1);i<=Math.min(total-1,cur+1);i++) list.push(i);
    if (cur < total-2) list.push("...");
    list.push(total);
  }
  list.push("next");
  return list;
}

// ════════════════════════════════════════
//  PRODUCT FORM
// ════════════════════════════════════════
function fillForm(product = {}) {
  const form = document.querySelector("#product-form");
  form.id.value          = product.id          || "";
  form.name.value        = product.name        || "";
  form.category.value    = product.category    || "";  // also sets #cat-input
  form.price.value       = product.price       || 0;
  form.stock.value       = product.stock       || 0;
  form.tag.value         = product.tag         || "";
  form.description.value = product.description || "";
  form.featured.checked  = Boolean(product.featured);
  form.visible.checked   = product.visible !== false;

  // images — convertir URLs planas al nuevo formato de objeto
  const rawUrls = parseImages(product.image);
  formImages = rawUrls.map((url) => ({
    url,
    status: "ready",
    name: url.split("/").pop() || "imagen",
    error: null,
    localPreview: null,
  }));
  syncImgHidden();
  renderImgPreviews();

  form.name.focus();
  document.querySelector(".edit-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveProduct(event) {
  event.preventDefault();
  const form  = event.currentTarget;
  const state = document.querySelector("#save-state");

  // Bloquear si hay subidas en curso
  if (imgUploading) {
    state.textContent = "⚠ Esperá a que terminen las subidas…";
    setTimeout(() => { state.textContent = ""; }, 3000);
    return;
  }

  // Advertir si hay imágenes con error pendientes
  const errorImgs = formImages.filter((img) => img.status === "error");
  if (errorImgs.length) {
    state.textContent = `⚠ Hay ${errorImgs.length} imagen${errorImgs.length !== 1 ? "es" : ""} con error. Podés reintentarlas o eliminarlas.`;
    setTimeout(() => { state.textContent = ""; }, 4000);
    return;
  }

  const payload = Object.fromEntries(new FormData(form).entries());
  payload.price    = Number(payload.price    || 0);
  payload.stock    = Number(payload.stock    || 0);
  payload.featured = form.featured.checked;
  payload.visible  = form.visible.checked;
  // payload.image ya contiene las URLs serializadas desde #img-hidden

  state.textContent = "Guardando…";
  try {
    await api("/api/admin/products", { method: "POST", body: JSON.stringify(payload) });
    state.textContent = "✓ Guardado";
    setTimeout(() => { state.textContent = ""; }, 3000);
    // Limpiar previews locales
    formImages.forEach((img) => { if (img.localPreview) URL.revokeObjectURL(img.localPreview); });
    await loadProducts();
  } catch (error) { state.textContent = error.message; }
}

async function deleteProduct(id) {
  if (!confirm(`¿Borrar el producto "${id}"?`)) return;
  try {
    await api(`/api/admin/products?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadProducts();
  } catch (err) { alert(err.message); }
}

// ════════════════════════════════════════
//  CATEGORY FORM
// ════════════════════════════════════════
function saveCategoryForm(event) {
  event.preventDefault();
  const name     = document.querySelector("#cat-name-input").value.trim();
  const desc     = document.querySelector("#cat-desc-input").value.trim();
  const original = document.querySelector("#cat-edit-original").value;
  if (!name) return;

  let cats = getCategories();
  if (original) {
    // editing
    const idx = cats.findIndex((c) => c.name === original);
    if (idx >= 0) cats[idx] = { name, desc };
    else cats.push({ name, desc });
  } else {
    if (!cats.find((c) => c.name === name)) cats.push({ name, desc });
  }
  saveCategories(cats);
  resetCatForm();
  renderCategoriesSection();
}

function resetCatForm() {
  document.querySelector("#cat-name-input").value       = "";
  document.querySelector("#cat-desc-input").value       = "";
  document.querySelector("#cat-edit-original").value    = "";
  document.querySelector("#cat-submit-btn").textContent = "Crear categoría";
  document.querySelector("#cat-form").closest(".panel").querySelector(".panel-head h2").textContent = "Nueva categoría";
}

// ════════════════════════════════════════
//  RECOVERY CODES
// ════════════════════════════════════════
const RECOVERY_API = "https://canopiagrow.com/api/auth?action=recovery-codes";

async function loadRecoveryCodes() {
  const container = document.querySelector("#recovery-list");
  if (!container) return;
  container.innerHTML = `<p class="muted-text" style="padding:8px 0">Cargando…</p>`;

  try {
    const res = await fetch(RECOVERY_API, {
      headers: { "x-admin-password": localStorage.getItem(sessionKey) || "" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No se pudo cargar.");

    const codes = data.codes || [];
    updateRecoveryBadge(codes.length);

    if (!codes.length) {
      container.innerHTML = `<p class="muted-text" style="padding:8px 0">No hay códigos pendientes.</p>`;
      return;
    }

    container.innerHTML = codes.map((c) => {
      const minsLeft = Math.max(0, Math.round((new Date(c.expires) - Date.now()) / 60000));
      const phone    = (c.phone || "").replace(/\D/g, "");
      const msg      = encodeURIComponent(`Hola ${c.name}, tu código de recuperación de Canopia es: ${c.code} (válido ${minsLeft} min)`);
      const expired  = minsLeft === 0;

      return `
        <div class="recovery-card ${expired ? "recovery-card--expired" : ""}">
          <div class="recovery-top">
            <span class="recovery-code">${escapeHtml(c.code)}</span>
            <span class="recovery-timer ${expired ? "recovery-timer--expired" : ""}">
              ${expired ? "⚠ Expirado" : `⏱ ${minsLeft} min restantes`}
            </span>
          </div>
          <p class="recovery-user">
            <strong>${escapeHtml(c.name)}</strong>
            ${c.email ? `· ${escapeHtml(c.email)}` : ""}
            ${phone   ? `· ${escapeHtml(c.phone)}` : ""}
          </p>
          ${phone && !expired ? `
            <a class="btn-whatsapp"
               href="https://wa.me/${phone}?text=${msg}"
               target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.553 4.116 1.52 5.847L0 24l6.335-1.502A11.954 11.954 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 0 1-5.006-1.368l-.36-.214-3.76.892.948-3.653-.234-.374A9.818 9.818 0 1 1 12 21.818z"/></svg>
              Enviar por WhatsApp
            </a>` : ""}
        </div>`;
    }).join("");

  } catch (err) {
    container.innerHTML = `<p class="muted-text" style="padding:8px 0;color:var(--red)">${escapeHtml(err.message)}</p>`;
  }
}

function updateRecoveryBadge(count) {
  const badge = document.querySelector("#recovery-badge");
  if (!badge) return;
  badge.textContent = count > 0 ? count : "";
  badge.hidden      = count === 0;
}

async function refreshRecoveryBadge() {
  try {
    const res  = await fetch(RECOVERY_API, {
      headers: { "x-admin-password": localStorage.getItem(sessionKey) || "" },
    });
    const data = await res.json().catch(() => ({}));
    updateRecoveryBadge((data.codes || []).length);
  } catch { /* silently ignore */ }
}

// ════════════════════════════════════════
//  REPORTES + GRÁFICOS + GROQ
// ════════════════════════════════════════
const GROQ_API  = "/api/admin/groq"; // proxy seguro — la key vive en Cloudflare env
const ANALYTICS = "https://canopiagrow.com/api/analytics";

let reportData = null; // cache

async function loadReports() {
  document.querySelector("#report-groq-btn").disabled = true;
  document.querySelector("#report-groq-btn").textContent = "Cargando datos…";

  try {
    // Fetch analytics + orders en paralelo
    const [analyticsRes, ordersRes] = await Promise.all([
      fetch(ANALYTICS, { headers: { "x-admin-password": localStorage.getItem(sessionKey) || "" } }).catch(() => ({ json: () => ({ analytics: [] }) })),
      api("/api/admin/orders"),
    ]);

    const analyticsData = await analyticsRes.json().catch(() => ({ analytics: [] }));
    const analytics = analyticsData.analytics || [];

    reportData = { analytics, orders: ordersRes.orders || [], products };

    drawSalesChart(reportData.orders);
    drawHoursChart(analytics);
    drawProductsChart(analytics);

  } catch (err) {
    console.error("Error cargando reportes:", err);
  } finally {
    document.querySelector("#report-groq-btn").disabled = false;
    document.querySelector("#report-groq-btn").textContent = "✦ Generar análisis con IA";
  }
}

// ─── Gráfico: ventas por día ───
function drawSalesChart(orders) {
  const canvas = document.querySelector("#chart-sales");
  if (!canvas) return;

  // Agrupar por día (últimos 30 días)
  const map = {};
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    map[d.toISOString().slice(0,10)] = 0;
  }
  orders.filter(o => o.status === "confirmado").forEach(o => {
    const day = (o.created_at || "").slice(0,10);
    if (day in map) map[day] += Number(o.total) || 0;
  });

  const labels = Object.keys(map).map(d => d.slice(5)); // MM-DD
  const values = Object.values(map);
  const total  = values.reduce((a,b) => a+b, 0);

  const el = document.querySelector("#chart-sales-total");
  if (el) el.textContent = money.format(total) + " total";

  drawBarChart(canvas, labels, values, "#b8f000");
}

// ─── Gráfico: tráfico por hora ───
function drawHoursChart(analytics) {
  const canvas = document.querySelector("#chart-hours");
  if (!canvas) return;

  const map = {};
  for (let h = 0; h < 24; h++) map[String(h).padStart(2,"0")] = 0;

  analytics.filter(a => a.event === "pageview").forEach(a => {
    const h = String(a.hour || "00").padStart(2,"0");
    if (h in map) map[h] += Number(a.count) || 0;
  });

  const labels = Object.keys(map).map(h => h + "h");
  const values = Object.values(map);
  const total  = values.reduce((a,b) => a+b, 0);

  const el = document.querySelector("#chart-hours-total");
  if (el) el.textContent = total + " visitas";

  drawBarChart(canvas, labels, values, "#3498db");
}

// ─── Gráfico: productos más vistos ───
function drawProductsChart(analytics) {
  const canvas = document.querySelector("#chart-products");
  if (!canvas) return;

  const map = {};
  analytics.filter(a => a.event === "product_view" && a.product_id).forEach(a => {
    map[a.product_id] = (map[a.product_id] || 0) + (Number(a.count) || 0);
  });

  const sorted = Object.entries(map).sort((a,b) => b[1]-a[1]).slice(0,8);
  if (!sorted.length) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "#888";
    ctx.font = "13px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Sin datos de vistas todavía", canvas.width/2, canvas.height/2);
    return;
  }

  // Resolver nombres desde products array
  const labels = sorted.map(([id]) => {
    const p = products.find(p => p.id === id);
    return p ? p.name.slice(0,14) : id.slice(0,14);
  });
  const values = sorted.map(([,v]) => v);
  const total  = values.reduce((a,b) => a+b, 0);

  const el = document.querySelector("#chart-products-total");
  if (el) el.textContent = total + " vistas";

  drawBarChart(canvas, labels, values, "#e67e22");
}

// ─── Motor de gráfico de barras (canvas puro) ───
function drawBarChart(canvas, labels, values, color) {
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth  || 600;
  const H   = canvas.height;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + "px";
  canvas.style.height = H + "px";

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const PAD    = { top: 16, right: 16, bottom: 36, left: 48 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top  - PAD.bottom;
  const max    = Math.max(...values, 1);
  const barW   = chartW / labels.length;

  // Grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + chartH - (chartH * i / 4);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + chartW, y); ctx.stroke();
    ctx.fillStyle   = "#666";
    ctx.font        = "10px Inter, sans-serif";
    ctx.textAlign   = "right";
    const val = Math.round(max * i / 4);
    ctx.fillText(val > 999 ? (val/1000).toFixed(1)+"k" : val, PAD.left - 6, y + 3);
  }

  // Bars
  values.forEach((v, i) => {
    const bH  = (v / max) * chartH;
    const x   = PAD.left + i * barW + barW * 0.15;
    const y   = PAD.top  + chartH - bH;
    const bWr = barW * 0.7;

    // Bar fill
    const grad = ctx.createLinearGradient(0, y, 0, y + bH);
    grad.addColorStop(0, color);
    grad.addColorStop(1, color + "55");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, bWr, bH, [3, 3, 0, 0]);
    ctx.fill();

    // Label
    ctx.fillStyle   = "#666";
    ctx.font        = "9px Inter, sans-serif";
    ctx.textAlign   = "center";
    ctx.save();
    ctx.translate(x + bWr / 2, PAD.top + chartH + 4);
    if (labels.length > 12) { ctx.rotate(-Math.PI/4); ctx.textAlign = "right"; }
    ctx.fillText(labels[i], 0, 10);
    ctx.restore();
  });
}

// ─── Groq: generar análisis ───
async function generateGroqReport() {
  if (!reportData) { await loadReports(); }

  const btn = document.querySelector("#report-groq-btn");
  const panel = document.querySelector("#groq-panel");
  const output = document.querySelector("#groq-output");
  const ts = document.querySelector("#groq-timestamp");

  btn.disabled = true;
  btn.textContent = "✦ Analizando…";
  panel.hidden = false;
  output.innerHTML = `<p class="muted-text">Groq está analizando tus datos…</p>`;

  // Preparar resumen de datos para mandar a Groq
  const { orders, products: prods, analytics } = reportData;
  const confirmed = orders.filter(o => o.status === "confirmado");
  const pending   = orders.filter(o => o.status === "pendiente");
  const lowStock  = prods.filter(p => Number(p.stock) <= 5);

  // Top productos vendidos
  const soldMap = {};
  confirmed.forEach(o => {
    JSON.parse(o.items_json || "[]").forEach(item => {
      soldMap[item.name] = (soldMap[item.name] || 0) + item.quantity;
    });
  });
  const topSold = Object.entries(soldMap).sort((a,b)=>b[1]-a[1]).slice(0,5);

  // Top productos vistos
  const viewMap = {};
  analytics.filter(a => a.event === "product_view").forEach(a => {
    if (a.product_id) viewMap[a.product_id] = (viewMap[a.product_id]||0) + Number(a.count||0);
  });
  const topViewed = Object.entries(viewMap).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([id,v]) => {
    const p = prods.find(p=>p.id===id);
    return [(p?.name||id), v];
  });

  const totalRevenue = confirmed.reduce((s,o)=>s+Number(o.total||0),0);
  const totalVisits  = analytics.filter(a=>a.event==="pageview").reduce((s,a)=>s+Number(a.count||0),0);

  const prompt = `Sos el analista de Canopia, una tienda grow. Datos reales últimos 30 días:
- Pedidos confirmados: ${confirmed.length} | Facturado: $${totalRevenue.toLocaleString("es-AR")}
- Pedidos pendientes: ${pending.length}
- Visitas: ${totalVisits} | Productos sin stock: ${prods.filter(p=>Number(p.stock)===0).length}
- Stock bajo (≤5): ${lowStock.map(p=>p.name+"("+p.stock+")").join(", ")||"ninguno"}
- Top ventas: ${topSold.map(([n,q])=>n+" x"+q).join(", ")||"sin datos"}
- Top vistos: ${topViewed.map(([n,v])=>n+" ("+v+")").join(", ")||"sin datos"}

Generá un informe breve y concreto con estas secciones (sin markdown, en texto plano):
1. Resumen ejecutivo (2 oraciones)
2. Ventas (tendencias clave)
3. Tráfico (comportamiento)
4. Stock (alertas urgentes)
5. Recomendaciones (3 puntos accionables)
Sé directo, usá los números reales.`;

  try {
    const res = await fetch(GROQ_API, {
      method: "POST",
      headers: { ...authHeaders() },
      body: JSON.stringify({ prompt, type: "report" }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error de Groq");

    const text = data.text || "Sin respuesta.";
    output.innerHTML = text
      .split("\n")
      .map(line => {
        if (line.startsWith("# "))  return `<h3>${line.slice(2)}</h3>`;
        if (line.startsWith("## ")) return `<h4>${line.slice(3)}</h4>`;
        if (line.match(/^\d+\./))   return `<p class="groq-point">${line}</p>`;
        if (line.startsWith("- "))  return `<p class="groq-bullet">• ${line.slice(2)}</p>`;
        if (line.trim() === "")     return `<br>`;
        return `<p>${line}</p>`;
      }).join("");

    if (ts) ts.textContent = "Generado " + new Date().toLocaleString("es-AR");

  } catch (err) {
    output.innerHTML = `<p style="color:var(--red)">Error: ${escapeHtml(err.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "✦ Generar análisis con IA";
  }
}

// ════════════════════════════════════════
//  NOTIFICACIONES
// ════════════════════════════════════════
async function loadNotifications() {
  const list = document.querySelector("#notif-list");
  if (!list) return;
  list.innerHTML = `<p class="muted-text" style="padding:8px 0">Analizando…</p>`;

  const notifs = [];

  try {
    // 1. Pedidos pendientes
    const ordersData = await api("/api/admin/orders?status=pendiente");
    const pending = ordersData.orders || [];
    if (pending.length > 0) {
      notifs.push({
        type: "warning",
        icon: "📋",
        title: `${pending.length} pedido${pending.length>1?"s":""} pendiente${pending.length>1?"s":""}`,
        body: pending.map(o=>`#${o.id} — ${o.customer_name} — ${money.format(o.total)}`).join("<br>"),
        action: "orders",
        actionLabel: "Ver pedidos",
      });
    }

    // 2. Stock bajo
    const lowStock = products.filter(p => Number(p.stock) > 0 && Number(p.stock) <= 5);
    const noStock  = products.filter(p => Number(p.stock) === 0);
    if (noStock.length > 0) {
      notifs.push({
        type: "danger",
        icon: "🚫",
        title: `${noStock.length} producto${noStock.length>1?"s":""} sin stock`,
        body: noStock.map(p=>escapeHtml(p.name)).join(", "),
        action: "inventory",
        actionLabel: "Ver inventario",
      });
    }
    if (lowStock.length > 0) {
      notifs.push({
        type: "warning",
        icon: "⚠️",
        title: `${lowStock.length} producto${lowStock.length>1?"s":""} con stock bajo (≤5 unidades)`,
        body: lowStock.map(p=>`${escapeHtml(p.name)}: ${p.stock} ud`).join(", "),
        action: "inventory",
        actionLabel: "Ver inventario",
      });
    }

    // 3. Códigos de recuperación activos
    try {
      const recRes  = await fetch(RECOVERY_API, { headers: { "x-admin-password": localStorage.getItem(sessionKey)||"" } });
      const recData = await recRes.json().catch(()=>({}));
      const codes   = (recData.codes||[]);
      if (codes.length > 0) {
        notifs.push({
          type: "info",
          icon: "🔑",
          title: `${codes.length} código${codes.length>1?"s":""} de recuperación activo${codes.length>1?"s":""}`,
          body: codes.map(c=>`${escapeHtml(c.name||"")} — ${Math.max(0,Math.round((new Date(c.expires)-Date.now())/60000))} min restantes`).join("<br>"),
          action: "recovery",
          actionLabel: "Ver códigos",
        });
      }
    } catch {}

    // 4. Groq analiza las notificaciones y agrega insights
    if (notifs.length > 0 || products.length > 0) {
      const summary = [
        pending.length   ? `${pending.length} pedidos pendientes` : null,
        noStock.length   ? `${noStock.length} productos sin stock` : null,
        lowStock.length  ? `${lowStock.length} con stock bajo` : null,
        `${products.length} productos en catálogo`,
      ].filter(Boolean).join(", ");

      try {
        const groqRes = await fetch(GROQ_API, {
          method: "POST",
          headers: { ...authHeaders() },
          body: JSON.stringify({
            prompt: `Sos el asistente de Canopia, una tienda grow. Basado en estos datos: ${summary}. 
              Generá EXACTAMENTE 2-3 alertas o consejos urgentes y concretos en español, en formato de lista corta. 
              Solo el texto, sin títulos, sin markdown, sin emojis. Máximo 3 líneas.`,
            type: "notif",
          }),
        });
        const groqData = await groqRes.json();
        const insight  = groqData.text;
        if (insight) {
          notifs.push({
            type: "ai",
            icon: "✦",
            title: "Análisis de IA",
            body: escapeHtml(insight).replace(/\n/g,"<br>"),
          });
        }
      } catch {}
    }

  } catch (err) {
    notifs.push({ type:"danger", icon:"⚠️", title:"Error al cargar datos", body: escapeHtml(err.message) });
  }

  // Actualizar badge
  const badge = document.querySelector("#notif-badge");
  const count = document.querySelector("#notif-count");
  const critical = notifs.filter(n => n.type === "danger" || n.type === "warning").length;
  [badge, count].forEach(el => {
    if (!el) return;
    el.textContent = critical > 0 ? critical : "";
    el.hidden = critical === 0;
  });

  if (!notifs.length) {
    list.innerHTML = `<div class="notif-empty">✅ Todo en orden, no hay alertas.</div>`;
    return;
  }

  list.innerHTML = notifs.map(n => `
    <div class="notif-card notif-card--${n.type}">
      <div class="notif-head">
        <span class="notif-icon">${n.icon}</span>
        <strong class="notif-title">${n.title}</strong>
      </div>
      <p class="notif-body">${n.body}</p>
      ${n.action ? `<button type="button" class="btn-ghost btn-sm" data-nav="${n.action}">${n.actionLabel}</button>` : ""}
    </div>
  `).join("");

  list.querySelectorAll("[data-nav]").forEach(btn => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.nav));
  });
}

// ════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ════════════════════════════════════════
//  MIGRACIÓN DE IMÁGENES LEGACY
//  Detecta y migra imágenes en URLs
//  temporales (PocketBase, trycloudflare)
//  a GitHub de forma segura.
// ════════════════════════════════════════

// Mostrar u ocultar el panel de migración desde cualquier sección
function showMigrationPanel(show = true) {
  const panel = document.querySelector("#migration-panel");
  if (panel) panel.hidden = !show;
}

async function scanLegacyImages() {
  const summary  = document.querySelector("#migration-summary");
  const list     = document.querySelector("#migration-list");
  const badge    = document.querySelector("#migration-count-badge");
  const scanBtn  = document.querySelector("#migration-scan-btn");

  if (!summary || !list) return;

  if (scanBtn) { scanBtn.disabled = true; scanBtn.textContent = "Escaneando…"; }
  summary.textContent = "Analizando productos…";
  list.innerHTML      = "";

  try {
    const data = await api("/api/admin/migrate-images");

    summary.textContent = data.summary || "";

    if (badge) {
      badge.textContent = data.flagged > 0 ? data.flagged : "";
      badge.hidden      = data.flagged === 0;
    }

    if (!data.flagged || data.products.length === 0) {
      list.innerHTML = `<div class="migration-all-ok">
        <span style="font-size:2rem">✅</span>
        <p>Todos los productos usan URLs permanentes.</p>
        <p class="muted-text">No hay imágenes legacy que migrar.</p>
      </div>`;
      return;
    }

    list.innerHTML = data.products.map((p) => `
      <div class="migration-product" id="migprod-${escapeHtml(p.id)}">
        <div class="migration-product-head">
          <strong>${escapeHtml(p.name)}</strong>
          <span class="cat-badge">${escapeHtml(p.id)}</span>
          <span class="muted-text">${p.legacyImages.length} imagen${p.legacyImages.length !== 1 ? "es" : ""} legacy de ${p.totalImages}</span>
        </div>
        <div class="migration-images">
          ${p.legacyImages.map((url) => `
            <div class="migration-img-row" id="migrow-${btoa(url).slice(0, 20).replace(/[^a-zA-Z0-9]/g, '')}">
              <img class="migration-thumb" src="${escapeHtml(url)}" alt=""
                   onerror="this.style.opacity='0.2';this.title='URL inaccesible'"
                   loading="lazy" />
              <div class="migration-img-info">
                <span class="migration-url" title="${escapeHtml(url)}">${escapeHtml(url.length > 60 ? url.slice(0, 57) + "…" : url)}</span>
                <span class="migration-img-status" data-url="${escapeHtml(url)}"></span>
              </div>
              <button type="button" class="btn-ghost btn-sm migration-migrate-btn"
                      data-product-id="${escapeHtml(p.id)}"
                      data-url="${escapeHtml(url)}">
                Migrar →
              </button>
            </div>`).join("")}
        </div>
        <div class="migration-product-actions">
          <button type="button" class="btn-primary btn-sm migration-migrate-all-btn"
                  data-product-id="${escapeHtml(p.id)}"
                  data-urls="${escapeHtml(JSON.stringify(p.legacyImages))}">
            Migrar todas las imágenes de este producto
          </button>
        </div>
      </div>`).join("");

    // ── Listeners: migrar imagen individual ──────
    list.querySelectorAll(".migration-migrate-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        migrateSingleImage(btn.dataset.productId, btn.dataset.url, btn);
      });
    });

    // ── Listeners: migrar todas de un producto ───
    list.querySelectorAll(".migration-migrate-all-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const urls = JSON.parse(btn.dataset.urls || "[]");
        btn.disabled = true;
        btn.textContent = "Migrando…";
        for (const url of urls) {
          // Buscar el botón individual de esa URL y simular clic
          const row = list.querySelector(`.migration-migrate-btn[data-url="${CSS.escape(url)}"]`);
          if (row && !row.disabled) {
            await migrateSingleImage(btn.dataset.productId, url, row);
          }
        }
        btn.textContent = "✓ Completado";
        // Refrescar el escaneo después de migrar todo
        setTimeout(() => scanLegacyImages(), 1200);
      });
    });

  } catch (err) {
    summary.textContent = `Error al escanear: ${err.message}`;
    list.innerHTML = `<p style="color:var(--red);padding:8px 0">${escapeHtml(err.message)}</p>`;
  } finally {
    if (scanBtn) { scanBtn.disabled = false; scanBtn.textContent = "↺ Escanear productos"; }
  }
}

async function migrateSingleImage(productId, url, btn) {
  const statusEl = btn?.closest(".migration-img-row")?.querySelector(".migration-img-status");

  if (btn) { btn.disabled = true; btn.textContent = "Migrando…"; }
  if (statusEl) { statusEl.textContent = "Subiendo…"; statusEl.className = "migration-img-status uploading"; }

  try {
    const data = await api("/api/admin/migrate-images", {
      method: "POST",
      body: JSON.stringify({ productId, imageUrl: url }),
    });

    if (statusEl) {
      statusEl.textContent = "✓ Migrada";
      statusEl.className   = "migration-img-status ok";
    }
    if (btn) {
      btn.textContent  = "✓ Listo";
      btn.className    = "btn-ghost btn-sm";
      btn.style.color  = "var(--lime)";
    }

    // Actualizar la lista de productos en memoria
    const prod = products.find((p) => p.id === productId);
    if (prod && data.newUrl) {
      const imgs = parseImages(prod.image);
      prod.image = imgs.map((u) => u === url ? data.newUrl : u).join(",");
    }

    return data.newUrl;
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = `✕ ${err.message.slice(0, 40)}`;
      statusEl.className   = "migration-img-status error";
    }
    if (btn) {
      btn.disabled    = false;
      btn.textContent = "Reintentar";
    }
    return null;
  }
}

// ════════════════════════════════════════
//  EVENT LISTENERS
// ════════════════════════════════════════
document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.querySelector("#password").value;
  const message  = document.querySelector("#login-message");
  localStorage.setItem(sessionKey, password);
  message.textContent = "Verificando…";
  try {
    await api("/api/admin/products");
    showAdmin();
  } catch (error) {
    localStorage.removeItem(sessionKey);
    message.textContent = "Contraseña incorrecta.";
  }
});

document.querySelector("#product-form").addEventListener("submit", saveProduct);
document.querySelector("#cat-form").addEventListener("submit", saveCategoryForm);
document.querySelector("#cat-cancel-btn").addEventListener("click", resetCatForm);

document.querySelector("#refresh").addEventListener("click", loadAll);
document.querySelector("#new-product").addEventListener("click", () => {
  fillForm({ visible: true });
  navigateTo("products");
});
document.querySelector("#cancel-edit").addEventListener("click", () => fillForm({ visible: true }));
document.querySelector("#logout").addEventListener("click", () => {
  localStorage.removeItem(sessionKey);
  location.reload();
});
document.querySelector("#search-input")?.addEventListener("input", () => applyFilter(1));

document.querySelector("#recovery-refresh")?.addEventListener("click", loadRecoveryCodes);
document.querySelector("#report-refresh")?.addEventListener("click", loadReports);
document.querySelector("#report-groq-btn")?.addEventListener("click", generateGroqReport);
document.querySelector("#notif-refresh")?.addEventListener("click", loadNotifications);
document.querySelector("#migration-scan-btn")?.addEventListener("click", scanLegacyImages);

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    navigateTo(item.dataset.section);
    if (item.dataset.section === "recovery")  loadRecoveryCodes();
    if (item.dataset.section === "reports")   loadReports();
    if (item.dataset.section === "config")    loadNotifications();
  });
});

// ─── Auto-login ───
(async () => {
  const saved = localStorage.getItem(sessionKey);
  if (saved) {
    try { await api("/api/admin/products"); showAdmin(); }
    catch { localStorage.removeItem(sessionKey); }
  }
})();

// ─── Polling: badge de pedidos pendientes cada 15s ───
setInterval(() => {
  if (localStorage.getItem(sessionKey)) {
    updateOrdersBadge();
    refreshRecoveryBadge();
  }
}, 15000);
