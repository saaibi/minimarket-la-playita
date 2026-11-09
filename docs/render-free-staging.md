# Render Free staging

Autorización recibida: API y PostgreSQL exclusivamente Free, sin upgrades ni pagos. Antes de crear recursos hay que inspeccionar el workspace y reutilizar recursos de Playita correctos. `deploy/render.free.yaml` propone Virginia para ambos; ajustar al proyecto real antes de aplicarlo. Los recursos se crearon desde el panel oficial; el archivo no se aplicó automáticamente. Ver resultado y pasos de administrador al final.

Free no permite preDeployCommand, shell ni one-off jobs. El comando `npm run start:render` aplica las migraciones transaccionales existentes con advisory lock y luego inicia la API; si fallan las migraciones no arranca el servidor. No hay reset ni eliminación de tablas. No ejecutar contra una BD ajena al proyecto. DB URL privada por referencia, acceso externo de BD deshabilitado, TLS limitado a host interno dpg-* y allowlist nativa explícita; no frontend web aún.

Los dos planes del archivo son `free`; no agregar disco ni otros servicios. No automatizar upgrades ni keep-alive para evitar suspensión. Revisar cuota existente y controles de sobrecostos: el plan Free no garantiza por sí solo cero cobros si hay método de pago y se exceden cuotas de bandwidth/build. Verificar configuración real antes de afirmar costo cero; no cambiar límites globales que afecten otros proyectos sin revisar alcance.

Límites oficiales consultados 2026-11-09:

- Web Free se suspende tras 15 minutos sin tráfico; despertar tarda aproximadamente un minuto. 750 horas Free mensuales compartidas por workspace; agotarlas suspende los servicios.
- Solo una BD PostgreSQL Free activa por workspace, 1 GB. Caduca 30 días después de creación; inaccesible después. Pasados otros 14 días sin upgrade, se elimina. Registrar la fecha exacta que devuelva Render, no calcularla antes de crear.
- Sin backups administrados ni pooling gestionado en PG Free. El pool propio de la API sigue activo. Usar únicamente datos ficticios para staging.
- Sin acceso shell/SSH ni one-off jobs en Web Free. Primer admin queda pendiente de que el propietario complete el bootstrap seguro descrito al final; no usar admin/admin ni enviar contraseña en chat. No habilitar endpoint público de bootstrap.

Tras deploy: esperar estado LIVE, verificar HTTPS `/health`, guest/catalog con sesión nativa, permisos, idempotencia y reconexión. No declarar prueba de staff sin disponer de su cuenta. No WhatsApp ni Nequi reales. Generar APK debug nuevo con la URL HTTPS devuelta y verificada; la versión anterior permanece sin API. Comprobar manifest, firma y SHA256; no afirmar probado en teléfono.

Fuentes: https://render.com/docs/free y https://render.com/docs/blueprint-spec

## Despliegue realizado

El panel autenticado permitió desplegar en `Saaibi Yesid's workspace`, sin servicios previos, plan Hobby sin tarjeta registrada. Ambos recursos se crearon en Free, Virginia, sin disco, sin upgrades ni autodeploy. PostgreSQL 16 `playita-db` tiene ID `dpg-dbp4ufec6qcc73aclg40-a`; acceso externo bloqueado. Render muestra vencimiento **9 diciembre 2026**. No se modificaron reglas globales ni recursos ajenos.

API: https://playita-api.onrender.com — `srv-dbp4vj0m7kps739ritb0`. Primer deploy `dep-dbp4vj8m7kps739ritt0`, commit `a9ab7a3`, Live, migraciones aplicadas y `/health` HTTP 200. Probados sobre HTTPS: invitado, catálogo sin costos, permisos, CORS no confiable rechazado, WebSocket nativo autenticado, pedido ficticio de un huevo, idempotencia, reserva única, prohibición de aceptar como comprador, cancelación y devolución de reserva, eventos REST y Socket.IO, refresh rotado y revocación al cerrar. El pedido de prueba permanece cancelado; no hubo cobro ni modificación final del stock físico. No se verificó login staff remoto ni dispositivo real.

APK conectado: `0.1.1-debug`, versionCode 2, mismo package y firma debug que la versión previa. Endpoint HTTPS compilado, SQLite y Secure Storage presentes. APK/checksum fuera del repositorio público.

### Primer administrador: acción del propietario

Con el commit que incorpora `scripts/bootstrap-render.ts` desplegado, abrir **Environment** del servicio API y agregar personalmente estas tres variables:

- `PLAYITA_BOOTSTRAP_ADMIN=once`
- `PLAYITA_ADMIN_EMAIL`: correo elegido por el propietario.
- `PLAYITA_ADMIN_PASSWORD`: contraseña propia de 12–128 caracteres, ingresada únicamente en el panel seguro, sin enviarla por chat.

El propietario debe completar la entrada y guardar/reiniciar el servicio desde Render. Al arrancar, el script crea el primer admin bajo advisory lock solo si falta. Si ya existe no cambia su contraseña ni crea otro. Tras éxito, eliminar las tres variables temporales y guardar/reiniciar. El acceso admin quedará disponible con ese correo y contraseña desde la aplicación. No hay cuenta admin/admin ni endpoint de bootstrap. Si el panel muestra pago/upgrade, detenerse; este procedimiento no requiere un plan de pago.
