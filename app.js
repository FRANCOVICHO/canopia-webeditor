const fallbackPassword = "CanopiaAdmin2026!";
const sessionKey = "canopia_admin_password";
const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

let products = [];

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
  renderProducts();
}

function renderProducts() {
  const body = document.querySelector("#products-body");
  body.innerHTML = products
    .map(
      (product) => `
        <tr>
          <td><strong>${product.name}</strong><small>${product.id}</small></td>
          <td>${product.category}</td>
          <td>${money.format(product.price)}</td>
          <td>${product.stock}</td>
          <td>${product.visible ? "Si" : "No"}</td>
          <td>
            <div class="row-actions">
              <button type="button" data-edit="${product.id}">Editar</button>
              <button type="button" data-delete="${product.id}">Borrar</button>
            </div>
          </td>
        </tr>
      `,
    )
    .join("");

  body.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => fillForm(products.find((item) => item.id === button.dataset.edit)));
  });
  body.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteProduct(button.dataset.delete));
  });
}

async function loadOrders() {
  const data = await api("/api/admin/orders");
  const list = document.querySelector("#orders-list");
  if (!data.orders?.length) {
    list.innerHTML = "<p>No hay compras todavia.</p>";
    return;
  }

  list.innerHTML = data.orders
    .map((order) => {
      const items = JSON.parse(order.items_json || "[]");
      return `
        <article class="order-card">
          <strong>#${order.id} - ${order.customer_name}</strong>
          <p>${order.customer_phone} · ${new Date(order.created_at).toLocaleString("es-AR")} · ${money.format(order.total)}</p>
          <p>${items.map((item) => `${item.name} x${item.quantity}`).join(", ")}</p>
          ${order.customer_note ? `<p>Nota: ${order.customer_note}</p>` : ""}
        </article>
      `;
    })
    .join("");
}

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
  form.id.focus();
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

  state.textContent = "Guardando...";
  try {
    await api("/api/admin/products", { method: "POST", body: JSON.stringify(payload) });
    state.textContent = "Guardado.";
    await loadProducts();
  } catch (error) {
    state.textContent = error.message;
  }
}

async function deleteProduct(id) {
  if (!confirm(`Borrar ${id}?`)) return;
  await api(`/api/admin/products?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  await loadProducts();
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.querySelector("#password").value;
  const message = document.querySelector("#login-message");
  localStorage.setItem(sessionKey, password);
  message.textContent = "Verificando...";
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
document.querySelector("#logout").addEventListener("click", () => {
  localStorage.removeItem(sessionKey);
  location.reload();
});

if (localStorage.getItem(sessionKey) === fallbackPassword) showAdmin();
