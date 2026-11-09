# Render Free staging

Autorización recibida: API y PostgreSQL exclusivamente Free, sin upgrades ni pagos. Antes de crear recursos hay que inspeccionar el workspace y reutilizar recursos de Playita correctos. `deploy/render.free.yaml` propone Virginia para ambos; ajustar al proyecto real antes de aplicarlo. No se ha aplicado el archivo ni verificado una cuenta desde este chat.

Free no permite preDeployCommand, shell ni one-off jobs. El comando `npm run start:render` aplica las migraciones transaccionales existentes con advisory lock y luego inicia la API; si fallan las migraciones no arranca el servidor. No hay reset ni eliminación de tablas. No ejecutar contra una BD ajena al proyecto. DB URL privada por referencia, acceso externo de BD deshabilitado, TLS limitado a host interno dpg-* y allowlist nativa explícita; no frontend web aún.

Los dos planes del archivo son `free`; no agregar disco ni otros servicios. No automatizar upgrades ni keep-alive para evitar suspensión. Revisar cuota existente y controles de sobrecostos: el plan Free no garantiza por sí solo cero cobros si hay método de pago y se exceden cuotas de bandwidth/build. Verificar configuración real antes de afirmar costo cero; no cambiar límites globales que afecten otros proyectos sin revisar alcance.

Límites oficiales consultados 2026-11-09:

- Web Free se suspende tras 15 minutos sin tráfico; despertar tarda aproximadamente un minuto. 750 horas Free mensuales compartidas por workspace; agotarlas suspende los servicios.
- Solo una BD PostgreSQL Free activa por workspace, 1 GB. Caduca 30 días después de creación; inaccesible después. Pasados otros 14 días sin upgrade, se elimina. Registrar la fecha exacta que devuelva Render, no calcularla antes de crear.
- Sin backups administrados ni pooling gestionado en PG Free. El pool propio de la API sigue activo. Usar únicamente datos ficticios para staging.
- Sin acceso shell/SSH ni one-off jobs en Web Free. Primer admin queda pendiente de un mecanismo seguro de bootstrap con el propietario; no usar admin/admin ni enviar contraseña en chat. No habilitar endpoint público de bootstrap.

Tras deploy: esperar estado LIVE, verificar HTTPS `/health`, guest/catalog con sesión nativa, permisos, idempotencia y reconexión. No declarar prueba de staff sin disponer de su cuenta. No WhatsApp ni Nequi reales. Generar APK debug nuevo con la URL HTTPS devuelta y verificada; la versión anterior permanece sin API. Comprobar manifest, firma y SHA256; no afirmar probado en teléfono.

Fuentes: https://render.com/docs/free y https://render.com/docs/blueprint-spec
