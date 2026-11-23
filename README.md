# Inventory Guardian

Se deben ingresar productos, por su codigo de barras y se debe ingresar la cantidad de productos que llegaron

Se deben pasar los poductos por el codigo de barras y se ve en el inventario si se vende se borra del inventarip y se marca la cantidad vendida y se muestra en inventario cuantos quedan

Los productos que no tengan codigo de barra, deben tener una palabra clave, al ingresar el precio, se coloca la palabra y asi se muestra la cantidad de ventas de ese producto, si es un pan, se coloca "p" Y el precio, la aplicacion sabe el precio por kilo, asi que sabe cuantos kilos se vendieron, cada fruta tiene su palabra clave, si tienen la misma incial, se deben usar las primeras 2 "pa" Y se ingresa la cantidad, si se vende por peso, se debe usar el mismo metodo que el pan, la aplicacion debe saber el precio por kilo

El usuario puede ver siempre en una pestaña, los datos de su inventario, lo que entreo y salio, lo ganado y mostrara que se vende mas, se puede eleguir por dia, semanas o mes

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/680d0b7f-e2f3-4901-adcf-ff9c5f8e38e1).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Usuarios y permisos

Después de actualizar el proyecto, aplica en Supabase y en este orden las migraciones
`20261102170000_consultation_role.sql` y `20261102171000_user_permissions_and_management.sql`.
La administración de invitaciones y último acceso usa las variables de servidor
`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`; la clave de servicio nunca debe exponerse
con prefijo `VITE_`. Configura también el proveedor de correo de Supabase y permite
`/auth` como URL de redirección para invitaciones y recuperación de contraseña.

## Notificaciones WhatsApp

Aplica las migraciones en este orden:

1. `supabase/migrations/20261102180000_whatsapp_notifications.sql`
2. `supabase/migrations/20261102190000_whatsapp_movement_alerts.sql`
3. `supabase/migrations/20261102200000_supplier_return_movement_type.sql`
4. `supabase/migrations/20261102201000_supplier_return_rpc.sql`
5. `supabase/migrations/20261102202000_manual_exit_movement_type.sql`
6. `supabase/migrations/20261102203000_manual_movements_and_stock_audit.sql`
7. `supabase/migrations/20261102210000_business_profile_settings.sql`

Después despliega la función:

```sh
npx supabase db push
npx supabase functions deploy whatsapp-notifications
```

Ejecuta estos comandos con una cuenta que tenga acceso al proyecto de Supabase; si el enlace
no está configurado, primero ejecuta `npx supabase link --project-ref <project-ref>`.

La última migración habilita las salidas manuales y conserva una auditoría de stock anterior y
posterior que no se puede editar ni borrar desde la aplicación. Los cajeros pueden consultar
movimientos; los ajustes manuales requieren el rol de administrador.

La migración `20261102210000_business_profile_settings.sql` agrega descripción, región, horario,
días de funcionamiento y estado del local. La moneda se mantiene en CLP y la zona horaria en
`America/Santiago` para coincidir con los cálculos existentes de ventas y fechas.

Configura en Supabase únicamente como secretos de Edge Functions:
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_ALERT_TEMPLATE`,
`WHATSAPP_DAILY_REPORT_TEMPLATE` y `WHATSAPP_CRON_SECRET`. Opcionalmente configura
`WHATSAPP_ALERT_LANGUAGE`, `WHATSAPP_DAILY_REPORT_LANGUAGE` y `WHATSAPP_GRAPH_VERSION`.
No guardes el token de Meta en el frontend ni en variables `VITE_*`. La función usa
`SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` del entorno de Supabase.

En Meta, crea y aprueba las siguientes plantillas en español (Chile):

- Alertas: el cuerpo debe tener un único parámetro de texto; asigna su nombre a
  `WHATSAPP_ALERT_TEMPLATE`.
- Reporte diario: categoría **Utilidad**, nombre `reporte_diario_tienda`, idioma **Español
  (Chile)** y este cuerpo:

```text
Hola, este es el resumen del {{1}} de Minimarket Maxi: ventas totales ${{2}} en {{3}} transacciones. Ganancia estimada: ${{4}}. Producto destacado: {{5}}. Mermas: {{6}}. Productos con stock bajo: {{7}}. Que tengas una buena noche.
```

La plantilla del reporte usa siete variables, en este orden: fecha (`3 de noviembre`), ventas
(`152.300`), transacciones (`48`), ganancia estimada (`38.500`), producto destacado
(`Coca-Cola 1.5 L`), mermas (`2 unidades`) y productos con stock bajo (`ninguno`). La aplicación
calcula las ventas a partir de los pagos registrados, la ganancia como venta menos costo, y las
mermas a partir de los movimientos de tipo `merma`. Ninguna variable se envía vacía.
Asigna `reporte_diario_tienda` a `WHATSAPP_DAILY_REPORT_TEMPLATE`; el idioma predeterminado es
`es_CL` y se puede cambiar con `WHATSAPP_DAILY_REPORT_LANGUAGE`.

Programa una llamada autenticada `POST` a la URL de la función con el cuerpo
`{"action":"scheduled"}` y encabezado `Authorization: Bearer <WHATSAPP_CRON_SECRET>`.
Ejecútala cada 15 minutos: la función compara la hora local de Chile,
genera como máximo un reporte diario y procesa las alertas pendientes de inventario y actividad
(salidas manuales, ajustes manuales, mermas y devoluciones de clientes y proveedores). Las alertas
de actividad requieren que las notificaciones y las alertas de inventario estén activadas en
Configuración.
`WHATSAPP_CRON_SECRET`
debe ser un valor aleatorio largo, distinto del token de Meta.

La configuración e historial solo están disponibles para administradores. La acción
programada desactiva la verificación JWT del gateway porque autentica el secreto de cron
en la función; las acciones manuales validan allí mismo la sesión y el rol de administrador.
