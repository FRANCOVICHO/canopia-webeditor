const fallbackPassword = "CanopiaGrowtech010626";
const sessionKey = "canopia_admin_password";
const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

let products = [];

// ─── Pagination ───
const PAGE_SIZE = 8;
let currentPage = 1;
let filteredProducts = [];

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
}

// ─── Stats ───
function renderStats() {
  const total = products.length;
  const totalStock = products.reduce((s, p) => s + (Number(p.stock) || 0), 0);
  const cats = new Set(products.map((p) => p.category).filter(Boolean)).size;
  const noStock = products.filter((p) => Number(p.stock) === 0).length;

  document.querySelector("#stat-total").textContent = total;
  document.querySelector("#stat-stock").textContent = totalStock.toLocaleString("es-AR");
  document.querySelector("#stat-cats").textContent = cats;
  document.querySelector("#stat-nostock").textContent = noStock;
}

// ─── Filter / Search ───
function applyFilter(page = 1) {
  const q = (document.querySelector("#search-input")?.value || "").toLowerCase();
  filteredProducts = q
    ? products.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(q) ||
          (p.id || "").toLowerCase().includes(q) ||
          (p.category || "").toLowerCase().includes(q),
      )
    : [...products];
  currentPage = page;
  renderProducts();
}

// ─── Render Table ───
function renderProducts() {
  const body = document.querySelector("#products-body");
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredProducts.slice(start, start + PAGE_SIZE);

  body.innerHTML = pageItems
    .map((product) => {
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
    })
    .join("");

  // Count text
  const countEl = document.querySelector("#table-count");
  if (countEl) {
    const end = Math.min(start + PAGE_SIZE, filteredProducts.length);
    countEl.textContent =
      filteredProducts.length > 0
        ? `Mostrando ${start + 1} a ${end} de ${filteredProducts.length} productos`
        : "No hay productos";
  }

  // Pagination
  renderPagination(totalPages);

  // Events: edit / delete
  body.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () =>
      fillForm(products.find((item) => item.id === btn.dataset.edit)),
    );
  });
  body.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => deleteProduct(btn.dataset.delete));
  });
  // Events: toggle visibility
  body.querySelectorAll("[data-toggle]").forEach((chk) => {
    chk.addEventListener("change", () => toggleVisible(chk.dataset.toggle, chk.checked));
  });
}

async function toggleVisible(id, visible) {
  const product = products.find((p) => p.id === id);
  if (!product) return;
  const updated = { ...product, visible };
  try {
    await api("/api/admin/products", { method: "POST", body: JSON.stringify(updated) });
    product.visible = visible;
  } catch (err) {
    alert(err.message);
    // revert checkbox
    applyFilter(currentPage);
  }
}

function renderPagination(totalPages) {
  const container = document.querySelector("#pagination");
  if (!container) return;
  if (totalPages <= 1) { container.innerHTML = ""; return; }

  const pages = buildPageList(currentPage, totalPages);
  container.innerHTML = pages
    .map((p) => {
      if (p === "prev")
        return `<button class="page-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>‹</button>`;
      if (p === "next")
        return `<button class="page-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""}>›</button>`;
      if (p === "...") return `<span class="page-btn dots">…</span>`;
      return `<button class="page-btn ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>`;
    })
    .join("");

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

// ─── Orders ───
async function loadOrders() {
  const data = await api("/api/admin/orders");
  const list = document.querySelector("#orders-list");
  if (!data.orders?.length) {
    list.innerHTML = "<p style='color:var(--muted);font-size:13px;padding:8px 0'>No hay compras todavía.</p>";
    return;
  }

  list.innerHTML = data.orders
    .map((order) => {
      const items = JSON.parse(order.items_json || "[]");
      return `
        <article class="order-card">
          <strong>#${order.id} — ${escapeHtml(order.customer_name)}</strong>
          <p>${escapeHtml(order.customer_phone)} · ${new Date(order.created_at).toLocaleString("es-AR")} · ${money.format(order.total)}</p>
          <p>${items.map((item) => `${escapeHtml(item.name)} x${item.quantity}`).join(", ")}</p>
          ${order.customer_note ? `<p>Nota: ${escapeHtml(order.customer_note)}</p>` : ""}
        </article>
      `;
    })
    .join("");
}

// ─── Form ───
function fillForm(product = {}) {
  const form = document.querySelector("#product-form");
  form.id.value = product.id || "";
  form.name.value = product.name || "";
  form.category.value = product.category || "";
  form.price.value = product.price || 0;
  form.stock.value = product.stock || 0;
  form.tag.value = product.tag || "";
  form.image.value = product.image || "";
  form.description.value = product.description || "";
  form.featured.checked = Boolean(product.featured);
  form.visible.checked = product.visible !== false;
  form.name.focus();

  // Scroll to edit panel on mobile
  document.querySelector(".edit-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const state = document.querySelector("#save-state");
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.price = Number(payload.price || 0);
  payload.stock = Number(payload.stock || 0);
  payload.featured = form.featured.checked;
  payload.visible = form.visible.checked;

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

// ─── Helpers ───
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Event Listeners ───
document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.querySelector("#password").value;
  const message = document.querySelector("#login-message");
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
document.querySelector("#new-product").addEventListener("click", () => fillForm({ visible: true }));
document.querySelector("#cancel-edit").addEventListener("click", () => fillForm({ visible: true }));
document.querySelector("#logout").addEventListener("click", () => {
  localStorage.removeItem(sessionKey);
  location.reload();
});

document.querySelector("#search-input")?.addEventListener("input", () => applyFilter(1));

// ─── Nav items (visual only, sections not implemented) ───
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    item.classList.add("active");
  });
});

// ─── Auto-login if password cached ───
if (localStorage.getItem(sessionKey) === fallbackPassword) showAdmin();
