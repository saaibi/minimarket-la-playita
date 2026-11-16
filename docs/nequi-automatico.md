# Cobro automático con Nequi: pendiente de vinculación

Estado actual: no hay un proveedor de cobro automático configurado. La aplicación no confirma pagos Nequi y no debe interpretar una captura de pantalla, un retorno del navegador o la selección de ese medio como un pago aprobado.

El propietario eligió cobro y confirmación automática, en lugar de registro manual. Falta confirmar si la tienda tiene Nequi Negocios, Wompi o solo una cuenta personal.

Opciones documentadas oficialmente:

- Integración directa: [vinculación de Negocios Nequi](https://www.nequi.com.co/negocios/vinculacion) y [proceso de integración y certificación](https://www.nequi.com.co/negocios/como-te-integras). Requiere acceso de pruebas, certificación y llaves de producción.
- Wompi admite Nequi como método: [métodos de pago](https://docs.wompi.co/docs/colombia/metodos-de-pago/). Requiere una cuenta de comercio y configuración de sus credenciales y eventos.

Tras elegir proveedor y obtener acceso de pruebas: preparar el cobro en el servidor con referencia única, importe y moneda; verificar el estado con el proveedor antes de aplicar el pago; autenticar las notificaciones según su contrato; procesar reintentos sin duplicar cobros, ventas, abonos ni movimientos de inventario. Probar aprobados, rechazados, expirados, respuestas perdidas, duplicados y valores que no coinciden con la operación. Las credenciales privadas permanecen en el servidor. La activación de pagos reales requiere completar la vinculación y validación del proveedor.

No se ha creado una cuenta de comercio, aceptado contratos, activado servicios de pago ni realizado cobros reales.
