# Saldos anteriores de clientes

El administrador puede registrar, al crear o editar una cuenta con crédito habilitado, un saldo anterior positivo y una nota. Es único por cuenta, separado de pedidos y de productos. Repetir exactamente el mismo registro no vuelve a sumar deuda; intentar sustituirlo por otro valor devuelve conflicto. El dato original no se edita desde este formulario una vez registrado.

La migración PostgreSQL `012_opening_credit.sql` añade saldos y abonos históricos sin modificar existencias, pedidos ni movimientos existentes. No se modifica SQLite: los abonos usan el intento de crédito persistente ya existente, con su misma clave de idempotencia y aislamiento por usuario. El navegador admite ahora también la ruta de abonos a saldo anterior.

Administrador y vendedor pueden recibir abonos. Se bloquea la cuenta al aplicar abonos o liquidar desde caja para evitar pagos simultáneos por encima del saldo. El excedente de una compra paga primero el saldo anterior y después las compras a crédito anteriores. Las cantidades cobradas como saldo anterior nunca son ventas nuevas.

Créditos y Mi cuenta muestran el saldo anterior y sus abonos en un bloque separado. El resumen de negocio suma su saldo pendiente en cartera y sus abonos en cobros posteriores, pero no en ventas, productos vendidos ni en la torta contado/crédito al vender.

Se retiró de Ajustes el apartado vacío Contactos guardados. No se borraron registros de contactos de la base de datos.

## Abono único por cliente

En Créditos, el detalle del cliente ofrece un único botón «Registrar abono». El importe se reparte primero al saldo anterior y después a las compras más antiguas, completando cada saldo antes de pasar al siguiente. Se mantiene el historial de lo aplicado a cada deuda y un registro auditable del total recibido.

`POST /credit/clients/:id/payments` requiere un importe y el saldo esperado, además de clave de idempotencia. Está limitado a administrador y vendedor, rechaza importes que excedan la deuda y cambios de saldo concurrentes. Comparte el reparto de la canasta; no modifica existencias ni cuenta como venta nueva. Los endpoints de abonos por pedido y saldo anterior se conservan para APK anteriores, pero la interfaz nueva usa el abono único. Los intentos pendientes de esta ruta también se conservan con la infraestructura SQLite existente, sin cambios de esquema local.
