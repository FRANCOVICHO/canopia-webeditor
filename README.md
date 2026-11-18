# Canopia Web Editor

Panel privado para editar el catalogo de Canopia y ver compras.

Cloudflare Pages requiere el secreto cifrado `ADMIN_PASSWORD`. No hay contraseña predeterminada.

El apartado Repartidores permite configurar cuentas privadas y gestionar entregas.
Antes de activarlo, aplicar `migrations/0001-couriers.sql` en la D1 compartida y
configurar el mismo secreto `COURIER_SECRET` (al menos 32 caracteres aleatorios)
en la tienda y en el editor. Las contraseñas de repartidores no se pueden consultar;
el administrador puede restablecerlas y cerrar sus sesiones.
