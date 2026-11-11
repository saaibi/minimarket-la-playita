# Google Sign-In (directo, sin Firebase)

Implementación: Credential Manager Android con botón explícito y GIS oficial web. El backend firma nuestras sesiones opacas tras verificar JWT RS256 contra JWKS de Google, emisor, audiencia WEB client ID, iat/exp, nonce y email_verified. Challenge de cinco minutos/un uso, vinculado a cookie HttpOnly web o secreto de prueba nativo. CSRF/orígenes y límites de intentos activos. No se guardan tokens de Google ni se solicitan Gmail/contactos.

Identidad Google por sub; cuenta nueva buyer. No vinculación automática por correo, no elevación a staff. Si un correo coincide con otra cuenta, usa su acceso habitual. Vincular cuentas y trasladar pedidos invitados no se implementa implícitamente.

Configurar un proyecto personal nuevo y gratuito de La Playita: branding, correo de soporte/contacto del propietario y audiencia externa. Registrar cliente WEB para los orígenes locales http://127.0.0.1:5173 y http://localhost:5173 (el frontend público aún no está publicado). Registrar cliente Android con paquete co.laplayita.minimarket y SHA-1 de la firma vigente. Obtener firma con apksigner local, sin subir claves. No hace falta secreto de cliente, cuenta de facturación, Firebase ni habilitar APIs de correo. Solo se usa el ID público del cliente WEB en GOOGLE_WEB_CLIENT_ID del backend; APK/web lo reciben mediante /auth/options. Apple omitido.

El modo testing limita las cuentas según Google Console; para compradores reales hay que completar publicación/verificación que Google solicite. No indicar disponible globalmente hasta probar inicio real. No incluir datos de soporte en Git sin autorización.

Pruebas: JWT firmados con llaves de test, JWKS HTTP local y fallo HTTP; suite PostgreSQL de challenge/replay/nonce/colisiones/CSRF/web/native/desactivación; sesión móvil en vault y cancelación. Esto no sustituye prueba real con Google y teléfono. Postman CLI no disponible; pruebas ejecutadas con Node y CI PostgreSQL.

Fuentes: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation
https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid

Estado: código validado en CI y desplegado en Render, Google deshabilitado hasta configurar GOOGLE_WEB_CLIENT_ID. Proyecto personal minimarket-la-playita creado sin organización ni prueba gratuita/facturación. No se creó proyecto con la cuenta corporativa. Formulario de marca preparado con el nombre de la app; pendiente decisión del propietario sobre correo de asistencia visible, luego audiencia, aceptación de políticas y clientes web/Android.
