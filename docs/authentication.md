# Acceso, identidad y sesiones — incremento 0.2

## Compradores y personal

- **Invitado:** no exige contraseña, WhatsApp ni nombre. `POST /auth/guest` emite una identidad buyer aleatoria **del servidor** y su sesión. Dos invitados tienen ids distintos. Nombre opcional en pedido, vacío = Cliente general. No se usa dispositivo, teléfono, nombre ni email como prueba de identidad.
- **Google/Apple:** botones visibles pero deshabilitados. No hay proveedor operativo ni flujo que acepte un ID token sin comprobar. Puerto `OidcFlow` documenta Authorization Code + PKCE, state/nonce de un solo uso, validación de firma/JWKS/issuer/audience/expiración. Configuración de OAuth/Apple, callbacks y la implementación completa están pendientes. No se solicitan permisos de Gmail ni se lee cuenta del dispositivo. Futuro vínculo se hará por provider+sub; no por email/Apple relay. Migrar invitado exigirá posesión válida y confirmación, sin vincularlo arbitrariamente.
- **Personal:** correo + contraseña, rol consultado al servidor. Primer admin por `npm run admin:bootstrap`, solo si no existe otro. Luego UI `/admin/users`: listar, crear admin/seller y desactivar personal. No hay registro público de personal. No se permite desactivarse a sí mismo; hay protección de último admin. Desactivar revoca sesiones.
- **WhatsApp:** puerto futuro `VerificationProvider` y adaptador configurable Twilio Verify. No es obligatorio para comprar ni está activado. Sin proveedor devuelve 503. Pruebas inyectan un proveedor exclusivamente de test; no hay OTP fijo ni flag de bypass en runtime. Números E.164 únicos, desafío 5 min/5 intentos y proveedor como autoridad; OTP de un solo uso local y del proveedor. No eleva ni enlaza automáticamente una cuenta staff por teléfono. No se enviaron mensajes reales ni se contrataron servicios. Producción requiere servicio, costes/plantillas/configuración aprobados por el usuario.

## Contraseñas y sesión

Se usa `node:crypto.scrypt`, no un algoritmo criptográfico casero: N=131072, r=8, p=1, sal aleatoria 16 bytes, clave 64 bytes, comparación `timingSafeEqual`. Contraseñas nuevas 12–128 caracteres. DB solo guarda hash/params, no contraseña. Mensajes de acceso incorrecto genéricos; se verifica hash dummy para cuentas inexistentes.

Se retiró completamente el login de JWT de desarrollo y el generador de tokens. La sesión actual usa tokens **opacos aleatorios de 256 bits**, no JWT sin verificar: PostgreSQL guarda únicamente SHA-256 de access/refresh/CSRF. No hay claims privilegiados que el cliente pueda inventar. Acceso 5 min, refresh rotatorio 7 días, caducidad absoluta de familia 30 días. La sesión anterior queda rotada y no puede seguir accediendo; reusar su refresh revoca toda la familia. Logout revoca familia aun si el access venció. Repetir logout es seguro. Cada petición consulta cuenta activa/rol y revocación.

Login y solicitudes de OTP/invitado tienen límites persistidos en PostgreSQL (IP e identidad/desafío), ventana 15 min. No se confía en X-Forwarded-For; configurar cuidadosamente proxy confiable antes de desplegar para evitar compartir indebidamente un límite por toda una red. Limpieza/retención de límites y sesiones históricas queda pendiente, manteniendo suficientes rotaciones para detectar reuso.

## Web

Cookies access/refresh HttpOnly, SameSite=Lax y **Secure en producción**, sin Domain. Refresh Path=/auth; access Path=/. Cookie CSRF legible sin credenciales y token CSRF vinculado al hash de la sesión. Mutaciones exigen Origin de allowlist, JSON y `X-Playita-Client:web`; salvo login/invitado, también `X-CSRF-Token`. Ni access ni refresh se devuelven en body web ni se guardan en localStorage/sessionStorage. Login-CSRF se evita con Origin + cabecera no simple y CORS restrictivo. Rutas React protegidas y gestión de staff limitada a admin autenticado; el servidor vuelve a autorizar cada acción.

Restauración consulta `/auth/me` y renueva con cookie cuando procede. Renovación single-flight, y Web Locks cuando el navegador los soporta para serializar varias pestañas. Sin Web Locks, una carrera de refresh puede producir cierre por detección de reuso (seguro, requiere reingresar). Producción requiere allowlist explícita HTTPS para web; se admiten las origins de WebView nativo indicadas. Desplegar web/API en esquema y sitio compatibles con SameSite. No se configuró un despliegue.

Logout sin red es solo cierre local hasta que el servidor reciba revocación. Web conserva únicamente una intención booleana de cierre en sessionStorage para reintentar sin restaurar silenciosamente la sesión. No contiene secretos.

## Android/iPhone, offline y cuenta

Access solo en memoria. Refresh y metadatos mínimos en `@aparajita/capacitor-secure-storage`, Keychain iOS / Keystore Android; sin sincronización iCloud y con Keychain this-device-only. El wrapper rechaza web para no usar el fallback localStorage no cifrado del plugin. Password/refresh **nunca se guardan en SQLite**. La integración está compilada contra tipos publicados; todavía no ejecutada en dispositivo/simulador.

Primera entrada (también invitado) y renovación requieren conexión. Una identidad móvil previamente inicializada puede abrir su catálogo y conservar pedidos `pending_sync` offline, pero **no está autenticada ante el servidor** hasta renovar/reautenticar. No confirma pedidos, reserva global ni pagos. Cada transporte de outbox comprueba que el accountId actual coincida exactamente con el dueño original; no envía una cola bajo otra cuenta. Salir no elimina SQLite. Refresh inválido deja la identidad local en modo offline, sin permisos de administración remota.

Logout offline guarda la revocación pendiente en el vault nativo cifrado y la reintenta después; no promete revocación instantánea sin red. El backend desconecta sockets locales al revocar; además expiran con el access y se revalidan cada 30 s. Multinodo requerirá coordinación de revocación/socket adicional.

**Invitado no tiene recuperación por credencial personal.** Conservar cookies/vault permite continuidad hasta expiración. Cerrar sesión, perder el token o reinstalar puede impedir recuperar esa identidad, incluso en el mismo dispositivo. Sincronizar pendientes antes de salir. Los borradores permanecen aislados en SQLite, pero no se reasignan ni se reenvían bajo un invitado nuevo. La recuperación/vínculo social seguro está pendiente. No se promete recuperación entre dispositivos. La app evita cerrar accidentalmente un invitado con cola sin resolver y explica el motivo; recuperación tras pérdida de sesión requiere trabajo posterior, sin eludir permisos.

## Provisionar y probar

```sh
npm ci
# Configurar DATABASE_URL en .env, nunca versionarlo.
npm run db:migrate
# Definir solo en entorno local seguro PLAYITA_ADMIN_EMAIL y PLAYITA_ADMIN_PASSWORD.
npm run admin:bootstrap
npm run build
npm run dev:api
npm run dev:web
```

No existe cuenta fija del backend. El acceso ficticio del prototipo no se utiliza aquí. No se muestra ningún password existente ni hash en listados API/UI. Cambios de rol/contraseña, recuperación por email, verificación email, MFA, auditoría administrativa detallada y análisis de abuso requieren siguientes incrementos. Esta entrega no se presenta como sistema de producción auditado.

Pruebas: scrypt, cliente de sesión/aislamiento offline/single-flight y DOM React, más integración PostgreSQL real de credenciales, guest, rotación/reuso/logout/expiración, CSRF/origen, alta/desactivación/roles y proveedor OTP de test. Ver CI del commit actual. No hay prueba nativa real ni validación de Google/Apple/WhatsApp reales.

Fuentes: [Node crypto](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback), [OWASP parámetros scrypt](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [secure storage Capacitor 8](https://github.com/aparajita/capacitor-secure-storage), [Twilio verificación](https://www.twilio.com/docs/verify/api/verification), [Twilio validación de código](https://www.twilio.com/docs/verify/api/verification-check).
