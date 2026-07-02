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
  dashboard:  { title: "Dashboard",       sub: "Resumen general del catálogo.",                 crumb: "Dashboard",     actions: false },
  products:   { title: "Editar catálogo", sub: "Gestioná tus productos, precios, stock y más.", crumb: "Productos",     actions: true  },
  categories: { title: "Categorías",      sub: "Creá y administrá las categorías.",             crumb: "Categorías",    actions: false },
  orders:     { title: "Pedidos",         sub: "Últimos pedidos confirmados desde la web.",     crumb: "Pedidos",       actions: false },
  clients:    { title: "Clientes",        sub: "Clientes que realizaron pedidos.",              crumb: "Clientes",      actions: false },
  inventory:  { title: "Inventario",      sub: "Stock actual de todos los productos.",          crumb: "Inventario",    actions: false },
  promos:     { title: "Promociones",     sub: "Gestión de promociones y descuentos.",          crumb: "Promociones",   actions: false },
  reports:    { title: "Reportes",        sub: "Análisis y métricas del negocio.",              crumb: "Reportes",      actions: false },
  config:     { title: "Configuración",   sub: "Ajustes generales del panel.",                  crumb: "Configuración", actions: false },
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
//  IMAGE HELPERS
// ════════════════════════════════════════
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

// In-memory list of image URLs for the current form
let formImages = [];

function renderImgPreviews() {
  const wrap = document.querySelector("#img-previews");
  if (!wrap) return;
  if (!formImages.length) { wrap.innerHTML = ""; return; }

  wrap.innerHTML = formImages.map((url, i) => `
    <div class="img-thumb-wrap">
      <img class="img-thumb" src="${escapeHtml(url)}" alt="" />
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

function addImageUrls(urls) {
  urls.forEach((u) => { if (u && !formImages.includes(u)) formImages.push(u); });
  syncImgHidden();
  renderImgPreviews();
}

// Convert File to base64 data URL (so it can be stored & displayed immediately)
function fileToDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}

async function handleImageFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const dataUrl = await fileToDataUrl(file);
    if (!formImages.includes(dataUrl)) formImages.push(dataUrl);
  }
  syncImgHidden();
  renderImgPreviews();
}

function setupImageZone() {
  const zone  = document.querySelector("#img-drop-zone");
  const input = document.querySelector("#img-file-input");
  if (!zone || !input) return;

  zone.addEventListener("click", () => input.click());

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    handleImageFiles([...e.dataTransfer.files]);
  });

  input.addEventListener("change", () => {
    handleImageFiles([...input.files]);
    input.value = "";
  });
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
const authHeaders = () => ({
  "Content-Type": "application/json",
  "x-admin-password": localStorage.getItem(sessionKey) || "",
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
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

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => navigateTo(item.dataset.section));
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
  if (localStorage.getItem(sessionKey)) updateOrdersBadge();
}, 15000);
