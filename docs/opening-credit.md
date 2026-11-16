# Saldos anteriores de clientes

El administrador puede registrar, al crear o editar una cuenta con crédito habilitado, un saldo anterior positivo y una nota. Es único por cuenta, separado de pedidos y de productos. Repetir exactamente el mismo registro no vuelve a sumar deuda; intentar sustituirlo por otro valor devuelve conflicto. El dato original no se edita desde este formulario una vez registrado.

La migración PostgreSQL `012_opening_credit.sql` añade saldos y abonos históricos sin modificar existencias, pedidos ni movimientos existentes. No se modifica SQLite: los abonos usan el intento de crédito persistente ya existente, con su misma clave de idempotencia y aislamiento por usuario. El navegador admite ahora también la ruta de abonos a saldo anterior.

Administrador y vendedor pueden recibir abonos. Se bloquea la cuenta al aplicar abonos o liquidar desde caja para evitar pagos simultáneos por encima del saldo. El excedente de una compra paga primero el saldo anterior y después las compras a crédito anteriores. Las cantidades cobradas como saldo anterior nunca son ventas nuevas.

Créditos y Mi cuenta muestran el saldo anterior y sus abonos en un bloque separado. El resumen de negocio suma su saldo pendiente en cartera y sus abonos en cobros posteriores, pero no en ventas, productos vendidos ni en la torta contado/crédito al vender.

Se retiró de Ajustes el apartado vacío Contactos guardados. No se borraron registros de contactos de la base de datos.
