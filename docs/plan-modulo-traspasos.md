# Plan del módulo de Traspasos

**Estado:** planificación; no implementada.  
**Alcance:** traspasos de lotes entre las seis farmacias municipales.  
**Roles involucrados:** Administrador y Técnico.

## 1. Objetivo

Permitir que un técnico solicite medicamentos para su farmacia cuando exista una necesidad, que un administrador revise la solicitud y elija una farmacia de origen, y que los técnicos registren la salida y la recepción del lote.

El módulo no permitirá que los técnicos consulten los lotes ni las existencias disponibles de otras farmacias. Cada técnico trabajará con la sucursal asignada a su usuario. El administrador tendrá una vista consolidada para revisar y asignar solicitudes.

Una farmacia podrá crear nuevas solicitudes aunque ya tenga uno o más traspasos en progreso. Cada solicitud se seguirá de forma independiente.

## 2. Situación actual del proyecto

La aplicación actual es una web modular con navegación y vistas condicionadas por rol. Sus servicios consultan Supabase directamente desde el navegador y utilizan caché local y una cola offline.

El filtrado actual de inventario por sucursal ocurre en el cliente después de descargar datos de todas las sucursales. Por ello, ocultar o filtrar lotes en una vista no satisface el requisito de que un técnico no pueda consultar inventario ajeno. La sincronización también obtiene huellas de inventario globales.

El plan integral de producción del proyecto propone incorporar una API propia entre el navegador y PostgreSQL. La autorización de traspasos y la entrega limitada de datos deben aplicarse en esa capa del servidor. No se debe considerar suficiente una restricción de navegación o de interfaz.

Referencias de código y documentación actuales:

- Navegación y enrutamiento de módulos: `index.html` y `src/js/app.js`.
- Roles y sesión de usuario: `src/services/authService.js`.
- Consulta y caché de inventario: `src/services/inventoryService.js`.
- Sincronización y operaciones offline: `src/services/syncService.js`.
- Modelo de datos descrito: `docs/modelo-datos.md`.
- Arquitectura objetivo para producción: `docs/plan-integral-produccion-postgresql-vps.md`.

## 3. Actores y permisos

### Técnico solicitante

- Crea una solicitud para la sucursal asignada a su cuenta.
- Indica el medicamento, la cantidad requerida, la urgencia y el motivo.
- Consulta sus propias solicitudes y el estado de cada una.
- No consulta existencias, lotes ni precios de otras sucursales.
- Puede crear otra solicitud aunque tenga traspasos pendientes o en progreso.
- Confirma la recepción del traspaso destinado a su sucursal.

### Administrador

- Consulta la cola de solicitudes nuevas y su detalle.
- Asigna una de las farmacias activas como origen.
- Designa un único técnico responsable en la sucursal de origen. El técnico que creó la solicitud será el responsable de recepción en destino.
- Aprueba o deniega la solicitud; la denegación requiere motivo.
- Consulta el estado y el historial completo de todos los traspasos.
- No puede confirmar la recepción en nombre del técnico receptor como parte del flujo normal.

### Técnico de la farmacia origen asignada

- Ve únicamente los traspasos aprobados y asignados a su sucursal.
- Ve el medicamento solicitado y la cantidad que debe preparar.
- Atiende con prioridad la tarea asignada, selecciona lotes de su propia sucursal y registra las cantidades despachadas. En cada farmacia se asigna un único técnico responsable por traspaso.
- No ve el inventario de la sucursal solicitante ni de las demás farmacias.

### Técnicos de otras farmacias

- No ven solicitudes que no pertenezcan a su sucursal ni tareas asignadas a otra sucursal.
- No ven los lotes vinculados a esos traspasos.

## 4. Flujo de trabajo

### Paso 1: solicitud y decisión de administración

1. El técnico solicitante crea una solicitud asociada automáticamente a su sucursal e incluye uno o varios medicamentos cuyo stock en esa sucursal es insuficiente para la necesidad indicada.
2. La solicitud aparece en la cola administrativa en estado **Solicitado**.
3. El administrador revisa la necesidad y elige una de estas acciones:
   - **Aprobar y asignar:** selecciona la farmacia de origen, elige un único técnico activo de esa sucursal como responsable y define la cantidad aprobada por medicamento. El técnico solicitante será responsable de confirmar la recepción en destino.
   - **Denegar:** registra un motivo; no se modifica inventario.
4. Tras la aprobación, el técnico responsable de la farmacia de origen recibe una tarea prioritaria. El solicitante ve que el traspaso está en progreso.
5. Si un lote no alcanza para cubrir la cantidad aprobada, el administrador puede autorizar que se prepare con varios lotes. El módulo muestra la advertencia **«Se utilizará más de un lote para el traspaso»** y registra esa autorización.
6. Si no hay lotes elegibles suficientes, el administrador puede ajustar la cantidad aprobada. El cambio queda en el pedido y se notifica al técnico solicitante y al técnico de origen asignado. El técnico de origen no puede modificarla.

### Paso 2: preparación y salida desde origen

1. El técnico de origen abre la tarea asignada.
2. El sistema solo le permite elegir lotes de su propia sucursal que coincidan con los medicamentos aprobados y cuyo vencimiento sea de al menos seis meses desde la fecha de despacho.
3. Si administración autorizó el uso de varios lotes para una línea de medicamento, el técnico puede distribuir la cantidad aprobada entre esos lotes; se muestra la advertencia correspondiente.
4. El técnico registra los identificadores de los lotes, las cantidades por lote y la confirmación del despacho.
5. El sistema descuenta las cantidades de cada registro de lote seleccionado y la solicitud pasa a **Despachado**.

La farmacia solicitante mantiene el indicador **«Traspaso en progreso»** hasta que su técnico confirme la recepción.

### Paso 3: recepción en destino

1. El técnico de la sucursal solicitante abre el traspaso despachado.
2. Confirma la recepción de los lotes y puede enviar una observación sobre el traspaso.
3. El técnico no puede rechazar el lote ni modificar cantidades. Antes de confirmar la salida, solo el administrador puede modificar el despacho; el pedido actualizado se muestra a los técnicos responsables. Después de despachado, cualquier corrección se registra como un movimiento compensatorio auditado, sin editar el despacho original.
4. El sistema registra el ingreso en destino con la identidad de cada lote despachado y cambia el estado a **Recibido**.

## 5. Estados y transiciones

| Estado | Quién puede producir la transición | Visibilidad principal | Efecto en inventario |
|---|---|---|---|
| `solicitado` | Técnico de la sucursal solicitante crea la solicitud | Cola administrativa y solicitud propia del técnico solicitante | Ninguno |
| `denegado` | Administrador | Administrador y solicitante de esa solicitud | Ninguno |
| `aprobado_asignado` | Administrador aprueba, fija cantidades por medicamento y asigna sucursal origen y un técnico responsable | Administrador, solicitante y técnico de origen asignado | Ninguno todavía |
| `despachado` | Técnico de origen registra uno o más lotes por medicamento y la salida | Administrador, solicitante y técnicos responsables de origen/destino | Descuenta cada cantidad del registro de lote de origen correspondiente |
| `recibido` | Técnico de destino confirma recepción y puede agregar observaciones | Administrador y técnicos responsables de origen/destino; solicitante consulta el estado | Incrementa inventario de destino conservando la identidad de cada lote |
| `cancelado_por_administrador` | Administrador cancela un traspaso aprobado que aún no fue recibido | Administrador y técnicos responsables de las sucursales participantes | Si ya hubo despacho y el lote no llegó, devuelve en el sistema la cantidad al registro exacto del lote de origen mediante una operación auditada |

Transiciones permitidas:

```text
solicitado ── administrador aprueba y asigna ──> aprobado_asignado
solicitado ── administrador deniega ───────────> denegado
aprobado_asignado ── técnico de origen despacha ──> despachado
despachado ── técnico de destino confirma recepción ──> recibido
aprobado_asignado o despachado ── administrador cancela antes de recepción ──> cancelado_por_administrador
```

Los estados `denegado`, `recibido` y `cancelado_por_administrador` son terminales. El administrador puede cancelar una solicitud aprobada que todavía no fue recibida, por ejemplo, si el lote no llega. La cancelación requiere motivo y responsable. Si aún no se despachó, no hay inventario que revertir. Si ya se descontó el lote de origen, el sistema devuelve la cantidad al mismo registro de inventario de origen como movimiento compensatorio auditado. No se modifica ni borra el historial original.

### Presentación en la sucursal solicitante

- Mientras espera revisión administrativa, el técnico ve su solicitud como **Pendiente de administración**.
- Una vez aprobada y asignada, ve **«Traspaso en progreso»** hasta confirmar la recepción.
- La indicación corresponde a cada solicitud; un traspaso pendiente no impide crear otra.

## 6. Datos a registrar

Se recomienda una entidad principal de traspaso con varias líneas de medicamentos y, dentro de cada línea, uno o más lotes de despacho. Esto permite que una sola solicitud agrupe distintos medicamentos y que un medicamento aprobado se complete con varios lotes si el administrador lo autoriza.

### Solicitud

- Identificador único.
- Sucursal solicitante y usuario solicitante, derivados de la sesión autenticada.
- Una o más líneas con medicamento solicitado, stock actual de la sucursal solicitante al crear el pedido, cantidad que se solicita recibir y cantidad aprobada.
- Motivo y nivel de urgencia de la solicitud.
- Estado actual y fechas de creación/actualización.
- Sucursal origen asignada por administración, cuando exista.
- Usuario, fecha y motivo de aprobación o denegación.

### Despacho y recepción

- Para cada línea de medicamento, uno o más identificadores exactos de registros de inventario de origen seleccionados por el técnico asignado.
- Nombre/identificador del medicamento, código de lote y vencimiento de cada lote como identidad y datos de trazabilidad.
- Cantidad despachada por lote, responsable y fecha/hora.
- Identificador del registro de inventario de destino creado o actualizado para cada lote recibido, enlazado a su registro de origen.
- Cantidad recibida, responsable y fecha/hora.
- Diferencia o comentario de recepción cuando corresponda.

La referencia de inventario debe preservar qué lote originó el traspaso. No se debe combinar el traspaso con el historial de ingresos de proveedor: es un movimiento entre sucursales con su propio ciclo y trazabilidad.

## 7. Reglas de negocio y consistencia

1. La sucursal solicitante se obtiene de la identidad del usuario; no se acepta libremente desde el navegador.
2. Solo un administrador puede asignar la sucursal de origen y aprobar o denegar.
3. Solo técnicos de la sucursal origen asignada pueden preparar y despachar el lote.
4. Solo técnicos de la sucursal destino pueden confirmar su recepción.
5. Origen y destino deben ser sucursales activas y diferentes.
6. El lote de origen debe pertenecer a la sucursal asignada, corresponder al medicamento solicitado, no estar vencido y tener cantidad suficiente.
7. Al despachar, se debe reconocer el registro exacto del lote de origen (su `inventory_id`), comprobar que pertenece a la farmacia asignada y descontar únicamente de ese lote. La validación de disponibilidad y el descuento deben ser atómicos para impedir stock negativo o doble despacho concurrente.
8. No se despachan lotes con menos de seis meses hasta su vencimiento al momento de la salida. Esta condición se vuelve a verificar al despachar, aunque el pedido se haya aprobado antes.
9. Si una solicitud incluye varios medicamentos, cada línea puede despacharse desde uno o más lotes. El uso de más de un lote para una línea requiere autorización administrativa y muestra **«Se utilizará más de un lote para el traspaso»**.
10. La recepción crea o actualiza inventario de destino de manera atómica y conserva la identidad de cada lote de origen: medicamento, código de lote y vencimiento. Si ese lote ya existe en destino, se suma la cantidad recibida a ese registro; si no existe, se crea un registro para la sucursal receptora con la misma identidad y una referencia al registro de origen.
11. El técnico receptor no puede rechazar lotes ni cambiar cantidades; puede confirmar la recepción y agregar observaciones. Cualquier modificación del despacho o de las cantidades corresponde exclusivamente al administrador, queda auditada y actualiza el pedido visible a los técnicos responsables.
12. Cada traspaso asigna un único técnico responsable por sucursal participante. La farmacia origen asignada debe atender la solicitud con prioridad.
13. Solicitudes independientes pueden coexistir para la misma sucursal. La unicidad de una solicitud activa por sucursal no debe usarse como bloqueo.
14. Cada transición registra usuario autenticado, rol, sucursal, fecha/hora, estado anterior/nuevo y detalles relevantes en auditoría. Las solicitudes aprobadas, denegadas y canceladas se conservan; no se borran.
15. Las operaciones deben ser idempotentes para evitar doble despacho, devolución o recepción por reintentos.
16. No se modifica inventario por crear, aprobar o denegar una solicitud.
17. El administrador puede cancelar una solicitud aprobada que no haya sido recibida; la cancelación registra motivo, fecha y responsable. Si ya se despachó y el lote no llegó, el sistema devuelve las cantidades al inventario de origen en los mismos lotes que se descontaron, mediante una operación compensatoria auditada.

## 8. Privacidad y arquitectura necesaria

La autorización debe aplicarse en API/servidor y en las consultas de base de datos, no solo en los componentes visuales. La API debe devolver:

- Al administrador, solicitudes y datos necesarios para asignar y supervisar toda la red.
- Al técnico solicitante, sus propias solicitudes y estados.
- Al técnico de origen, únicamente traspasos asignados a su sucursal y lotes de su propio inventario.
- Al técnico receptor, únicamente recepciones destinadas a su sucursal.

Las respuestas del módulo técnico no deben contener cantidades disponibles, lotes ni precios de otras sucursales. Se debe revisar también cachés locales, sondeos de cambios, endpoints de inventario y colas offline para evitar que esos datos se descarguen por otros caminos.

La documentación actual del modelo de datos describe políticas públicas amplias en Supabase y controles de rol implementados en el frontend. Eso no es una base segura para esta función entre sucursales. La implementación de producción debe seguir la arquitectura de API propia y credenciales de servidor descrita en el plan integral.

## 9. Interfaz prevista

### Módulo de técnicos: «Traspasos»

- Formulario para solicitar medicamento, cantidad, urgencia y motivo.
- Lista de solicitudes propias con estado, fecha y farmacia origen asignada si ya fue aprobada.
- Indicador **«Traspaso en progreso»** desde que se aprueba y asigna hasta la recepción.
- Bandeja de tareas de origen asignadas a la sucursal del técnico, con selección de lote local y registro de despacho.
- Bandeja de recepciones destinadas a la sucursal del técnico, con confirmación de recepción y campo de observación. El técnico no puede rechazar el traspaso ni modificar sus cantidades.
- No incluir buscador de lotes de otras sucursales ni un catálogo de disponibilidad de red.

### Módulo de administración: «Traspasos»

- Cola de solicitudes `solicitado`.
- Vista de detalle con sucursal solicitante, medicamento, cantidad, motivo y urgencia.
- Selección de farmacia origen, un técnico responsable por sucursal y cantidades aprobadas por medicamento; botones de aprobar/denegar.
- Campo obligatorio de motivo para denegación.
- Acción para cancelar solicitudes aprobadas que aún no fueron recibidas, con motivo obligatorio; si ya hubo despacho, el sistema devuelve en el inventario el lote al registro exacto de origen mediante movimiento compensatorio auditado.
- Acción para ajustar cantidades aprobadas y autorizar el uso de varios lotes por medicamento. Los cambios se muestran en el pedido y notifican a los técnicos responsables.
- Seguimiento de aprobados, despachados, recibidos, denegados y cancelados.
- Historial de acciones, responsables, fechas y discrepancias.

## 10. Notificaciones inmediatas

Las notificaciones deben generarse al confirmar cada cambio en el servidor y entregarse de inmediato a las personas correspondientes. Una actualización periódica de la bandeja no sustituye la notificación.

- **Solicitud creada:** notificar a los administradores para que revisen la nueva solicitud.
- **Solicitud aprobada y farmacia origen/técnico responsable asignados:** notificar al técnico responsable de origen y al solicitante; actualizar el estado visible al solicitante a **«Traspaso en progreso»**.
- **Cantidad aprobada o despacho modificado por administración:** notificar a los técnicos responsables de origen y destino y actualizar el pedido visible.
- **Lote despachado:** notificar al técnico de la sucursal destino para que confirme la recepción y al administrador para su seguimiento.
- **Solicitud denegada o cancelada:** notificar al técnico solicitante; en una cancelación, notificar también a la sucursal origen si participó en el despacho.
- **Lote recibido o recepción con discrepancia:** notificar al administrador y reflejar el resultado en el historial de ambas sucursales participantes.

Las notificaciones son exclusivamente dentro del sistema, inmediatas y persistentes en la bandeja de notificaciones del administrador o técnico destinatario. Deben validar el destinatario por rol y sucursal, seguir visibles si el usuario no tenía la aplicación abierta y ser idempotentes para no duplicarse en reintentos. No se contemplan correo ni SMS en esta etapa.

## 11. Operación sin conexión

Para la primera versión, solicitar, aprobar, denegar, despachar, recibir y cancelar requieren conexión con la API central. No se deben encolar cambios de traspaso para ejecutarlos automáticamente más tarde, porque la autorización, la disponibilidad del lote y el estado pueden haber cambiado. No se contemplan borradores offline en esta etapa.

La interfaz debe explicar que la operación no se completó y permitir reintentar cuando vuelva la conexión.

## 12. Plan de implementación por fases

1. **Cerrar alcance inicial:** aplicar las decisiones confirmadas de este documento y adoptar el catálogo local de la sucursal para elegir medicamentos; resolver la retención con la política institucional vigente.
2. **Preparar autorización de servidor:** implementar identidad y controles de rol/sucursal en la API objetivo; eliminar la dependencia de filtros locales para proteger inventario.
3. **Diseñar y migrar datos:** crear modelo, restricciones, índices y registro de eventos; probar desde una base local vacía.
4. **Implementar operaciones transaccionales:** solicitar, asignar/aprobar, denegar, despachar, recibir; enlazar cambios de inventario y auditoría en transacciones.
5. **Crear servicios de aplicación:** incorporar consultas de alcance restringido, manejo de errores, idempotencia y actualizaciones de estado.
6. **Crear módulos de interfaz:** añadir navegación por rol, vista de técnico y módulo administrativo.
7. **Verificar seguridad y negocio en staging:** usar datos ficticios y probar acceso directo a endpoints, concurrencia, cantidades, vencimientos, duplicados y aislamiento entre sucursales.
8. **Habilitar gradualmente:** formar a administradores y técnicos, activar el módulo y revisar el primer ciclo de solicitudes y recepciones.

## 13. Criterios de aceptación

- [ ] Un técnico puede solicitar un medicamento solo para su sucursal asignada.
- [ ] La solicitud nueva aparece en la cola administrativa; ningún técnico ajeno puede consultar su detalle.
- [ ] El administrador puede asignar una farmacia origen y aprobar o denegar con motivo.
- [ ] Solo la sucursal origen asignada ve la tarea de preparación.
- [ ] El técnico origen solo puede seleccionar lotes de su propia sucursal.
- [ ] Solo se pueden despachar lotes con al menos seis meses hasta su vencimiento al momento de la salida.
- [ ] Una solicitud puede agrupar varios medicamentos y cada medicamento puede asociarse a varios lotes cuando administración lo autoriza; se muestra la advertencia acordada.
- [ ] Si no hay existencias suficientes ni otro lote elegible, administración puede reducir la cantidad aprobada y el pedido actualizado se muestra a los técnicos.
- [ ] La farmacia origen asignada recibe la tarea como prioritaria y solo un técnico responsable queda asignado por sucursal participante.
- [ ] Una solicitud aprobada muestra **«Traspaso en progreso»** en la sucursal solicitante hasta la recepción.
- [ ] La sucursal puede crear una segunda solicitud mientras tiene otra en progreso.
- [ ] El despacho identifica el registro exacto del lote de origen y descuenta solo de ese registro, sin permitir cantidades negativas ni doble despacho.
- [ ] La recepción incrementa la existencia de destino una sola vez, conserva medicamento, código de lote y vencimiento originales, y deja trazabilidad al registro de origen.
- [ ] El técnico receptor puede confirmar la recepción y enviar una observación, pero no rechazar lotes ni cambiar cantidades.
- [ ] Cualquier modificación de cantidades del despacho la realiza administración, queda auditada y se refleja en el pedido de los técnicos.
- [ ] El administrador puede cancelar un traspaso aprobado que aún no fue recibido; la cancelación guarda motivo y responsable.
- [ ] Si se cancela después del despacho porque el lote no llegó, el sistema devuelve las cantidades a los mismos lotes de origen mediante movimientos compensatorios auditados.
- [ ] Cada transición aparece en auditoría con responsable y fecha.
- [ ] Las notificaciones son internas, inmediatas y persistentes en la bandeja de administración o del técnico destinatario.
- [ ] Se notifica inmediatamente a administración cuando se crea una solicitud y al único técnico de origen cuando el administrador lo asigna.
- [ ] El despacho notifica al técnico receptor y a administración; la cancelación o denegación notifica al solicitante.
- [ ] Los endpoints y respuestas no permiten a un técnico descubrir el inventario de otras farmacias.
- [ ] Todas las operaciones requieren conexión; no se crean ni procesan traspasos offline.

## 14. Decisiones confirmadas

Las siguientes decisiones ya quedan fijadas en este plan:

- **Asignación de farmacia origen:** única y exclusivamente el administrador asigna la farmacia origen al aprobar la solicitud.
- **Falta de recepción:** el administrador puede cancelar una solicitud aprobada que todavía no se recibió. Si ya se descontó el lote al despachar y no llegó a destino, el sistema devuelve las unidades al mismo registro de lote en origen mediante un movimiento compensatorio auditado.
- **Notificaciones:** son exclusivamente internas al sistema, inmediatas y persistentes en la bandeja de administración o del técnico destinatario.
- **Descuento en origen:** el despacho identifica el registro exacto del lote de origen y descuenta la cantidad de ese lote.
- **Identidad en destino:** el inventario receptor conserva medicamento, código de lote y vencimiento. Si el mismo lote ya existe en destino, se incrementa su cantidad; de lo contrario, se crea un registro local enlazado al lote de origen.
- **Solicitudes:** se basan en medicamentos con existencias insuficientes en el inventario de la sucursal solicitante y pueden agrupar varios medicamentos.
- **Despacho con varios lotes:** se permite si administración lo autoriza; el sistema muestra **«Se utilizará más de un lote para el traspaso»**.
- **Cantidad insuficiente:** se elige otro lote elegible; si no hay otro lote, administración puede reducir la cantidad aprobada y el cambio se muestra a los técnicos.
- **Vencimiento:** no se despachan lotes con menos de seis meses hasta su vencimiento.
- **Recepción:** el técnico receptor confirma y puede añadir una observación, pero no rechaza el traspaso ni cambia las cantidades. Los cambios de despacho son exclusivos de administración.
- **Responsables y prioridad:** se asigna un único técnico responsable por sucursal participante y la farmacia origen debe atender el pedido con prioridad.
- **Técnicos responsables:** el administrador elige un técnico activo de origen; el técnico solicitante confirma la recepción en destino.
- **Edición y reasignación:** antes del despacho, el administrador puede ajustar cantidades o reasignar sucursal/técnico, dejando historial y notificando a los afectados. Después del despacho, las correcciones se registran mediante movimientos compensatorios.
- **Conectividad:** todas las acciones del traspaso requieren conexión; no se procesan solicitudes ni movimientos offline.
- **Trazabilidad:** toda solicitud queda registrada, aprobada, denegada o cancelada; los registros no se eliminan.

## 15. Preguntas restantes y acuerdos para iniciar

1. **Medicamento ausente por completo del inventario propio:** para iniciar, la propuesta es que solo se puedan seleccionar medicamentos ya registrados en el inventario de la sucursal solicitante. ¿Se confirma este alcance o se necesita un catálogo municipal para productos sin registro local?
2. **Conservación:** todas las solicitudes y decisiones se registrarán y no se borrarán. ¿Existe un plazo institucional obligatorio para conservar los registros y su auditoría?

Los demás detalles se fijan para la primera versión: el técnico ingresa las unidades que necesita recibir y ve el stock local actual; el administrador elige un técnico activo de origen y el solicitante confirma la recepción; antes del despacho el administrador puede ajustar cantidades o reasignar sucursal/técnico, con historial y notificación; después del despacho las correcciones se realizan mediante movimientos compensatorios auditados. La prioridad será una bandeja destacada para atención preferente, sin plazo numérico. El periodo formal de conservación puede definirse por política institucional sin bloquear el inicio.

