# Push de La Playita: revisión de integración

Estado: propuesta técnica revisada; no se ha activado Firebase, emitido credenciales ni enviado notificaciones push reales. La aplicación actual consulta avisos en REST y recibe actualizaciones Socket.IO mientras está conectada; no registra dispositivos push.

## Primera etapa: Android

Usar Firebase Cloud Messaging con el complemento oficial `@capacitor/push-notifications` compatible con Capacitor 8. FCM no tiene cargo por mensajería; no hace falta mover la API o la base de datos a Firebase ni activar Cloud Functions. Puede añadirse Firebase al proyecto de Google existente, una vez revisada su configuración y aceptados los términos que correspondan.

1. Registrar la app Android `co.laplayita.minimarket` en Firebase y añadir su configuración cliente al proyecto Android. No incluir credenciales privadas del servidor en la APK ni en Git.
2. Añadir un control voluntario para activar notificaciones y solicitar permiso del sistema en Android 13 o posterior. Denegar permiso no bloquea compras, caja ni avisos internos.
3. Registrar y actualizar cada token con la sesión autenticada. El servidor determina usuario y permisos; el cliente no elige destinatarios. Desvincular al salir/cambiar cuenta, limpiar tokens inválidos y excluir cuentas desactivadas.
4. Migración PostgreSQL aditiva para registros de dispositivos y entregas pendientes por evento/dispositivo, con claves únicas, intentos y próximo reintento. No cambia pedidos, deuda ni cantidades existentes. No es una cola financiera en SQLite.
5. Persistir el evento y la tarea de envío en la misma transacción que confirma el pedido. Enviar después del commit con reintentos; un fallo de FCM nunca invalida una venta ya registrada. Controlar duplicados por evento y dispositivo.
6. Pedidos nuevos para personal autorizado; cambios de estado para el propietario o comprador explícitamente asociado, según la política de la tienda. No resolver destinatarios por coincidencias de nombre o correo. Las ventas de caja ya entregadas no generan un aviso de nuevo pedido pendiente.
7. Enviar mensajes discretos, sin deudas, correos ni datos sensibles en la pantalla bloqueada. Al tocar el aviso, abrir el pedido mediante la API con la sesión vigente, que vuelve a validar acceso; conservar el estado leído en el servidor.
8. Probar teléfono real con app abierta, en segundo plano y cerrada, permiso rechazado, sesión cambiada, token rotado, cuenta desactivada y fallo/reintento del proveedor. Una app forzada a detenerse por el sistema/usuario puede tener restricciones de entrega.

## Operación

El servicio actual Render Free puede dormirse. Los reintentos pendientes solo se ejecutarán mientras la API esté activa; las acciones entrantes la despiertan. No prometer entrega inmediata o garantizada. La primera etapa no crea servicios pagados ni una nueva base de datos.

La web necesitará una implementación separada de Web Push, con service worker y configuración web. iPhone requiere su proyecto iOS, capacidades push y configuración de APNs; no viene resuelto por el registro Android.

## Fuentes oficiales

- Capacitor 8: https://capacitorjs.com/docs/apis/push-notifications
- Entorno de servidor FCM: https://firebase.google.com/docs/cloud-messaging/server-environment
- Precio FCM: https://firebase.google.com/pricing
- Límites Render Free: https://render.com/docs/free
