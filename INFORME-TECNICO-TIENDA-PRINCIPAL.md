# Informe técnico — Adaptación de la tienda principal al sistema de múltiples imágenes

**Fecha:** Octubre 2026  
**Proyecto:** Canopia — tienda principal (canopiagrow.com)  
**Generado por:** Análisis del panel de administración (canopia-webeditor)  
**Estado:** Solo diagnóstico — NO se implementaron cambios en la tienda principal

---

## Contexto

El panel de administración de Canopia fue actualizado para soportar múltiples imágenes por producto. Las imágenes ahora se almacenan en GitHub (`FRANCOVICHO/photoscanopia`) y el campo `image` en la base de datos D1 puede contener:

- Una URL simple: `"https://raw.githubusercontent.com/..."` (productos legacy)
- Un JSON array serializado: `'["https://...","https://..."]'` (productos nuevos)

La API pública en `/api/products` devuelve actualmente el campo `image` con este formato mixto. La tienda principal debe adaptarse para leer ambos formatos y mostrar galerías cuando corresponda.

---

## 1. Archivos afectados

Todos los archivos que actualmente leen `product.image` o `product.imageUrl` deben ser actualizados.

### Componentes de producto

| Archivo probable | Razón |
|---|---|
| `ProductCard.tsx` / `ProductCard.jsx` | Muestra la imagen de portada en el grid de productos |
| `ProductDetail.tsx` / `ProductPage.tsx` | Muestra la galería completa del producto |
| `ProductGallery.tsx` | Si existe: componente de galería — debe crearse si no existe |
| `ProductModal.tsx` / `ProductQuickView.tsx` | Vista rápida con imagen principal |
| `CartItem.tsx` | Miniatura del producto en el carrito |
| `OrderSummary.tsx` | Imagen del producto en el resumen de pedido |
| `FeaturedProducts.tsx` | Grilla de destacados — usa imagen de portada |

### Servicios y tipos

| Archivo probable | Razón |
|---|---|
| `types/Product.ts` / `interfaces/Product.ts` | Interfaz principal del producto — cambio de campo |
| `services/ProductService.ts` | Función que parsea la respuesta de `/api/products` |
| `hooks/useProducts.ts` / `useProduct.ts` | Hook que consume el servicio — puede necesitar normalización |
| `utils/imageUtils.ts` | Debe crearse: helpers para parsear el campo `image` |

### API

| Archivo probable | Razón |
|---|---|
| `pages/api/products.ts` (si usa Next.js BFF) | O cualquier proxy a `/api/products` |
| `functions/api/products.js` (actual, ya analizado) | Devuelve `image` como string — debe agregar `images[]` |

---

## 2. Cambios en el modelo de datos

### Antes (actual)

```typescript
interface Product {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  tag: string;
  image: string;        // ← URL única (o JSON array serializado como string)
  featured: boolean;
  visible: boolean;
  stock: number;
  updated_at: string;
}
```

### Después (objetivo)

```typescript
interface Product {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  tag: string;
  image: string;        // ← Mantener para backward compatibility
  images: string[];     // ← NUEVO: array de URLs ya parseado
  featured: boolean;
  visible: boolean;
  stock: number;
  updated_at: string;
}
```

El campo `image` se mantiene para no romper código que aún no fue migrado.  
`images[0]` es siempre la imagen principal (portada).  
`images` nunca es `undefined` — como mínimo es un array vacío `[]`.

---

## 3. Cambio en la API pública `/api/products`

### Situación actual

`functions/api/products.js` devuelve el campo `image` tal como viene de D1 — puede ser una URL plana o un JSON array serializado como string. La tienda debe parsearlo manualmente.

### Cambio recomendado en `functions/api/products.js`

Agregar la función `parseImages` y exponer el campo `images[]` ya procesado:

```javascript
function parseImages(raw) {
  if (!raw) return [];
  const s = String(raw).trim();
  if (s.startsWith("[")) {
    try { return JSON.parse(s).filter(Boolean); } catch { return [s]; }
  }
  return s ? [s] : [];
}

function mapProduct(row) {
  const images = parseImages(row.image);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    price: row.price,
    tag: row.tag,
    image: images[0] || row.image || "",   // portada — backward compat
    images,                                 // array completo
    featured: Boolean(row.featured),
    visible: Boolean(row.visible),
    stock: row.stock,
    updated_at: row.updated_at,
  };
}
```

Este cambio es **no destructivo**: el campo `image` sigue existiendo con la primera imagen (o el valor original si no hay ninguna), y se agrega `images[]` sin remover nada.

---

## 4. Compatibilidad con productos legacy

Todos los productos que actualmente tienen `image: "https://..."` (URL plana) deben seguir funcionando sin ningún cambio en la base de datos.

### Regla de compatibilidad

```typescript
// utils/imageUtils.ts — crear este archivo
export function getProductImages(product: Product): string[] {
  // Si el nuevo campo images está disponible y tiene contenido, usarlo
  if (product.images && product.images.length > 0) {
    return product.images;
  }
  // Fallback: parsear el campo image legacy
  if (!product.image) return [];
  const raw = product.image.trim();
  if (raw.startsWith("[")) {
    try { return JSON.parse(raw).filter(Boolean); } catch { /**/ }
  }
  return raw ? [raw] : [];
}

export function getProductCoverImage(product: Product): string {
  return getProductImages(product)[0] || "";
}

export function hasMultipleImages(product: Product): boolean {
  return getProductImages(product).length > 1;
}
```

Usar **siempre** estas funciones en los componentes. Nunca acceder directamente a `product.image` salvo para compatibilidad explícita.

---

## 5. Galería de imágenes — especificación

### Comportamiento esperado

1. Si el producto tiene **una sola imagen**: mostrar como hasta ahora, sin navegación.
2. Si el producto tiene **múltiples imágenes**: mostrar galería completa.

### Estructura del componente

```
ProductGallery
├── Imagen principal (grande, ocupa el ancho)
├── Miniaturas (fila horizontal debajo)
│   ├── Miniatura 1 (activa = imagen principal)
│   ├── Miniatura 2
│   └── Miniatura N
└── Navegación
    ├── Botón anterior ( ‹ )
    └── Botón siguiente ( › )
```

### Comportamiento de navegación

- **Click en miniatura** → cambia la imagen principal sin recarga.
- **Botones anterior/siguiente** → navegan entre imágenes.
- **Swipe en móvil** → deslizar horizontalmente cambia la imagen (touch events: `touchstart`, `touchend`, delta > 50px).
- **Teclado** → flecha izquierda/derecha si el componente está enfocado (accesibilidad).
- **Hover en miniatura** (opcional, recomendado en desktop) → preview instantáneo sin clic.

### Ejemplo de API del componente

```typescript
interface ProductGalleryProps {
  images: string[];          // array de URLs
  productName: string;       // para los alt texts
  className?: string;
}
```

---

## 6. Rendimiento — optimizaciones recomendadas

### Imágenes WebP

Las imágenes subidas por el nuevo sistema son automáticamente convertidas a `.webp` cuando el entorno lo permite. Las URLs tendrán la forma:

```
https://raw.githubusercontent.com/FRANCOVICHO/photoscanopia/main/producto-YYYYMMDD-HHMMSS-xxxxxx.webp
```

Usar el atributo `loading="lazy"` en todas las imágenes de la galería excepto la primera.

### Preload de la imagen principal

En la página de detalle del producto, agregar un `<link rel="preload">` para la primera imagen:

```html
<link rel="preload" as="image" href={product.images[0]} fetchpriority="high" />
```

O en Next.js usar `priority={true}` en el `<Image>` de la imagen principal.

### Lazy loading de miniaturas

```tsx
<img
  src={url}
  alt={`${productName} - imagen ${index + 1}`}
  loading={index === 0 ? "eager" : "lazy"}
  decoding="async"
/>
```

### Prefetch de imágenes adyacentes

Cuando el usuario navega a una imagen, hacer prefetch de la siguiente:

```typescript
function prefetchImage(url: string) {
  const link = document.createElement("link");
  link.rel = "prefetch";
  link.as = "image";
  link.href = url;
  document.head.appendChild(link);
}
```

### Evitar re-renders innecesarios

- Memoizar `ProductGallery` con `React.memo` si el padre se re-renderiza frecuentemente.
- Usar `useCallback` para los handlers de navegación.
- Usar `useMemo` para calcular `images = getProductImages(product)` una sola vez.

```typescript
const images = useMemo(() => getProductImages(product), [product.id, product.image]);
```

### Caché del navegador

Las imágenes en `raw.githubusercontent.com` tienen cabeceras de caché. GitHub CDN cachea agresivamente las imágenes RAW, por lo que no requieren configuración adicional del lado de la tienda.

---

## 7. Interfaces TypeScript — lista completa de actualizaciones

### `types/Product.ts`

```typescript
// ANTES
export interface Product {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  tag: string;
  image: string;
  featured: boolean;
  visible: boolean;
  stock: number;
  updated_at: string;
}

// DESPUÉS
export interface Product {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  tag: string;
  image: string;        // Mantener: portada, backward compat
  images: string[];     // NUEVO: galería completa
  featured: boolean;
  visible: boolean;
  stock: number;
  updated_at: string;
}
```

### `types/CartItem.ts`

```typescript
// Solo asegurarse de que CartItem hereda o incluye el campo images
export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image: string;        // Mantener
  images?: string[];    // Agregar (opcional en carrito)
}
```

### `types/OrderItem.ts`

```typescript
// Los items de pedido no necesitan images[] — solo la imagen de portada
export interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
  image?: string;       // portada del producto al momento del pedido
}
```

---

## 8. Cambios en los endpoints de API

### `GET /api/products` — cambio recomendado

**Antes (actual):**
```json
{
  "products": [
    {
      "id": "sustrato-premium-5l",
      "image": "https://raw.githubusercontent.com/...",
      ...
    }
  ]
}
```

**Después:**
```json
{
  "products": [
    {
      "id": "sustrato-premium-5l",
      "image": "https://raw.githubusercontent.com/...",
      "images": [
        "https://raw.githubusercontent.com/FRANCOVICHO/photoscanopia/main/producto-xxx.webp",
        "https://raw.githubusercontent.com/FRANCOVICHO/photoscanopia/main/producto-yyy.webp"
      ],
      ...
    }
  ]
}
```

El campo `image` queda como `images[0]` para que cualquier cliente legacy siga funcionando.

### `GET /api/products/:id` (si existe)

Aplicar el mismo cambio: agregar `images[]` sin remover `image`.

### `POST /api/orders` — sin cambios

El endpoint de creación de pedidos no necesita imágenes. Los `items_json` que guarda en D1 no incluyen imágenes. No requiere modificación.

---

## 9. Componentes React — cambios necesarios

### `ProductCard`

```tsx
// ANTES
<img src={product.image} alt={product.name} />

// DESPUÉS
import { getProductCoverImage } from "@/utils/imageUtils";

const cover = getProductCoverImage(product);
<img
  src={cover || "/placeholder.webp"}
  alt={product.name}
  loading="lazy"
  decoding="async"
/>
```

### `ProductDetail` / `ProductPage`

Reemplazar la imagen única por el componente `ProductGallery`:

```tsx
// ANTES
<img src={product.image} alt={product.name} className="product-hero-img" />

// DESPUÉS
import { getProductImages } from "@/utils/imageUtils";
import { ProductGallery } from "@/components/ProductGallery";

const images = getProductImages(product);
<ProductGallery images={images} productName={product.name} />
```

### `ProductGallery` — componente nuevo a crear

```tsx
// components/ProductGallery.tsx
import { useState, useCallback, useRef } from "react";

interface Props {
  images: string[];
  productName: string;
}

export function ProductGallery({ images, productName }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const touchStartX = useRef<number>(0);

  const prev = useCallback(() =>
    setActiveIdx((i) => (i === 0 ? images.length - 1 : i - 1)), [images.length]);
  const next = useCallback(() =>
    setActiveIdx((i) => (i === images.length - 1 ? 0 : i + 1)), [images.length]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (delta > 50) prev();
    else if (delta < -50) next();
  };

  if (!images.length) return <div className="product-gallery-empty" />;

  return (
    <div className="product-gallery">
      {/* Imagen principal */}
      <div
        className="product-gallery-main"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <img
          src={images[activeIdx]}
          alt={`${productName} - imagen ${activeIdx + 1} de ${images.length}`}
          loading="eager"
          decoding="async"
        />
        {images.length > 1 && (
          <>
            <button
              className="gallery-nav gallery-nav--prev"
              onClick={prev}
              aria-label="Imagen anterior"
            >‹</button>
            <button
              className="gallery-nav gallery-nav--next"
              onClick={next}
              aria-label="Imagen siguiente"
            >›</button>
            <span className="gallery-counter">
              {activeIdx + 1} / {images.length}
            </span>
          </>
        )}
      </div>

      {/* Miniaturas */}
      {images.length > 1 && (
        <div className="product-gallery-thumbs" role="list">
          {images.map((url, i) => (
            <button
              key={url}
              role="listitem"
              className={`gallery-thumb ${i === activeIdx ? "is-active" : ""}`}
              onClick={() => setActiveIdx(i)}
              aria-label={`Ver imagen ${i + 1}`}
              aria-current={i === activeIdx}
            >
              <img
                src={url}
                alt={`${productName} - miniatura ${i + 1}`}
                loading="lazy"
                decoding="async"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

### `CartItem`

```tsx
// ANTES
<img src={item.image} alt={item.name} />

// DESPUÉS — sin cambio si image sigue siendo la portada
// Solo agregar fallback:
<img src={item.image || "/placeholder.webp"} alt={item.name} />
```

### `FeaturedProducts`

```tsx
// ANTES
<img src={product.image} alt={product.name} />

// DESPUÉS
import { getProductCoverImage } from "@/utils/imageUtils";
<img src={getProductCoverImage(product) || "/placeholder.webp"} alt={product.name} />
```

---

## 10. Orden recomendado de implementación

```
[ ] 1. Actualizar `functions/api/products.js` — agregar parseImages + campo images[]
        ↳ No destructivo. Desplegar solo este cambio primero y verificar que la tienda sigue funcionando.

[ ] 2. Crear `types/Product.ts` — agregar images: string[]
        ↳ TypeScript mostrará errores en todos los componentes que usen product.image directamente.

[ ] 3. Crear `utils/imageUtils.ts` — getProductImages, getProductCoverImage, hasMultipleImages

[ ] 4. Actualizar `ProductCard` — usar getProductCoverImage()
        ↳ No cambia visualmente. Solo hace el código robusto.

[ ] 5. Actualizar `FeaturedProducts` — usar getProductCoverImage()

[ ] 6. Actualizar `CartItem` — agregar fallback

[ ] 7. Crear `components/ProductGallery.tsx` — componente completo con miniaturas y navegación

[ ] 8. Actualizar `ProductDetail` / `ProductPage` — integrar ProductGallery

[ ] 9. Actualizar `ProductModal` / `ProductQuickView` (si existe)

[ ] 10. Agregar CSS/Tailwind para ProductGallery (estilos de miniaturas, botones de nav, swipe)

[ ] 11. Pruebas
        [ ] Producto con una imagen (comportamiento legacy — debe ser idéntico al actual)
        [ ] Producto con múltiples imágenes (galería funcional)
        [ ] Producto sin imagen (placeholder correcto)
        [ ] Navegación anterior/siguiente
        [ ] Click en miniatura
        [ ] Swipe en móvil
        [ ] Accesibilidad: navegar con teclado
        [ ] Carga en conexión lenta (lazy loading funciona)

[ ] 12. Verificar compatibilidad en staging antes de deployar a producción
```

---

## 11. Riesgos durante la migración

### Riesgo 1 — Productos sin imágenes muestran errores

**Situación:** Algunos productos pueden no tener ni `image` ni `images[]`.  
**Solución:** Usar siempre `getProductCoverImage(product) || "/placeholder.webp"`. Crear un placeholder WebP en `/public/placeholder.webp`.

### Riesgo 2 — `product.image` contiene un JSON string en producción

**Situación:** Si la tienda usa directamente `<img src={product.image}>` y el campo contiene `'["https://...","https://..."]'` en lugar de una URL, la imagen se rompe.  
**Solución:** Implementar el paso 1 (actualizar el endpoint) antes de subir imágenes múltiples. De esta forma `image` siempre será la primera URL válida.  
**Prioridad: ALTA** — este es el riesgo más urgente.

### Riesgo 3 — Caché obsoleta en el cliente

**Situación:** Si el cliente tiene cacheada la respuesta de `/api/products` con el formato viejo (sin `images[]`), puede fallar.  
**Solución:** El endpoint ya tiene `Cache-Control: no-store`. No hay riesgo siempre que ese header se mantenga.

### Riesgo 4 — URLs de GitHub con latencia alta

**Situación:** `raw.githubusercontent.com` puede tener latencia variable.  
**Solución:** Usar `loading="lazy"` en todas las imágenes excepto la primera. Considerar Cloudflare Images o un proxy propio si el rendimiento es crítico.

### Riesgo 5 — Pérdida de imágenes existentes (PocketBase)

**Situación:** Los productos actuales tienen imágenes almacenadas en la instancia de PocketBase (`jeans-statement-wave-transactions.trycloudflare.com`). Esta es una URL de tunnel temporal de Cloudflare — **puede dejar de funcionar en cualquier momento**.  
**Solución:** Antes de migrar la tienda, re-subir las imágenes existentes al repositorio GitHub usando el nuevo sistema del panel de administración. No depender de las URLs de PocketBase en producción.  
**Prioridad: CRÍTICA**

### Riesgo 6 — Componente de galería sin accesibilidad

**Situación:** Una galería sin ARIA labels y navegación por teclado no es accesible.  
**Solución:** El componente de referencia incluye `role="list"`, `aria-label`, `aria-current` y `aria-label` en los botones de navegación. Respetar esa estructura.

---

## 12. Resultado esperado al finalizar

Una vez completados todos los pasos:

- **Productos con una imagen** → comportamiento idéntico al actual. Sin cambios visuales.
- **Productos con múltiples imágenes** → galería con imagen principal grande, fila de miniaturas, navegación anterior/siguiente, swipe en móvil.
- **La primera imagen del array** es siempre la portada mostrada en tarjetas de producto, carrito, y resumen de pedido.
- Ningún producto existente se rompe durante la transición.
- El campo `image` de la API sigue disponible para cualquier cliente externo que lo consuma.

---

## Apéndice — Estructura de URL de imágenes GitHub

```
https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{filename}

Ejemplo:
https://raw.githubusercontent.com/FRANCOVICHO/photoscanopia/main/producto-20261007-154500-a83d92.webp
```

Las imágenes en `raw.githubusercontent.com` son públicas y no requieren autenticación para lectura. Son servidas por la CDN de GitHub/Fastly con compresión gzip y soporte para rangos de bytes.

---

*Documento generado el 7 de octubre de 2026. Aplica únicamente como guía para la tienda principal (canopiagrow.com). Los cambios en el panel de administración (canopia-webeditor) ya fueron implementados.*
