# Ruta de pruebas móviles: Android y TestFlight

Preparación, no publicación. No se crearon llaves/contraseñas de firma ni se subió una app. La autorización actual cubre preparar la ruta, no contratar cuentas, alojar API ni distribuir a terceros.

## Inventario comprobado

- Node 26.5, JDK OpenJDK 21 y Xcode 27.2 disponibles en el entorno.
- No se encontró Android SDK/adb en la ruta predeterminada del usuario. No se instaló un SDK ni se descargaron emuladores.
- Keychain informa **0 identidades válidas de firma de código**. No se confirmó cuenta Apple Developer/App Store Connect, equipo ni perfiles de aprovisionamiento.
- No hay keystore Android autorizado/configurado en el proyecto. No se buscó ni leyó contenido de llaves personales.
- Capacitor 8 + plugins SQLite/secure storage compilados a nivel TypeScript. Proyectos nativos, Gradle/Xcode y ejecución en dispositivo siguen sin validar.

## Ambiente del teléfono

Necesita una API de pruebas con **HTTPS válido**, PostgreSQL real y CORS allowlist para web y WebViews. `localhost` / `127.0.0.1` del teléfono no es el Mac; la API actual escucha solo en loopback. No se expuso LAN ni se habilitó cleartext automáticamente. Preparar un endpoint alcanzable requiere decisión/configuración de infraestructura separada; no se desplegó Render ni se contrataron recursos.

```sh
# Desde raíz del monorepo, tras disponer del endpoint real de pruebas:
VITE_API_URL=https://api-de-pruebas.example.invalid npm run mobile:check
VITE_API_URL=https://api-de-pruebas.example.invalid npm run build -w @playita/web
npm run cap:android -w @playita/web
npm run cap:ios -w @playita/web
npm run cap:sync -w @playita/web
```

El dominio example.invalid es marcador, no un servicio funcional. Confirmar appId/package/bundle identifier `co.laplayita.minimarket` y nombre con la cuenta elegida antes de reservarlos. Los proyectos generados se excluyen en este incremento; cuando se personalicen capacidades/entitlements, revisar y versionar el código nativo apropiado, nunca claves o perfiles. SQLite y secure storage requieren probar su configuración nativa real, incluida política backup/this-device-only. No se necesitan contactos, SMS, Gmail ni permisos de ubicación.

## Android

1. Instalar/configurar Android Studio, SDK exigido por Capacitor/Gradle y JDK compatible, y comprobar `adb devices` con un dispositivo de pruebas autorizado.
2. Generar/sincronizar con los comandos anteriores. Revisar permisos INTERNET y restricciones de cleartext/TLS; no incluir permisos de datos personales ajenos al flujo.
3. Para **debug** local: `cd apps/web/android && ./gradlew assembleDebug`. Android suele usar/generar un keystore debug; **no se ejecutó aquí** para no crear firmas sin revisión. Debug no es una firma de distribución.
4. Para release sin firma: `./gradlew assembleRelease` si el proyecto/configuración lo permite; comprobar claramente si el resultado es unsigned. No afirmar que un archivo sin firma sea APK de distribución.
5. Para **APK firmado de prueba**, acordar custodia del keystore, alias, contraseñas y respaldo. Introducirlos solo en Gradle Properties local/secretos de CI aprobados y configurar signingConfig fuera de Git. No pasar passwords en argumentos ni copiarlos al chat. Luego construir/verificar con `apksigner verify --verbose` e instalar en dispositivos autorizados. AAB/Play Console es otro flujo, no autorizado aquí.

No se generó APK (debug, unsigned ni firmado) en esta entrega.

## iPhone / TestFlight

1. Cuenta Apple Developer y acceso a App Store Connect, Team, bundle identifier, certificados/profiles de desarrollo/distribución y dispositivo/simulador apropiado. No crear/contratar membresía automáticamente.
2. Abrir proyecto generado con `npm exec -w @playita/web -- cap open ios`, seleccionar Team y capacidades correctas; revisar ATS/HTTPS, Keychain, plugins y política backup. No activar Sign in with Apple hasta implementar el flujo OIDC completo y registrar su configuración.
3. Ejecutar primero en simulador/dispositivo de pruebas. Comando reproducible orientativo tras verificar scheme/workspace generado: `xcodebuild -project apps/web/ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'generic/platform=iOS Simulator' build`. Ajustar al proyecto SPM/workspace realmente generado, no asumir nombres sin inspección.
4. Para distribución, `xcodebuild ... -configuration Release -archivePath <ruta-local>.xcarchive archive`, exportar con un `ExportOptions.plist` local preparado por el propietario de firma. Antes de Upload/TestFlight confirmar App Store Connect app, compliance/privacidad y testers autorizados. No guardar perfiles/keys en repo.

No se generó archive/IPA ni se subió a TestFlight.

## Matriz de aceptación en teléfonos

| Caso              | Verificación obligatoria                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| Primera entrada   | Requiere red. Invitado recibe id servidor; staff login correcto/incorrecto sin escalamiento                      |
| Secure storage    | Token no aparece en SQLite/localStorage/logs; bloqueo dispositivo/Keychain y reinstalación/backup según política |
| Offline           | Guardar pedido en SQLite como pending_sync; no confirmado/pagado/reserva global                                  |
| Reinicio forzado  | Pedido y clave sobreviven cierre/app kill; lease se recupera sin duplicado                                       |
| Red intermitente  | Perder respuesta tras commit; reenviar misma clave, una reserva/venta, ack recuperado                            |
| Expiración/logout | Access/refresh/absoluta, reuso y revocación; offline conserva pendientes sin prometer revocación inmediata       |
| Cambio cuenta     | Cola A jamás se envía con B; reautenticar A conserva su cola; invitado sin recuperación debe informar límites    |
| Stock/precio      | Conflicto explícito, revisión consciente, original no borrado; inventario global no garantizado offline          |
| Presentaciones    | 1/15/30 huevos con precios propios, mezcla, stock base y cancelación exacta; kilo/libra 500 g                    |
| Rol               | Costos/admin-users no accesibles a buyer/seller por UI ni llamada directa                                        |
| UI móvil          | Teclado, safe area, accesibilidad, foco/cierre, conectividad y errores comprensibles                             |
| Pagos/social      | No hay Nequi real ni Google/Apple conectados; opciones no simulan éxito                                          |

Registrar modelo/OS/versiones, build/commit, entorno API, evidencia de cada caso y fallos. La guía está preparada; la matriz todavía no está ejecutada en dispositivos.
