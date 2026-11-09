# Minimarket La Playita — primer incremento

Base nueva, separada del prototipo ejecutable. React + TypeScript + Vite, Capacitor 8, NestJS/Node, PostgreSQL y Socket.IO. SQLite comunitario únicamente en Android/iOS. No se desplegó ni se generaron apps firmadas.

## Estado verificado en este entorno

- Build de los cuatro workspaces aprobado.
- 7 pruebas aprobadas: SQLite real mediante `node:sqlite` (archivo durable, reapertura, leases, reintentos, conflictos y aislamiento), dominio y JWT. El transporte de algunas pruebas es un doble explícito; no prueba el servidor PostgreSQL.
- La integración PostgreSQL 16 + HTTP Nest + SQLite real + Socket.IO **pasó en GitHub Actions**; [consultar CI](https://github.com/saaibi/minimarket-la-playita/actions/workflows/ci.yml). Localmente se omitió por ausencia de servidor PostgreSQL ejecutable en este sandbox. PostgreSQL 14 está instalado; `initdb` falla con `shmget: Operation not permitted`. Docker no está activo. No se reemplazó PostgreSQL por SQLite ni por una emulación.
- Plugin Capacitor SQLite typechecked contra su API publicada; **no ejecutado en Android/iPhone**. No se hizo revisión visual de navegador.
- Frontend local: http://127.0.0.1:5173/ (muestra la base; inventario/pedidos necesitan API + PostgreSQL real).
- El prototipo anterior permanece intacto en http://127.0.0.1:4173/; sus archivos y localStorage no se importan ni modifican.

## Estructura

```text
apps/web        React/Vite + configuración Capacitor Android/iOS
apps/api        NestJS, autorización JWT, consultas y transacciones PostgreSQL
packages/shared Contrato Zod y tipos/reglas de unidades y precios
packages/mobile Adaptador SQLite nativo, outbox durable y sincronizador
scripts         Migraciones, contrato OpenAPI y credenciales locales
 tests          SQLite real/JWT/dominio; integración PostgreSQL real opcional
```

## Ejecutar

Node 24+ (este entorno: 26.5), npm y PostgreSQL 14+ accesible. No hace falta un contenedor: puede ser PostgreSQL instalado directamente. Crear una base **de desarrollo** y usuario con permisos de esquema usando las herramientas de PostgreSQL de tu sistema.

```sh
npm ci
cp .env.example .env
# Editar DATABASE_URL localmente, con la base/usuario de desarrollo reales.
npm run dev:credentials
npm run build
npm run db:migrate
npm run dev:api
```

En otra terminal, desde la misma carpeta:

```sh
npm run dev:web
```

La API escucha solo `127.0.0.1:4300`; Vite solo `127.0.0.1:5173`. `.runtime/dev-tokens.json` contiene los JWT locales de admin, seller y buyer (8 h). Copiar uno al campo de sesión del frontend. No introducir credenciales en el chat ni versionar ese archivo. El script conserva el secreto existente o genera uno local. Esto implementa validación criptográfica y roles **de desarrollo**, no alta/login/recuperación de cuentas de producción. No hay selector capaz de cambiar los permisos del servidor.

```sh
npm test
npm run typecheck:tests
TEST_DATABASE_URL='postgresql://USUARIO:CLAVE@127.0.0.1:5432/BASE_TEST' npm run test:integration
```

Usar una base de prueba con permisos para crear un esquema temporal. La integración crea y elimina únicamente su esquema `it_<uuid>`, no borra tablas existentes. Sin esa variable la prueba se marca explícitamente omitida. CI está preparado con PostgreSQL 16 real, sin desplegar la app; la ejecución remota ya verificó la integración del primer incremento. Consultar el estado del commit actual en el enlace de CI.

## Flujo y garantías implementadas

1. Móvil guarda un `OrderDraft` y su UUID de idempotencia en una única fila SQLite `pending_sync`. No hay confirmación, pago ni reserva global mientras falta red.
2. El sincronizador reclama la fila con lease/token. Las interrupciones se recuperan tras 60 s. Red/5xx/429 reintentan con backoff y misma clave; 400/401/403/404/409/422 quedan en conflicto visible y no se eliminan.
3. API valida JWT, rol, body estricto, presentación y precio esperado. Bloquea productos en orden determinista dentro de la transacción, suma consumo base de todas las presentaciones, verifica disponibilidad y reserva.
4. Clave única por identidad, hash canónico y bloqueo transaccional evitan duplicar la creación al repetir la misma solicitud. Reusar clave con otro body da `IDEMPOTENCY_MISMATCH`. Conflictos se conservan para esa clave: corregir requiere revisión explícita y clave nueva.
5. SQLite confirma el ack guardando respuesta y estado `synced`. Si muere después del commit servidor, la misma clave permite recuperar la respuesta sin una segunda reserva.
6. Revisión conserva el original y vincula nueva fila `pending_sync`. Nunca se cambian precios silenciosamente ni se borra un conflicto. Interfaz de revisión JSON es temporal y técnica para este primer incremento.
7. Aceptar y alistar son independientes del pago. Entregar exige listo + pago confirmado, libera reserva y descuenta una sola vez; cancelar sin cobro libera. Nequi queda `not_integrated`, sin ruta para inventar un pago real. Solo efectivo tiene confirmación de tienda en esta base.
8. Eventos se escriben en la misma transacción y se emiten por Socket.IO **después del commit**. Cursor durable REST y refresco completo al reconectar; sockets no son base de verdad ni push. Un bloqueo transaccional de asignación de eventos ordena sus IDs respecto al commit (decisión simple de este incremento, pendiente medir throughput).

Cantidades: gramos enteros para peso; libra = 500 g. En productos por unidad la cantidad es número de paquetes, multiplicado por factor entero. Datos iniciales ilustrativos: huevo 650 COP, medio cartón de 15 a 9.000, cartón de 30 a 17.000. No hay inventarios separados por presentación. Pedido conserva nombre, factor, cantidad base, precio y total como snapshot. Cliente opcional, vacío = Cliente general. Costo solo se serializa a admin. No se proporcionan importes reales ni se migra automáticamente la demo.

## Móvil

SQLite usa `@capacitor-community/sqlite` **8.1.1**, plugin comunitario, no core. Peer publicado `@capacitor/core >=8.0.0`, comprobado y resuelto con Capacitor **8.6.0** (core/android/ios); versiones exactas en lockfile. API oficial del plugin empleada: `createConnection`, `open`, `execute(..., false)`, `run(..., false)`, `query`. El adaptador rechaza la web: no usa IndexedDB/jeep-sqlite para prometer offline web.

```sh
npm run build
npm run cap:android -w @playita/web
npm run cap:ios -w @playita/web
npm run cap:sync -w @playita/web
```

Las plataformas generadas se excluyen en este primer incremento; aún no se corrieron sus builds/simuladores. La UI nueva es una pantalla vertical técnica, no una migración completa de la interfaz aprobada. Android/iOS requieren toolchains y una API de desarrollo alcanzable con HTTPS. El valor localhost no accede al equipo host desde un teléfono; la API ligada a loopback tampoco está expuesta a LAN. No se habilitó exposición de red ni cleartext nativo automáticamente.

SQLite local está sin cifrar en este incremento, token solo en memoria; cierre/borrado de app, respaldo cifrado, secure storage, política de retención y protección de datos requieren el siguiente trabajo antes de usar datos reales. Cola y caché están separadas por identidad. Caducidad de token se resuelve como conflicto de autorización, sin reenviar bajo otra cuenta.

Fuentes verificadas: [plugin 8.1.1 y peer](https://github.com/capacitor-community/sqlite/blob/v8.1.1/package.json), [conexión](https://github.com/capacitor-community/sqlite/blob/v8.1.1/docs/APIConnection.md), [DB API](https://github.com/capacitor-community/sqlite/blob/v8.1.1/docs/APIDBConnection.md), [plugins oficiales y comunitarios](https://capacitorjs.com/docs/plugins).

## Contrato y alcance siguiente

[OpenAPI](docs/openapi.json) se genera desde Zod con `npx tsx scripts/generate-contract.ts`. Documenta JWT, idempotencia, errores, cantidades y recuperación. Postman CLI no está instalado aquí; no se creó cuenta/workspace ni se publicó documentación.

Ver [arquitectura y migración progresiva](docs/architecture.md). Este incremento no implementa aún el POS real completo, CRUD administrativo de productos/presentaciones, login productivo, todos los módulos de notificaciones/horarios ni pagos Nequi reales. Tampoco promete ventas físicas offline con varias cajas: la decisión acordada es **pedidos móviles offline**. La política de POS offline/multi-caja sigue pendiente, pues una cola no garantiza evitar sobreventa física sin red.
