# Revisión de lanzamiento — 9 noviembre 2026

Estado: preparación técnica, sin recursos Render creados ni despliegue autorizado. El repositorio público no implica que exista una API publicada. La interfaz React es todavía una base de desarrollo, no toda la interfaz del prototipo.

## Cambios preparados

- Node 24, comandos reproducibles `npm ci --include=dev`, `npm run build:api`, `npm run db:migrate`, `npm run start:api`.
- Producción escucha en 0.0.0.0 y respeta PORT. Health verifica PostgreSQL y migración 002; fallo devuelve 503 sin detalles internos. Consulta limitada a 2,5 segundos; conexión a 3 segundos. Verificar tiempo total remoto antes de aprobar servicio.
- Pool de cinco conexiones por proceso. API/migraciones/bootstrap comparten TLS. Conexión externa valida certificado; modo Render interno solo admite hostname privado dpg-* sin dominio, cifra con certificado autofirmado sin validación CA, conforme a la limitación documentada de Render. Rechaza parámetros SSL en URL que sobrescribirían esa política.
- `deploy/render.review.yaml` es una plantilla de revisión con CHOOSE_* pendientes; no está lista para aplicar. Sin autodeploy, una instancia, PostgreSQL 16, misma región y acceso externo de BD deshabilitado. No se ha validado contra la cuenta/API Render.
- Eventos Socket.IO se emiten después de commit. REST y cursor recuperan eventos tras reconexión. Una instancia; escalar requiere diseñar adapter/afinidad de sesiones. WebSocket no sustituye notificaciones push.
- No hay administrador fijo. Bootstrap explícito una sola vez. Google, Apple, WhatsApp y Nequi no se habilitan como servicios funcionales por desplegar.

## Qué falta y qué debe aportar el propietario

1. **Conectar Render:** completar la conexión oficial sugerida en Codex, o trabajar directamente en su panel. No se ha inspeccionado aún tu workspace. La integración es opcional para hacerlo manualmente, pero necesaria para revisar su cuenta desde aquí. Nunca pegar tokens en el chat.
2. **Workspace y GitHub:** elegir workspace/proyecto en Render y autorizar su propia integración GitHub para `saaibi/minimarket-la-playita`, rama main. La sesión gh de este equipo no autoriza a Render.
3. **Región y presupuesto:** elegir una región disponible común para API y BD (por ejemplo Virginia, pendiente de decisión); escoger plan API, plan PostgreSQL, almacenamiento inicial y política de ampliación. Pedir cotización visible del panel: API + BD + almacenamiento + workspace + posibles excesos. Aprobar importe/moneda/mes antes de crear. No tenemos precio concreto verificado: la página pública consultada no expuso importes. No asumir gratuito. Scrypt usa ~128 MiB por operación y puede haber concurrencia: dimensionar memoria y medir antes de producción.
4. **Orígenes:** para pruebas solo Android usar `CORS_ORIGINS=http://localhost,https://localhost,capacitor://localhost`; añadir exclusivamente la URL HTTPS exacta del frontend web cuando exista. Un APK instalado usa Bearer, no cookies web. Si web y API quedan en sitios diferentes, las cookies SameSite=Lax actuales requieren resolver arquitectura de dominios/proxy antes de habilitar esa web; CORS por sí solo no lo soluciona.
5. **Secretos en Render exclusivamente:** DATABASE_URL mediante referencia a la BD privada del mismo workspace/región; no copiar aquí. Configuración no secreta: NODE_ENV=production, HOST=0.0.0.0, PORT=10000, NODE_VERSION=24, DATABASE_TLS_MODE=render-internal y CORS_ORIGINS exacto. No cargar credenciales de Twilio ni servicios opcionales para esta prueba.
6. **Aprobar creación explícitamente:** sustituir CHOOSE_* por selecciones verificadas, validar Blueprint y revisar diff/costo; solo después crear BD/API. Migración predeploy antes del arranque. No ejecutar migraciones contra otra BD por accidente.
7. **Primer administrador:** tras migración, en shell/one-off seguro del proveedor definir PLAYITA_ADMIN_EMAIL y PLAYITA_ADMIN_PASSWORD (12–128 caracteres) y ejecutar `npm run admin:bootstrap`. No poner contraseña en argumento, repositorio, chat, YAML ni logs. Retirar variables temporales después. El email del propietario puede decidirse sin enviar contraseña.
8. **Validación real:** probar URL HTTPS pública `/health`, login/refresh/logout y revocación, invitado, permisos, crear/reservar pedido, retry idempotente, cancelar/liberar y entrega sin doble descuento. Probar Socket.IO y recuperación REST después de reinicio. Verificar HTTPS/certificado, logs sin secretos, límites y consumo de memoria.
9. **Datos y respaldo:** confirmar PITR/retención y exportaciones del plan elegido, responsable de recuperación y prueba de restauración a una BD separada; hacer exportación antes de migraciones futuras. Cerrar acceso externo de BD y mantener conexión privada. No cargar datos reales hasta completar estas verificaciones.
10. **APK:** usar la URL HTTPS validada de la API para compilar/configurar Android. Sin API, mostrar estado explícito de desconexión; localhost del Mac no es backend del teléfono. Después compilar debug, entregar checksum y probar en Android real. El SDK local fue autorizado; descarga oficial verificada por SHA256. Aún no hay APK entregable ni prueba en teléfono.

## Límites de la revisión

La última CI anterior pasó con PostgreSQL 16 real; las comprobaciones nuevas deben registrarse junto a su commit. PostgreSQL local está bloqueado por memoria compartida del sandbox, por lo que no se afirma prueba local de API. No se ha probado carga, restauración, Render remoto, firma/distribución productiva ni dispositivo real. Persisten recuperación de contraseña, social login, notificaciones push, migración visual completa y revisión de seguridad antes de producción.

## Fuentes oficiales

- https://render.com/docs/web-services (bind/PORT)
- https://render.com/docs/blueprint-spec (campos y validación)
- https://render.com/docs/health-checks (respuesta antes de cinco segundos)
- https://render.com/docs/postgresql-creating-connecting (red privada, TLS y planes)
- https://render.com/docs/postgresql-backups (PITR/exportaciones)
- https://node-postgres.com/features/ssl (precedencia de parámetros SSL)
- https://render.com/pricing (importe final pendiente del panel)
