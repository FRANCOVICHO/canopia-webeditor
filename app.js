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
//  IMAGE HELPERS (URL + PocketBase upload)
// ════════════════════════════════════════
const PB_URL = "https://jeans-statement-wave-transactions.trycloudflare.com";

function parseImages(raw) {
  if (!raw) return [];
  if (raw.trim().startsWith("[")) {
    try { return JSON.parse(raw).filter(Boolean); } catch { return [raw]; }
  }
  return [raw];
}

function serializeImages(arr) {
  const clean = arr.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  return JSON.stringify(clean);
}

let formImages = [];

function renderImgPreviews() {
  const wrap = document.querySelector("#img-previews");
  if (!wrap) return;
  if (!formImages.length) { wrap.innerHTML = ""; return; }

  wrap.innerHTML = formImages.map((url, i) => `
    <div class="img-thumb-wrap">
      <img class="img-thumb" src="${escapeHtml(url)}" alt=""
           onerror="this.style.opacity='0.3';this.title='URL inválida'" />
      <button type="button" class="img-thumb-remove" data-idx="${i}" title="Quitar">✕</button>
      ${i === 0 ? '<span class="img-thumb-main">Principal</span>' : ""}
    </div>
  `).join("");

  wrap.querySelectorAll("[data-idx]").forEach((btn) => {
    btn.addEventListener("click", () => {
      formImages.splice(Number(btn.dataset.idx), 1);
      syncImgHidden();
      renderImgPreviews();
    });
  });
}

function syncImgHidden() {
  const h = document.querySelector("#img-hidden");
  if (h) h.value = serializeImages(formImages);
}

function addImageUrl(url) {
  url = url.trim();
  if (!url) return;
  if (!formImages.includes(url)) {
    formImages.push(url);
    syncImgHidden();
    renderImgPreviews();
  }
}

async function uploadFileToPocketBase(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${PB_URL}/api/collections/product_images/records`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Error al subir la imagen");
  }
  const data = await res.json();
  // PocketBase URL format: /api/files/COLLECTION_ID/RECORD_ID/FILENAME
  return `${PB_URL}/api/files/${data.collectionId}/${data.id}/${data.file}`;
}

async function handleImageFiles(files) {
  const zone = document.querySelector("#img-drop-zone");
  const status = document.querySelector("#img-upload-status");
  const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

  for (const file of files) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      if (status) status.textContent = `Error: Solo JPG, PNG o WEBP permitidos.`;
      setTimeout(() => { if (status) status.textContent = ""; }, 3000);
      continue;
    }
    if (file.size > MAX_SIZE) {
      if (status) status.textContent = `Error: El archivo supera los 5MB.`;
      setTimeout(() => { if (status) status.textContent = ""; }, 3000);
      continue;
    }

    if (status) status.textContent = `Subiendo ${file.name}…`;
    if (zone) zone.classList.add("uploading");
    try {
      const url = await uploadFileToPocketBase(file);
      addImageUrl(url);
      if (status) status.textContent = "✓ Subida correctamente";
      setTimeout(() => { if (status) status.textContent = ""; }, 2000);
    } catch (err) {
      if (status) status.textContent = `Error: ${err.message}`;
    } finally {
      if (zone) zone.classList.remove("uploading");
    }
  }
}

function setupImageZone() {
  const zone    = document.querySelector("#img-drop-zone");
  const fileIn  = document.querySelector("#img-file-input");
  const urlIn   = document.querySelector("#img-url-input");
  const addBtn  = document.querySelector("#img-url-add");

  if (zone && fileIn) {
    zone.addEventListener("click", () => fileIn.click());
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      handleImageFiles([...e.dataTransfer.files]);
    });
    fileIn.addEventListener("change", () => {
      handleImageFiles([...fileIn.files]);
      fileIn.value = "";
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
    urlIn.addEventListener("paste", () => setTimeout(() => {
      if (urlIn.value.trim().startsWith("http")) doAddUrl();
    }, 50));
  }
}

// ════════════════════════════════════════
//  CATEGORY PICKER (dropdown in form)
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
  el.innerHTML = `<div class="dash-grid">${featured.map((p) => `
    <div class="dash-card">
      <div class="dash-img">${p.image ? `<img src="${escapeHtml(p.image)}" alt="" />` : "🌿"}</div>
      <div class="dash-info"><strong>${escapeHtml(p.name)}</strong><span class="cat-badge">${escapeHtml(p.category)}</span></div>
      <div class="dash-meta"><span class="price-cell">${money.format(p.price)}</span><span class="${Number(p.stock) === 0 ? "stock-zero" : "muted-text"}">Stock: ${p.stock}</span></div>
    </div>`).join("")}</div>`;
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
    return `<tr>
      <td><div class="prod-cell">
        <div class="prod-img" style="display:inline-flex;align-items:center;justify-content:center;font-size:16px;">
          ${p.image ? `<img src="${escapeHtml(p.image)}" alt="" style="width:36px;height:36px;border-radius:6px;object-fit:cover;" />` : "🌿"}
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
    const imgs = parseImages(p.image);
    const thumb = imgs[0] || "";
    const imgHtml = thumb
      ? `<img class="prod-img" src="${escapeHtml(thumb)}" alt="" />`
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

  // images
  formImages = parseImages(product.image);
  syncImgHidden();
  renderImgPreviews();

  form.name.focus();
  document.querySelector(".edit-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveProduct(event) {
  event.preventDefault();
  const form  = event.currentTarget;
  const state = document.querySelector("#save-state");
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.price    = Number(payload.price    || 0);
  payload.stock    = Number(payload.stock    || 0);
  payload.featured = form.featured.checked;
  payload.visible  = form.visible.checked;
  // payload.image already contains the serialized images from #img-hidden

  state.textContent = "Guardando…";
  try {
    await api("/api/admin/products", { method: "POST", body: JSON.stringify(payload) });
    state.textContent = "✓ Guardado";
    setTimeout(() => { state.textContent = ""; }, 3000);
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
const RECOVERY_API = "https://canopiagrow.pages.dev/api/auth?action=recovery-codes";

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
const ANALYTICS = "https://canopiagrow.pages.dev/api/analytics";

let reportData = null; // cache

async function loadReports() {
  document.querySelector("#report-groq-btn").disabled = true;
  document.querySelector("#report-groq-btn").textContent = "Cargando datos…";

  try {
    // Fetch analytics + orders en paralelo
    const [analyticsRes, ordersRes] = await Promise.all([
      fetch(ANALYTICS, { headers: { "x-admin-password": localStorage.getItem(sessionKey) || "" } }),
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
