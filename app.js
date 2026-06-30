const sessionKey = "canopia_admin_password";
const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

let products = [];
let orders = [];

// ─── Pagination ───
const PAGE_SIZE = 8;
let currentPage = 1;
let filteredProducts = [];

// ─── Sección activa ───
let activeSection = "products";

const sectionMeta = {
  dashboard:  { title: "Dashboard",       sub: "Resumen general del catálogo.",                   crumb: "Dashboard",    actions: false },
  products:   { title: "Editar catálogo", sub: "Gestioná tus productos, precios, stock y más.",   crumb: "Productos",    actions: true  },
  categories: { title: "Categorías",      sub: "Productos agrupados por categoría.",               crumb: "Categorías",   actions: false },
  orders:     { title: "Pedidos",         sub: "Últimos pedidos confirmados desde la web.",        crumb: "Pedidos",      actions: false },
  clients:    { title: "Clientes",        sub: "Clientes que realizaron pedidos.",                 crumb: "Clientes",     actions: false },
  inventory:  { title: "Inventario",      sub: "Stock actual de todos los productos.",             crumb: "Inventario",   actions: false },
  promos:     { title: "Promociones",     sub: "Gestión de promociones y descuentos.",             crumb: "Promociones",  actions: false },
  reports:    { title: "Reportes",        sub: "Análisis y métricas del negocio.",                 crumb: "Reportes",     actions: false },
  config:     { title: "Configuración",   sub: "Ajustes generales del panel.",                     crumb: "Configuración",actions: false },
};

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
  renderCategories();
  renderInventory();
}

async function loadOrders() {
  const data = await api("/api/admin/orders");
  orders = data.orders || [];
  renderOrders();
  renderClients();
}

// ════════════════════════════════════════
//  NAVEGACIÓN ENTRE SECCIONES
// ════════════════════════════════════════
function navigateTo(section) {
  activeSection = section;

  // Actualizar nav activo
  document.querySelectorAll(".nav-item").forEach((n) => {
    n.classList.toggle("active", n.dataset.section === section);
  });

  // Mostrar/ocultar secciones
  document.querySelectorAll(".section-view").forEach((el) => {
    el.hidden = el.id !== `section-${section}`;
  });

  // Actualizar topbar
  const meta = sectionMeta[section] || {};
  document.querySelector("#bc-section").textContent = meta.crumb || section;
  document.querySelector("#page-title").textContent = meta.title || section;
  document.querySelector("#page-sub").textContent = meta.sub || "";

  const actions = document.querySelector("#topbar-actions");
  actions.style.display = meta.actions ? "" : "none";

  // Scroll top
  document.querySelector(".main-content").scrollTo({ top: 0, behavior: "smooth" });
}

// ════════════════════════════════════════
//  STATS
// ════════════════════════════════════════
function renderStats() {
  const total    = products.length;
  const totalStock = products.reduce((s, p) => s + (Number(p.stock) || 0), 0);
  const cats     = new Set(products.map((p) => p.category).filter(Boolean)).size;
  const noStock  = products.filter((p) => Number(p.stock) === 0).length;

  document.querySelector("#stat-total").textContent   = total;
  document.querySelector("#stat-stock").textContent   = totalStock.toLocaleString("es-AR");
  document.querySelector("#stat-cats").textContent    = cats;
  document.querySelector("#stat-nostock").textContent = noStock;
}

// ════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════
function renderDashboard() {
  const featured = products.filter((p) => p.featured).slice(0, 6);
  const el = document.querySelector("#dashboard-featured");
  if (!el) return;

  if (!featured.length) {
    el.innerHTML = `<p class="muted-text" style="padding:12px 0">No hay productos destacados.</p>`;
    return;
  }

  el.innerHTML = `
    <div class="dash-grid">
      ${featured.map((p) => `
        <div class="dash-card">
          <div class="dash-img">${p.image ? `<img src="${escapeHtml(p.image)}" alt="" />` : "🌿"}</div>
          <div class="dash-info">
            <strong>${escapeHtml(p.name)}</strong>
            <span class="cat-badge">${escapeHtml(p.category)}</span>
          </div>
          <div class="dash-meta">
            <span class="price-cell">${money.format(p.price)}</span>
            <span class="${Number(p.stock) === 0 ? "stock-zero" : "muted-text"}">Stock: ${p.stock}</span>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

// ════════════════════════════════════════
//  CATEGORÍAS
// ════════════════════════════════════════
function renderCategories() {
  const el = document.querySelector("#categories-body");
  if (!el) return;

  const map = {};
  products.forEach((p) => {
    const cat = p.category || "Sin categoría";
    if (!map[cat]) map[cat] = [];
    map[cat].push(p);
  });

  const cats = Object.keys(map).sort();
  if (!cats.length) {
    el.innerHTML = `<p class="muted-text" style="padding:12px 0">No hay productos.</p>`;
    return;
  }

  el.innerHTML = cats.map((cat) => `
    <div class="cat-group">
      <div class="cat-group-head">
        <span class="cat-badge">${escapeHtml(cat)}</span>
        <span class="muted-text">${map[cat].length} producto${map[cat].length !== 1 ? "s" : ""}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Producto</th><th>Precio</th><th>Stock</th><th>Visible</th></tr></thead>
          <tbody>
            ${map[cat].map((p) => `
              <tr>
                <td><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.id)}</small></td>
                <td class="price-cell">${money.format(p.price)}</td>
                <td class="${Number(p.stock) === 0 ? "stock-zero" : ""}">${p.stock}</td>
                <td>${p.visible ? `<span class="badge-green">Sí</span>` : `<span style="color:var(--muted)">No</span>`}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `).join("");
}

// ════════════════════════════════════════
//  PEDIDOS
// ════════════════════════════════════════
function renderOrders() {
  const list = document.querySelector("#orders-list");
  if (!list) return;

  if (!orders.length) {
    list.innerHTML = `<p class="muted-text" style="padding:12px 0">No hay pedidos todavía.</p>`;
    return;
  }

  list.innerHTML = orders.map((order) => {
    const items = JSON.parse(order.items_json || "[]");
    return `
      <article class="order-card">
        <strong>#${order.id} — ${escapeHtml(order.customer_name)}</strong>
        <p>${escapeHtml(order.customer_phone)} · ${new Date(order.created_at).toLocaleString("es-AR")} · ${money.format(order.total)}</p>
        <p>${items.map((i) => `${escapeHtml(i.name)} x${i.quantity}`).join(", ")}</p>
        ${order.customer_note ? `<p>Nota: ${escapeHtml(order.customer_note)}</p>` : ""}
      </article>
    `;
  }).join("");
}

// ════════════════════════════════════════
//  CLIENTES
// ════════════════════════════════════════
function renderClients() {
  const body = document.querySelector("#clients-body");
  if (!body) return;

  if (!orders.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted-text" style="padding:16px">No hay clientes todavía.</td></tr>`;
    return;
  }

  body.innerHTML = orders.map((order) => `
    <tr>
      <td><strong>#${order.id}</strong></td>
      <td><strong>${escapeHtml(order.customer_name)}</strong></td>
      <td>${escapeHtml(order.customer_phone)}</td>
      <td class="price-cell">${money.format(order.total)}</td>
      <td><small>${new Date(order.created_at).toLocaleString("es-AR")}</small></td>
    </tr>
  `).join("");
}

// ════════════════════════════════════════
//  INVENTARIO
// ════════════════════════════════════════
function renderInventory() {
  const body = document.querySelector("#inventory-body");
  if (!body) return;

  const sorted = [...products].sort((a, b) => Number(a.stock) - Number(b.stock));

  if (!sorted.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted-text" style="padding:16px">No hay productos.</td></tr>`;
    return;
  }

  body.innerHTML = sorted.map((p) => {
    const stock = Number(p.stock);
    let badge, badgeStyle;
    if (stock === 0)       { badge = "Sin stock";  badgeStyle = "color:var(--red);font-weight:700"; }
    else if (stock <= 5)   { badge = "Stock bajo"; badgeStyle = "color:#f0a500;font-weight:700"; }
    else                   { badge = "OK";         badgeStyle = "color:var(--lime);font-weight:700"; }

    return `
      <tr>
        <td>
          <div class="prod-cell">
            <div class="prod-img" style="display:inline-flex;align-items:center;justify-content:center;font-size:16px;">
              ${p.image ? `<img src="${escapeHtml(p.image)}" alt="" style="width:36px;height:36px;border-radius:6px;object-fit:cover;" />` : "🌿"}
            </div>
            <div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.id)}</small></div>
          </div>
        </td>
        <td><span class="cat-badge">${escapeHtml(p.category || "—")}</span></td>
        <td class="${stock === 0 ? "stock-zero" : ""}" style="font-weight:700">${stock}</td>
        <td style="${badgeStyle}">${badge}</td>
        <td class="price-cell">${money.format(p.price)}</td>
      </tr>
    `;
  }).join("");
}

// ════════════════════════════════════════
//  PRODUCTOS TABLE + FILTER
// ════════════════════════════════════════
function applyFilter(page = 1) {
  const q = (document.querySelector("#search-input")?.value || "").toLowerCase();
  filteredProducts = q
    ? products.filter((p) =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.id   || "").toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q),
      )
    : [...products];
  currentPage = page;
  renderProducts();
}

function renderProducts() {
  const body = document.querySelector("#products-body");
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredProducts.slice(start, start + PAGE_SIZE);

  body.innerHTML = pageItems.map((product) => {
    const stockClass = Number(product.stock) === 0 ? " stock-zero" : "";
    const imgHtml = product.image
      ? `<img class="prod-img" src="${escapeHtml(product.image)}" alt="" />`
      : `<div class="prod-img" style="display:inline-flex;align-items:center;justify-content:center;font-size:18px;">🌿</div>`;

    return `
      <tr>
        <td>
          <div class="prod-cell">
            ${imgHtml}
            <div>
              <strong>${escapeHtml(product.name)}</strong>
              <small>SKU: ${escapeHtml(product.id)}</small>
            </div>
          </div>
        </td>
        <td><span class="cat-badge">${escapeHtml(product.category || "—")}</span></td>
        <td class="price-cell">${money.format(product.price)}</td>
        <td class="${stockClass}">${product.stock}</td>
        <td>
          <label class="toggle" title="${product.visible ? "Visible" : "Oculto"}">
            <input type="checkbox" data-toggle="${escapeHtml(product.id)}" ${product.visible ? "checked" : ""} />
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </td>
        <td>
          <div class="row-actions">
            <button type="button" class="action-btn" data-edit="${escapeHtml(product.id)}" title="Editar">✏</button>
            <button type="button" class="action-btn delete" data-delete="${escapeHtml(product.id)}" title="Borrar">🗑</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  const countEl = document.querySelector("#table-count");
  if (countEl) {
    const end = Math.min(start + PAGE_SIZE, filteredProducts.length);
    countEl.textContent = filteredProducts.length > 0
      ? `Mostrando ${start + 1} a ${end} de ${filteredProducts.length} productos`
      : "No hay productos";
  }

  renderPagination(totalPages);

  body.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => fillForm(products.find((p) => p.id === btn.dataset.edit)));
  });
  body.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => deleteProduct(btn.dataset.delete));
  });
  body.querySelectorAll("[data-toggle]").forEach((chk) => {
    chk.addEventListener("change", () => toggleVisible(chk.dataset.toggle, chk.checked));
  });
}

async function toggleVisible(id, visible) {
  const product = products.find((p) => p.id === id);
  if (!product) return;
  try {
    await api("/api/admin/products", { method: "POST", body: JSON.stringify({ ...product, visible }) });
    product.visible = visible;
  } catch (err) {
    alert(err.message);
    applyFilter(currentPage);
  }
}

function renderPagination(totalPages) {
  const container = document.querySelector("#pagination");
  if (!container) return;
  if (totalPages <= 1) { container.innerHTML = ""; return; }

  const pages = buildPageList(currentPage, totalPages);
  container.innerHTML = pages.map((p) => {
    if (p === "prev") return `<button class="page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>‹</button>`;
    if (p === "next") return `<button class="page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""}>›</button>`;
    if (p === "...") return `<span class="page-btn dots">…</span>`;
    return `<button class="page-btn ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>`;
  }).join("");

  container.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => applyFilter(Number(btn.dataset.page)));
  });
}

function buildPageList(cur, total) {
  const list = ["prev"];
  if (total <= 7) {
    for (let i = 1; i <= total; i++) list.push(i);
  } else {
    list.push(1);
    if (cur > 3) list.push("...");
    for (let i = Math.max(2, cur - 1); i <= Math.min(total - 1, cur + 1); i++) list.push(i);
    if (cur < total - 2) list.push("...");
    list.push(total);
  }
  list.push("next");
  return list;
}

// ════════════════════════════════════════
//  FORM
// ════════════════════════════════════════
function fillForm(product = {}) {
  const form = document.querySelector("#product-form");
  form.id.value          = product.id || "";
  form.name.value        = product.name || "";
  form.category.value    = product.category || "";
  form.price.value       = product.price || 0;
  form.stock.value       = product.stock || 0;
  form.tag.value         = product.tag || "";
  form.image.value       = product.image || "";
  form.description.value = product.description || "";
  form.featured.checked  = Boolean(product.featured);
  form.visible.checked   = product.visible !== false;
  form.name.focus();
  document.querySelector(".edit-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveProduct(event) {
  event.preventDefault();
  const form    = event.currentTarget;
  const state   = document.querySelector("#save-state");
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.price    = Number(payload.price || 0);
  payload.stock    = Number(payload.stock || 0);
  payload.featured = form.featured.checked;
  payload.visible  = form.visible.checked;

  state.textContent = "Guardando…";
  try {
    await api("/api/admin/products", { method: "POST", body: JSON.stringify(payload) });
    state.textContent = "✓ Guardado";
    setTimeout(() => { state.textContent = ""; }, 3000);
    await loadProducts();
  } catch (error) {
    state.textContent = error.message;
  }
}

async function deleteProduct(id) {
  if (!confirm(`¿Borrar el producto "${id}"?`)) return;
  try {
    await api(`/api/admin/products?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadProducts();
  } catch (err) {
    alert(err.message);
  }
}

// ════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
document.querySelector("#refresh").addEventListener("click", loadAll);
document.querySelector("#new-product").addEventListener("click", () => { fillForm({ visible: true }); navigateTo("products"); });
document.querySelector("#cancel-edit").addEventListener("click", () => fillForm({ visible: true }));
document.querySelector("#logout").addEventListener("click", () => {
  localStorage.removeItem(sessionKey);
  location.reload();
});
document.querySelector("#search-input")?.addEventListener("input", () => applyFilter(1));

// Nav
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => navigateTo(item.dataset.section));
});

// ─── Auto-login si la contraseña ya fue validada ───
(async () => {
  const saved = localStorage.getItem(sessionKey);
  if (saved) {
    try {
      await api("/api/admin/products");
      showAdmin();
    } catch {
      localStorage.removeItem(sessionKey);
    }
  }
})();
