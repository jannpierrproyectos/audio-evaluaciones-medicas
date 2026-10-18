# Fase 05 — Bandeja de entregas WhatsApp manual asistida

Fecha: 18 de octubre de 2026, America/Lima. Trabajo local sobre las Fases 00–04 y sus cambios no publicados. Sin commit, push, deploy, publicación de instaladores ni cambios de secretos, dependencias o lockfiles.

## Estado

Implementada la bandeja central de entregas, integrada con el Connector y su persistencia cifrada. Permite preparar y recorrer evaluaciones de todos los lotes guardados, retomar confirmaciones parciales y conciliar resultados inciertos. Las acciones de comunicación y las declaraciones de envío siguen siendo humanas. No consulta cuentas de WhatsApp, no automatiza envíos y no solicita TTS.

Validación local con pruebas automáticas y Microsoft Edge real en modo headless, datos ficticios, HTTP del Connector y almacenamiento AES-GCM/DPAPI reales. WhatsApp, EFS y el revelado en Explorer se simularon explícitamente en el escenario funcional. La aceptación en el Windows instalado con EFS y documentos institucionales autorizados sigue pendiente.

## Arquitectura

- `DeliveryInbox` se abre desde **Abrir bandeja de entregas**, después de vaciar la cola de guardado del lote activo. Consulta todos los lotes del mismo usuario Windows mediante `POST /deliveries`. Dispone de filtros pendientes, listos, enviados, incidencias y todos; lista consecutiva, un trabajador seleccionado, contadores, navegación y acceso a corregir la evaluación original.
- `DeliveryService` incorpora el diario `deliveries` al catálogo cifrado de `EvaluationStore`, usando su exclusión mutua y escritura/recuperación existentes. No crea otra base, sistema de archivos ni almacenamiento en localStorage. Los guardados antiguos de un lote no sobrescriben las confirmaciones de entrega.
- Se comparten las funciones puras existentes de versión, aprobación, destinatario, teléfonos, mensaje institucional, nombres y saludo entre React y Connector. Se conservan las firmas y la serialización de huellas anteriores. Antes de cada preparación o acción, React vuelve a ejecutar `getAudioAuthorization`, con el motor clínico existente; el Connector comprueba nuevamente aprobación exacta, identidad, autorización vigente, conflictos de teléfono y vínculo de archivos. No se duplican reglas médicas ni se modifican umbrales.
- La entrega tiene UUID estable, referencia de lote/evaluación/atención, huella de versión, referencias administradas y SHA-256 de PDF/MP3, mensaje institucional, estados, fechas y acciones. No se inventa identidad de operador: las confirmaciones se registran como `declaracion_operador`, sin presentarlas como evidencia del servidor de WhatsApp.

## Preparación y archivos

Al seleccionar una evaluación elegible se prepara automáticamente una vez por versión. Se exige aprobación del texto exacto con su saludo, WhatsApp comprobado, identidad, consentimiento vigente, correspondencia de PDF y MP3 listo en el diario cifrado. La excepción de TTS local para PDF manual se conserva en el panel de audio; no elimina los controles de destinatario necesarios para una entrega.

El PDF completo se resuelve por su identificador administrado existente. Se comprueban permisos de lectura, protección EFS, firma PDF, huella de bytes y documento/fecha de evaluación; se exige ficha coincidente cuando la evaluación la tiene. Documentos de identidad mezclados o fechas de evaluación incompatibles bloquean la preparación. No se descarga nuevamente un PDF ausente desde MediWeb a ciegas: se indica la incidencia y se vuelve al flujo de descarga/asociación existente.

El MP3 se recupera de la operación cifrada existente; se comprueban evaluación, identidad, texto final, huella, voz/modelo/configuración y autenticación del binario. Se reutiliza `saveMp3` y su directorio administrado, protegido antes de escribir por ACL/EFS. El nombre de exportación contiene un UUID de entrega, sin nombre ni DNI. No se vuelve a sintetizar audio. El PDF conserva su ubicación administrada y se protege allí; no se crea una copia temporal del PDF.

La preparación fija los hashes de ambos archivos. Cada apertura, copia, revelado y confirmación vuelve a verificar vigencia y archivos. Una sustitución silenciosa no cambia la entrega preparada. Si cambia el PDF, preparar otra versión exige una nueva aprobación clínica explícita y una nueva confirmación de destinatario/PDF. Las copias de MP3 anteriores no se ofrecen como vigentes.

No se aceptan rutas arbitrarias del frontend. La API permite acciones y campos enumerados, exige Origin permitido, no almacena respuestas en caché y devuelve errores sanitizados sin rutas privadas. El servicio sigue escuchando solo en `127.0.0.1`. Si no puede comprobarse EFS o el permiso de lectura, la operación se bloquea; no se añade una exportación alternativa sin protección.

## Acciones humanas y estados

1. **Abrir WhatsApp** reserva/reutiliza una ventana cuando Edge lo permite y navega a una URL que contiene solo el teléfono normalizado. No incluye DNI, mensaje ni contenido clínico. Si el navegador impide reutilizarla sin conservar `opener`, se reemplaza de forma segura; si bloquea la apertura se informa al operador.
2. **Copiar mensaje** escribe el mensaje institucional en el portapapeles únicamente con el clic del operador. **Mostrar PDF/MP3** solicita al Connector revelar el archivo comprobado en Explorer. Estas acciones no significan que se haya enviado nada.
3. El operador adjunta y envía manualmente en WhatsApp, y confirma por separado mensaje, PDF y MP3. Las confirmaciones parciales se guardan inmediatamente. Después de recargar se exige abrir de nuevo la conversación antes de preparar otros elementos desde esa sesión.
4. **Confirmar y siguiente** exige las tres declaraciones y una última validación. Solo entonces registra `completada` y avanza al siguiente registro elegible. No hay cierre automático al abrir, copiar, revelar ni confirmar el tercer elemento.

Estados internos independientes: ausencia de preparación, `preparando`, `listo`, `invalidada`, `cancelada`, `incierta` y `completada`; conversación y acciones preparatorias son eventos, y cada elemento tiene su propia confirmación con fecha. Los motivos clínicos, de destinatario y archivo se muestran como bloqueos/incidencias.

Antes de un efecto externo se guarda una intención durable. Una respuesta perdida o un cierre con intención pendiente se presenta como incierto y bloquea repetir acciones. La conciliación exige motivo, declaración explícita y resultado de los tres elementos; cualquier duda conserva el bloqueo y las confirmaciones previas no se pueden borrar. Declarar comprobado que nada se envió permite reanudar sin fabricar confirmaciones. No se automatiza una supuesta comprobación remota.

La preparación puede pausarse/cancelarse y reanudarse sin abrir chats ni enviar información. Si ya está escribiendo archivos, la cancelación espera el cierre seguro de esa operación; conserva los archivos protegidos. Los clics simultáneos comparten la preparación y no duplican exportaciones. Una entrega completada requiere reapertura deliberada, motivo y confirmación antes de repetirla.

Para conservar la prevención de duplicados, no se permite eliminar un lote que tenga acciones de entrega registradas, incertidumbre o confirmaciones. La interfaz explica el motivo. Los lotes sin acciones externas continúan siendo eliminables y sus preparaciones se retiran junto con las referencias; se evita dejar entregas huérfanas. No se añadió purga de historial ni una política institucional de retención ficticia.

## Archivos de Fase 05

Nuevos:

- `src/components/DeliveryInbox.jsx`, `src/lib/deliveryUx.js`: bandeja, navegación, acciones explícitas y prevalidación central.
- `mediweb-downloader/src/deliveryService.js`: preparación, diario, asociaciones, huellas, confirmaciones, reapertura y conciliación.
- `mediweb-downloader/src/authorizationPolicy.js`, `recipientReview.js`, `whatsappContent.js`, `personNames.js`, `narrativeGreeting.js`: funciones puras compartidas extraídas del código existente.
- `test/phase-05-delivery.test.js`, `mediweb-downloader/test/delivery-service.test.js`, `mediweb-downloader/test-support/deliveryFixture.js`, `scripts/phase05-functional-check.js`: pruebas y entorno ficticio desechable.
- Este informe.

Modificados en esta fase:

- `src/App.jsx`, `src/App.css`, `src/services/mediwebService.js`: acceso a bandeja, integración, estilos y API.
- `src/lib/clinicalApproval.js`, `recipientIdentity.js`, `recipientPolicy.js`, `whatsappReview.js`, `whatsappMessage.js`, `narrativeGreeting.js`, `evaluationPersistence.js`: reutilización de las funciones compartidas y reserva de popup; se conservan las APIs anteriores.
- `src/clinical/dictionaries.js`, `normalizeClinicalData.js`: usan las mismas funciones de nombres/placeholders extraídas, sin cambios de reglas clínicas; golden tests conservados.
- `mediweb-downloader/src/evaluationStore.js`, `http/app.js`, `managedFiles.js`, `service.js`, `phoneExtractor.js`: diario cifrado, API restringida, inspección/revelado de archivos protegidos y comprobación operativa de identidad/fecha/ficha.

Los demás cambios locales de Fases 00–04 se preservaron. El empaquetado existente copia `mediweb-downloader/src`, por lo que los módulos compartidos no requieren dependencias nativas ni otro instalador. No se construyó ni publicó un instalador.

## Pruebas

Resultados del cierre local:

| Comando | Resultado |
| --- | --- |
| `npm.cmd test` | 222/222 pasan |
| `npm.cmd test` en `mediweb-downloader` | 136/136 pasan |
| `npm.cmd run lint` | Pasa |
| `npm.cmd run build` | Pasa; 114 módulos |
| `npm.cmd run check` en `mediweb-downloader` | Pasa; 49 archivos |
| `git diff --check` | Sin errores |
| `node scripts/phase05-functional-check.js` | Pasa en Edge real headless; cero solicitudes TTS |
| `node scripts/phase01-functional-check.js` | Pasa; regresión Fases 00–01, tres TTS simulados |
| `node scripts/phase02-functional-check.js` | Pasa; un TTS simulado |
| `node scripts/phase03-functional-check.js` | Pasa; cuatro TTS simulados |
| `node scripts/phase04-functional-check.js` | Pasa; dos reportes y un TTS simulados |
| `npm.cmd run clinical:audit` | No completa: falta `auditoria-local/primeras-hojas.pdf` |
| `npm.cmd run narrative:audit` | No completa: falta `clinical-audit/audit-cases.json` |

Fase 05 añade 22 casos automatizados: dos de aplicación y 20 del Connector. Cubren asociación y ambigüedad de documentos, MP3 de otra identidad, archivos ausentes/alterados, duplicados, reapertura, confirmaciones parciales, reinicio, cambios de identidad/teléfono/texto, revocación/vencimiento, intención pendiente, conciliación contradictoria, pausa/reanudación y preparación interrumpida tras exportar, cifrado, denegación de EFS, configuración de voz, filtros, navegación, origen HTTP/rutas y conservación del historial al eliminar lotes. Las suites completas mantienen las regresiones de Fases 00–04 y los golden clínicos/narrativos.

La prueba funcional de Fase 05 ejercita React, API local, parser PDF y catálogo/MP3 cifrados reales: preparación automática, chat ficticio con URL solo telefónica, portapapeles por acción explícita, revelado simulado, dos confirmaciones parciales, reinicio/reapertura del almacén, recarga, tercera confirmación y cierre/avance. Interrumpe una respuesta después de guardar intención y comprueba bloqueo incierto tras recarga, conciliación humana y reanudación sin confirmaciones inventadas.

**No hubo envíos reales a WhatsApp ni consumo de créditos reales.** Las rutas de proveedores de voz y WhatsApp se interceptaron en los escenarios funcionales. Los MP3 sintéticos prueban transporte, asociación y persistencia; no acreditan calidad acústica ni reproducción de voz clínica real. Las pruebas muestran advertencias de fuentes estándar de PDF.js en los PDF sintéticos; la extracción y las aserciones pasan.

Durante el desarrollo se corrigieron una ruta relativa del auxiliar de pruebas y una aserción que suponía que regenerar un PDF idéntico cambiaba sus bytes; ahora la prueba altera bytes explícitamente. La prueba Edge espera la petición real de navegación del popup, en lugar de suponer que termina en 500 ms. Los resultados de la tabla corresponden a ejecuciones posteriores a esas correcciones.

Las auditorías requieren insumos autorizados: primero el PDF fuente para `clinical:audit`, que produce `clinical-audit/audit-cases.json`; después `narrative:audit`. No se fabricaron datos para sustituirlos ni se incorporaron archivos sensibles al repositorio.

## Limitaciones y aceptación pendiente

1. Validar en el Windows instalado con el mismo usuario, soporte EFS real y permisos institucionales. En esta máquina no se acreditó EFS operativo; el fixture sustituye solo EFS/Explorer para sus archivos ficticios. Producción conserva el bloqueo obligatorio. La apertura real de Explorer y el uso manual de adjuntos en WhatsApp no se presentan como probados.
2. Aceptar documentos reales autorizados de MediWeb: etiquetas de documento, fecha y ficha deben poder reconocerse inequívocamente. Un documento escaneado, etiquetas desconocidas o identidades ambiguas bloquean la preparación y requieren corregir la asociación mediante los flujos existentes. No se añadió OCR ni una descarga institucional silenciosa.
3. El operador sigue siendo responsable de revisar el chat y los adjuntos antes de enviarlos. Las huellas se comprueban antes de revelar y confirmar, pero la aplicación no controla acciones realizadas directamente en Explorer/WhatsApp ni puede retirar información ya enviada o impedir toda modificación externa después de revelar un archivo.
4. No existe autenticación fiable del operador ni recibo oficial de WhatsApp. Las fechas son del equipo local. La institución debe definir responsables, vigencias, respaldo y retención. Los archivos de exportación son salidas administradas protegidas y reutilizables, no temporales sin control; no se afirma borrado físico seguro ni se introduce limpieza indiscriminada.
5. La persistencia queda ligada al usuario Windows/DPAPI existente. Se probó reapertura real del almacén y recarga del navegador; no reinicio completo del sistema operativo, instalación/actualización del paquete ni migración entre usuarios/equipos.
6. Completar las dos auditorías y el piloto institucional antes de uso clínico. No se implementaron Fase 06, programación, n8n, automatizaciones no oficiales ni envíos automáticos.

Aceptación manual sugerida con datos ficticios: recuperar dos lotes; comprobar filtros; preparar un registro autorizado y uno bloqueado; abrir el chat, copiar y mostrar cada adjunto; verificar que nada se confirma por estas acciones; declarar solo dos envíos, cerrar/reabrir y comprobar la conservación; completar el tercero y confirmar el avance; intentar repetir sin motivo; cambiar teléfono, autorización, texto o bytes del PDF/MP3 y comprobar el bloqueo; simular una respuesta perdida y conciliar; negar EFS y comprobar que no se crea/exporta una copia sin protección. Mantener TTS simulado y no realizar entregas reales durante esta aceptación.
