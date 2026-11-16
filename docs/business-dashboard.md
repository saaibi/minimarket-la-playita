# Resumen del negocio

Solo administrador, debajo del listado paginado de Ventas. Endpoint `GET /reports/business?from=AAAA-MM-DD&to=AAAA-MM-DD`, fechas inclusivas en America/Bogota, máximo 366 días. Una consulta PostgreSQL agrega todos los registros del intervalo; no usa el límite de 100 pedidos del listado.

Las ventas incluyen pedidos entregados pagados o registrados a crédito, excluyendo retiradas y canceladas. La fecha es la de registro, no la fecha de entrega. La torta y las columnas dividen el importe en pago inicial y deuda inicial; la suma coincide con ventas. Los pagos iniciales de crédito se identifican por la fecha transaccional compartida con su orden (ambos se insertan en la misma transacción). Los abonos posteriores se contabilizan aparte por su propia fecha. La deuda actual descuenta todos los pagos de créditos entregados no retirados. Cartera e inventario son estados actuales, no cierres históricos.

Los productos se ordenan por importe vendido, sin sumar kilos con unidades. No se estima utilidad con costos actuales. Los datos agregados no incluyen correos ni nombres de clientes.

Google Charts carga desde su CDN oficial una sola vez por página y requiere internet. El fallo de gráficos conserva totales y tablas accesibles. No se descarga la biblioteca para alojarla sin conexión. Referencias: https://developers.google.com/chart/interactive/faq y https://developers.google.com/chart/interactive/docs/gallery/controls.

Las pruebas de integración cubren permisos, fechas, ventas retiradas y reparto de ventas parciales a crédito sin duplicar abonos.

El historial usa `GET /sales?page=1` (administrador y vendedor), con 20 ventas por página y totales de todo el historial. Excluye ventas retiradas y pendientes. El resumen de negocio se presenta debajo del historial de Ventas, solo para administradores.
