# Guía de migración de imágenes legacy

**Proyecto:** Canopia Admin — canopia-webeditor  
**Fecha:** Octubre 2026

---

## Problema

Los productos subidos antes de la implementación del sistema GitHub tienen imágenes almacenadas en:

- **PocketBase** en `jeans-statement-wave-transactions.trycloudflare.com` — túnel temporal de Cloudflare que puede caer en cualquier momento sin aviso
- Cualquier otra URL temporal, localhost, ngrok, o servicio externo no permanente

Cuando esas URLs dejen de responder, las imágenes desaparecerán de la tienda.

---

## Solución implementada

Se agregaron dos herramientas al sistema:

### 1. Endpoint de detección — `GET /api/admin/migrate-images`

Escanea todos los productos en la base de datos y devuelve cuáles tienen imágenes en URLs temporales.

Detecta automáticamente:
- `trycloudflare.com`
- `pocketbase`
- `localhost` / `127.0.0.1`
- `ngrok.io` / `ngrok-free.app`
- `loca.lt`
- `serveo.net`

### 2. Endpoint de migración — `POST /api/admin/migrate-images`

Recibe `{ productId, imageUrl }`:
1. Descarga la imagen desde la URL legacy (timeout 15s)
2. La sube al repositorio `FRANCOVICHO/photoscanopia` vía la GitHub API
3. Genera una URL RAW permanente
4. Actualiza el campo `image` del producto en D1 reemplazando solo esa URL
5. Escribe un audit log del cambio

**Nunca borra la imagen original** — solo reemplaza la referencia en la base de datos.

### 3. Panel visual en el admin

Al iniciar sesión con el token de GitHub configurado, el panel:
- Escanea automáticamente en background
- Si encuentra imágenes legacy, muestra el **panel de migración** con la lista completa
- Permite migrar imagen por imagen o todas las de un producto con un clic

---

## Procedimiento paso a paso

### Paso 1 — Configurar las variables de entorno

Antes de migrar, asegurarse de que el token de GitHub está configurado:

1. Ir a [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Pages → `canopia-webeditor` → Settings → Environment Variables
3. Agregar (marcar como **Encrypted**):
   - `GITHUB_TOKEN` = Personal Access Token con permisos `Contents: Read and write` en el repo `photoscanopia`
4. Deployar (o forzar redeploy) para que las variables estén disponibles

Verificar desde el panel: al iniciar sesión, el banner verde "GitHub conectado" confirma que el token funciona.

### Paso 2 — Escanear productos

Desde el panel de administración, el escaneo ocurre automáticamente al iniciar sesión si el token está configurado.

También se puede disparar manualmente con el botón **"↺ Escanear productos"** en el panel de migración.

El panel muestra:
- Cuántos productos tienen imágenes legacy
- Cuántas imágenes legacy tiene cada uno
- La URL actual de cada imagen (con preview)

### Paso 3 — Migrar

**Opción A — Migrar imagen por imagen:**
Clic en el botón **"Migrar →"** junto a cada imagen. El sistema:
1. Descarga la imagen
2. La sube a GitHub
3. Actualiza el producto
4. Muestra "✓ Migrada" cuando termina

**Opción B — Migrar todas las de un producto:**
Clic en **"Migrar todas las imágenes de este producto"**. Procesa todas en secuencia.

**Opción C — Migración masiva manual (si el panel visual no está disponible):**

Usar `curl` o cualquier cliente HTTP:

```bash
# 1. Escanear productos con imágenes legacy
curl -X GET "https://canopia-webeditor.pages.dev/api/admin/migrate-images" \
  -H "x-admin-password: TU_PASSWORD"

# 2. Migrar una imagen específica
curl -X POST "https://canopia-webeditor.pages.dev/api/admin/migrate-images" \
  -H "x-admin-password: TU_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"productId": "sustrato-premium-5l", "imageUrl": "https://jeans-statement-wave-transactions.trycloudflare.com/..."}'
```

### Paso 4 — Verificar

Después de migrar, volver a escanear:
- Si el panel muestra "✓ Todos los productos usan URLs permanentes" → migración completa
- Verificar en la tienda que las imágenes se ven correctamente

### Paso 5 — Confirmar y cerrar

Una vez confirmado que todas las imágenes están en GitHub y la tienda las muestra correctamente:
- Las URLs de PocketBase/trycloudflare pueden dejar de funcionar sin impacto
- No hay que hacer nada adicional — las nuevas URLs en GitHub son permanentes

---

## Qué pasa con las imágenes que no se pueden descargar

Si una URL legacy ya está caída (el túnel de Cloudflare se cerró), el endpoint devuelve:

```json
{
  "error": "No se pudo descargar la imagen (HTTP 404). La URL puede estar caída."
}
```

En ese caso la imagen se perdió definitivamente. Las opciones son:
1. Subir una nueva imagen desde el panel de edición del producto
2. Si tenés la imagen originalmente, subirla directamente

---

## Estructura de las nuevas URLs

Todas las URLs migradas tienen la forma permanente:

```
https://raw.githubusercontent.com/FRANCOVICHO/photoscanopia/main/producto-YYYYMMDD-HHMMSS-xxxxxx.ext
```

Estas URLs:
- Son permanentes mientras el repositorio exista
- No requieren autenticación para lectura
- Están servidas por la CDN de GitHub/Fastly
- No tienen costo adicional para repositorios públicos

---

## Auditoría

Cada migración queda registrada en la tabla `audit_logs` de D1 con:
- `action: "MIGRATE_IMAGE"`
- `resource: "products:{id}"`
- `old_value`: URL original
- `new_value`: URL permanente en GitHub
- `ip` y `trace_id` del request

Para ver el historial:
```sql
SELECT * FROM audit_logs WHERE action = 'MIGRATE_IMAGE' ORDER BY created_at DESC;
```

---

## Checklist de migración

```
[ ] 1. GITHUB_TOKEN configurado en Cloudflare Pages → encrypted
[ ] 2. Banner verde "GitHub conectado" visible en el panel
[ ] 3. Escaneo ejecutado — anotar cuántos productos tienen imágenes legacy
[ ] 4. Migrar cada producto (panel visual o API directa)
[ ] 5. Re-escanear — confirmar "Todos los productos usan URLs permanentes"
[ ] 6. Verificar en la tienda que las imágenes se ven correctamente
[ ] 7. Listo — sin dependencias de URLs temporales
```
