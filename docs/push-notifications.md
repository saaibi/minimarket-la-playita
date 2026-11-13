# Push de La Playita: revisión de integración

Estado: integración implementada y validada en CI con PostgreSQL. Firebase está habilitado en el proyecto existente, plan Spark sin facturación; la app Android está registrada y su configuración cliente está descargada. Falta autorizar la creación y almacenamiento de la credencial privada de envío en Render, desplegar y comprobar en un teléfono. No se han emitido credenciales ni enviado notificaciones push reales. La API incorpora registro por cuenta/familia de sesión, cola persistente, reintentos y descarte de tokens inválidos. Android incorpora permiso voluntario, desvinculación al salir y apertura autenticada del pedido. Las condiciones de Firebase fueron aceptadas con autorización del propietario; Analytics permanece desactivado.

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

## Contrato implementado y validación

- `GET /push/options`: disponibilidad; sigue desactivada sin `PUSH_ENABLED=true` y credencial válida.
- `POST /push/devices`: instalación UUID y token opaco, vinculado por el servidor al usuario/familia de sesión nativa actuales. Rechaza invitados y campos de suplantación; límite de diez instalaciones activas por cuenta.
- `POST /push/devices/unregister`: solo afecta el vínculo del usuario y familia actuales.
- Migración `010_push_notifications.sql`: tablas aditivas PostgreSQL; ninguna migración SQLite financiera.
- Mensajes con orden/evento y texto genérico; sin correo, nombre del cliente ni deuda en la pantalla bloqueada. Estado de lectura sigue en PostgreSQL.
- Entrega de mejor esfuerzo: ante una respuesta perdida puede repetirse un intento; la etiqueta Android por pedido reemplaza avisos de ese pedido. No se promete entrega exactamente una vez. Eventos de más de 24 horas se cancelan.

La consulta de Orbit no devolvió un endpoint FCM adecuado (solo configuración MFA de otro proveedor); se usó documentación oficial Firebase/Capacitor. Postman CLI no está instalado, por lo que no se ejecutaron Context Graph ni Postman Simulation. Las pruebas Node con PostgreSQL y un proveedor HTTP local validan cola, roles, aislamiento, fallos y reintentos; no sustituyen una prueba real del SDK FCM y de Android. No se envían avisos reales desde las pruebas.

Credenciales del servidor: variable privada `FIREBASE_SERVICE_ACCOUNT_JSON` en Render y `PUSH_ENABLED=true` tras configurar. Nunca en APK/Git. Configuración cliente local `.runtime/firebase/google-services.json`, copiada al Android generado por el script. Sin `google-services.json` aún no se valida el registro real en FCM.
