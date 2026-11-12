# Google Sign-In (directo, sin Firebase)

Implementación: Credential Manager Android con botón explícito y GIS oficial web. El backend firma nuestras sesiones opacas tras verificar JWT RS256 contra JWKS de Google, emisor, audiencia WEB client ID, iat/exp, nonce y email_verified. Challenge de cinco minutos/un uso, vinculado a cookie HttpOnly web o secreto de prueba nativo. CSRF/orígenes y límites de intentos activos. No se guardan tokens de Google ni se solicitan Gmail/contactos.

Identidad Google por sub; cuenta nueva buyer si el administrador no asignó otro rol. El administrador asigna correo y rol mediante /auth/users/assign-role, sin contraseña. Una cuenta ya existente puede vincularse por coincidencia exacta de correo únicamente cuando Google acredita propiedad actual (Gmail o claim hd verificado de Workspace). Correos de terceros sin hd requieren el acceso habitual y no se vinculan por email_verified solamente. Un usuario ya vinculado a otro sub no se reasigna. No se trasladan pedidos invitados automáticamente.

El rol proviene de app_users y solo un administrador puede cambiarlo; nunca del token ni del cuerpo del login. No se reactivan cuentas inactivas. Un cambio de rol revoca todas las sesiones de la cuenta, protege el rol propio y último administrador y deja auditoría account.role. /auth/customers lista compradores registrados solo para administrador, excluyendo invitados y secretos. Ajustes muestra clientes y contactos solo para consulta.

Configurar un proyecto personal nuevo y gratuito de La Playita: branding, correo de soporte/contacto del propietario y audiencia externa. Registrar cliente WEB para los orígenes locales http://127.0.0.1:5173 y http://localhost:5173 (el frontend público aún no está publicado). Registrar cliente Android con paquete co.laplayita.minimarket y SHA-1 de la firma vigente. Obtener firma con apksigner local, sin subir claves. No hace falta secreto de cliente, cuenta de facturación, Firebase ni habilitar APIs de correo. Solo se usa el ID público del cliente WEB en GOOGLE_WEB_CLIENT_ID del backend; APK/web lo reciben mediante /auth/options. Apple omitido.

El modo testing limita las cuentas según Google Console; para compradores reales hay que completar publicación/verificación que Google solicite. No indicar disponible globalmente hasta probar inicio real. No incluir datos de soporte en Git sin autorización.

Pruebas: JWT firmados con llaves de test, JWKS HTTP local y fallo HTTP; suite PostgreSQL de challenge/replay/nonce/colisiones/CSRF/web/native/desactivación; sesión móvil en vault y cancelación. Esto no sustituye prueba real con Google y teléfono. Postman CLI no disponible; pruebas ejecutadas con Node y CI PostgreSQL.

Fuentes: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation
https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid

Estado: proyecto personal minimarket-la-playita creado sin organización ni facturación. El propietario autorizó correo personal de asistencia, política Google y creación de clientes web/Android; ambos registrados. ID público WEB configurado en Render y /auth/options confirma disponible=true. La marca usa público externo en modo prueba; pendiente inicio real completo y publicación/verificación para todos los compradores. No se descargó ni usó secreto de cliente. La clave de firma Android no se subió.

Actualización móvil: el adaptador SecureStorage usa get/set simétricos; getItem devolvía JSON todavía codificado y rompía restauración/logout pendiente. Prueba del codec real y registros existentes aprobada. Acceso interactivo espera el despertar de Render con temporizador compatible con WebView; errores de red no borran refresh. Botón Google solo logo oficial centrado y etiqueta accesible, según propietario.
