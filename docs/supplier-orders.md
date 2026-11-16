# Pedidos de reposición por proveedor

Inventario permite filtrar por el proveedor ya guardado en cada producto. Los productos sin proveedor se agrupan como «Sin proveedor».

Solo el administrador ve las acciones flotantes «Nuevo producto» y «Preparar pedido». El botón se puede arrastrar, conserva su posición en este navegador o dispositivo y se mantiene dentro de la ventana al cambiar de tamaño.

Preparar pedido incluye productos cuya disponibilidad es menor o igual al mínimo (también agotados). Se toma la disponibilidad después de reservas. El administrador elige productos y escribe cantidades: unidades enteras, kilos o libras según la medida del producto. El mínimo de alerta no se usa como cantidad sugerida de compra.

Compartir abre el selector del sistema con texto agrupado por proveedor. No envía mensajes automáticamente, no guarda una compra y no modifica existencias, pedidos de clientes ni deuda. Hay alternativas de copiar y descargar texto. El pedido se prepara en pantalla; cerrar el formulario descarta las cantidades introducidas.

Android usa el complemento oficial `@capacitor/share`; web depende de la disponibilidad de Web Share y mantiene las alternativas de texto. No requiere cambios en PostgreSQL ni SQLite.

También se actualizaron los selectores de estilos de botones a las clases de Material actuales para conservar contraste al pasar el cursor, pulsar o enfocar con teclado.
