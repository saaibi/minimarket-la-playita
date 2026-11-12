# Crédito, cobros y perfil

Las cuentas compradoras, vendedoras y administradoras pueden recibir crédito. Deben estar creadas, activas y tener credit_enabled=true; no se permiten invitados ni contactos manuales. El permiso está desactivado por defecto y solo el administrador lo modifica en Cuentas o al editar el cliente en Ajustes. Deshabilitarlo impide crédito nuevo, sin borrar deuda ni impedir abonos anteriores.

## Canasta única del personal

La misma canasta funciona en todos los módulos del personal y conserva cliente y efectivo al cerrar/reabrir. El ícono superior aparece también en Caja; se elimina solo el botón extra del listado. El banner verde permanece fijo. Los compradores conservan su flujo de pedido.

Hay un único campo Efectivo recibido. Sean T los productos, D la deuda anterior y C el efectivo:

- Pago de la compra = min(C,T).
- Nuevo crédito = max(T-C,0), con permiso obligatorio para dejar cualquier saldo nuevo.
- Abono anterior = min(max(C-T,0),D), aplicado a pedidos antiguos primero.
- Cambio = max(C-T-D,0).
- Saldo final = D + nuevo crédito - abono anterior.

C=0 deja toda la compra a crédito; un pago parcial crea crédito solo por el resto y deja el pago inicial anotado. El resumen muestra permiso, deuda actual, productos, pago de compra, nuevo crédito, abono, cambio y saldo posterior antes de confirmar. Si hay deuda, se explica que el excedente abona esa deuda antes de devolver cambio. Sin cliente registrado solo se admite pago completo.

El servidor verifica total, precio, stock, permiso y saldo con bloqueo. Venta, pago inicial y abonos se guardan en una sola transacción; cualquier conflicto revierte todo. El efectivo se registra manualmente después de recibirlo; no se ejecutan pagos externos ni se cobran intereses. Los abonos no modifican inventario. Los créditos no pueden retirarse como ventas de prueba.

## Consulta

Créditos muestra por defecto cuentas habilitadas y permite buscar por nombre/correo. La vista Saldos pendientes permite cobrar deudas de cuentas deshabilitadas. El total por cobrar incluye todas las deudas. Cada pedido conserva productos, cantidades y precios históricos; cada abono conserva importe y fecha.

Mi cuenta del comprador muestra su propio permiso, saldo, compras a crédito y abonos, además de otros pedidos. Las compras pagadas desde Caja con cuenta seleccionada también aparecen. La identidad de GET /credit/me procede exclusivamente de la sesión; no se acepta seleccionar otro cliente. Otros compradores no pueden leer el pedido ni el saldo ajeno. Invitados deben entrar con cuenta. El perfil no permite habilitar crédito ni registrar abonos.

## Persistencia y validación

Migraciones aditivas 007_customer_credit.sql, 008_credit_authorization.sql y 009_order_customer_link.sql. La última solo enlaza créditos que ya tenían cuenta explícita; no vincula ventas antiguas por coincidencias de nombre.

Escrituras con Idempotency-Key. El cuerpo y la clave se guardan localmente por usuario antes del envío. Resultados desconocidos y errores de autenticación conservan el intento; Créditos permite reintentarlo sin cobrar nuevamente. Conflictos de validación confirmados permiten corregir. Compatibilidad de hashes de POS anteriores para reintentar ventas pendientes al actualizar. No se guardan tokens en ese registro y no se confirma offline.

Pruebas: elegibilidad de los tres roles; permiso admin; rechazo de invitado/contacto/inactivo/no habilitado; crédito completo, parcial, pago exacto, abono y cambio; abonos concurrentes; snapshot de productos; aislamiento entre compradores; compras pagadas en historial propio; rollback íntegro por saldo/total/stock; reintentos y versiones previas; canasta igual entre módulos; filtros sin escrituras. Las pruebas PostgreSQL se ejecutan en CI con datos aislados, sin registrar operaciones financieras ficticias en producción.

El endpoint conserva los modos antiguos por compatibilidad con intentos pendientes; la interfaz nueva utiliza mode=auto, cashReceived, expectedTotalCop y expectedBalanceCop. Un cambio del saldo o total respecto al resumen obliga a actualizar y revisar antes de confirmar.
