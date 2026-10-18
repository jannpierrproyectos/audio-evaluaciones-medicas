# Fase 04 — Procesamiento integrado MediWeb

Fecha de cierre: 18 de octubre de 2026, America/Lima. Implementación local sobre los cambios no publicados de Fases 00–03. Sin commit, push, deploy ni publicación de instaladores.

## Estado y alcance

Implementado el flujo **Iniciar procesamiento completo**: sesión y búsqueda comprobadas → Connector existente en modo `both` → descarga y paginación → extracción con el parser existente → narrativas iniciales → recuperación conservadora del estado cifrado → presentación para revisión clínica, verificación rápida y generación masiva autorizada.

No se creó un segundo downloader ni otro motor clínico. La acción integrada usa `DownloaderRunner`, `JobManager`, `analyzePdfBatch`, el motor narrativo existente y `EvaluationRepository`. No aprueba trabajadores ni solicita TTS automáticamente. Se mantienen carga manual, edición narrativa, generación individual, verificación rápida y cola masiva. El recorrido anterior de descarga por pasos permanece en un desplegable para evitar controles principales redundantes.

## Qué funciona autónomamente

Con Connector actualizado, sesión vigente y una búsqueda guardada reconocible, la acción integrada vuelve a la dirección de búsqueda confirmada cuando procede, aplica los filtros, espera una respuesta de búsqueda real y comprueba formulario, valores y resultados. Descarga primeras hojas y PDF completos con la elegibilidad y deduplicación actuales, pagina, guarda progreso e importa automáticamente el consolidado.

Las narrativas candidatas se generan y persisten usando el mismo procedimiento de previsualización existente: se evalúa una copia candidata, sin modificar `reviewed_by_user`, `needs_review` ni la aprobación guardada. Los errores clínicos continúan bloqueando el audio. Las versiones exactas persistidas recuperan texto editado, verificaciones, autorizaciones y aprobaciones; la recuperación de MP3 consulta su huella y configuración sin sintetizar de nuevo.

El panel muestra conexión, autenticación observable, búsqueda elegida, página, detectadas, procesadas, primeras hojas, completos e incidencias; indica preparación/extracción y muestra los pendientes de revisión/WhatsApp y audios disponibles/pendientes del lote visible. Ofrece acceso a las funciones existentes de Fases 02–03 y recuperación de procesos anteriores. No simula porcentajes de extracción ni atribuye autenticación por tener el navegador abierto.

## Qué requiere intervención humana

- Inicio o renovación de sesión, MFA/CAPTCHA y navegación cuando no se reconoce la página.
- Preparación manual y confirmación de resultados cuando no existe un perfil compatible.
- Confirmación inicial de filtros y resultados antes de guardarlos o usar la búsqueda manual. Esa confirmación queda vinculada a una huella de la tabla y los controles; un cambio posterior obliga a confirmar de nuevo.
- Revisión de errores de identidad, documentos incompletos, atenciones ambiguas, resultados parciales, procesos inciertos y búsquedas solapadas.
- Aprobación clínica explícita, verificación de WhatsApp, identidad, consentimiento vigente y correspondencia del PDF; confirmación del consumo antes de cualquier TTS real por el flujo de Fase 03.

Abrir MediWeb o un chat no acredita autenticación, identidad, cuenta existente, autorización ni entrega. La acción integrada termina antes de la aprobación y generación pagada.

## Búsquedas y seguridad del navegador

`searchProfile.js` inspecciona el DOM de la página real del Connector. Solo permite automatizar formularios inequívocos del origen MediWeb conocido, en rutas reconocibles de búsqueda, sin query en la acción, con botón Buscar/Consultar y controles visibles `date` o `select-one` etiquetados como empresa, tipo de examen o fechas inicial/final. No inventa selectores institucionales. Guarda identificadores y estructura observados y confirmados por el operador.

Contraseñas, campos ocultos, entradas de pacientes/DNI, controles desconocidos o estructuras ambiguas impiden guardar/reaplicar automáticamente el formulario. No se persisten credenciales ni tokens de autenticación. El navegador conserva la sesión autorizada existente. El perfil solo contiene filtros operativos dentro del catálogo cifrado.

Al reaplicar se valida la estructura, se exige una respuesta de búsqueda HTTP satisfactoria y se comprueban empresa, tipo de examen y rango de fechas de las filas cuando el filtro es restrictivo. Esa comprobación se repite al paginar. La huella incluye identificador de atención, paciente, fecha, empresa, examen y aptitud visibles; cambiar un paciente manteniendo el mismo identificador también invalida la confirmación.

Una interfaz nueva, un formulario incompatible, resultados inesperados, ausencia de resultados o sesión expirada detienen el automatismo. La alternativa manual utiliza el mismo flujo de descarga y parser tras confirmar la tabla; no elude autenticación ni automatiza acciones de edición o entrega en MediWeb.

## Persistencia, consistencia y recuperación

El catálogo AES-256-GCM/DPAPI CurrentUser de Fase 01 añade un espacio servidor `processing` con perfiles, confirmación de búsqueda, reservas, checkpoints y referencias a lotes. No cambia la versión criptográfica ni borra los catálogos previos. Los checkpoints y rutas internas no se aceptan desde React ni se exponen en el resumen público.

Se reserva un identificador durable antes de crear el job. La exclusión del servicio y `JobManager` evitan trabajos duplicados por clics repetidos; una respuesta perdida se recupera consultando estado. Se registran contadores y manifest/rutas del mismo motor, sin otro diario en claro. Un fallo temporal de checkpoint cancela el despacho y queda como resultado incierto cuando se recupera el almacenamiento.

Tras reiniciar el Connector, un trabajo que figuraba en ejecución sin job vivo queda **incierto**, nunca se relanza automáticamente. Los trabajos terminales recuperan sus referencias desde el catálogo. Se pueden importar los resultados correctos de trabajos fallidos/cancelados/inciertos con primeras hojas existentes, preservando las incidencias y sin repetir descargas. Las reservas sin resultados seguros requieren conciliación humana. Mientras exista un proceso incierto, se bloquean nuevas descargas automáticas; recuperar un lote parcial no demuestra que las demás solicitudes fueran inocuas.

Si falla la extracción o la asociación final del lote, se conserva la incidencia y se exige una recuperación explícita para releer los PDF ya guardados. No se ejecuta un bucle de importación que pueda interferir con otro lote. Recuperar un lote inexistente no se presenta como éxito.

Repetir una búsqueda con la misma huella recupera el proceso anterior. Una búsqueda diferente que se solapa con atenciones registradas se bloquea, también si el solapamiento aparece en páginas posteriores. Se pide recuperar esos resultados o preparar un intervalo no procesado; no se asume que volver a descargar sea seguro ni que el contenido remoto sea inmutable.

Las carpetas de salida incorporan un sufijo aleatorio para evitar colisiones de trabajos del mismo segundo. PDF completos, consolidado y controles se escriben mediante temporal sincronizado y renombrado atómico. Los archivos correctos previos no se sobrescriben por una escritura parcial posterior. Tras una caída se utiliza el último checkpoint confirmado; archivos adicionales todavía no conciliados requieren revisión, no un reintento ciego.

Si la importación identifica evaluaciones ya existentes, se conservan sus identificadores y lotes originales. Cuando pertenecen a varios lotes, el proceso mantiene referencias a todos y ofrece acceso a cada uno, sin clonar aprobaciones ni reasignar MP3. La vista muestra un lote a la vez; los contadores de descarga y los del lote visible son distintos.

Para la misma evaluación con contenido clínico idéntico, cambiar el teléfono o completar una referencia de PDF ausente actualiza los datos operativos, revoca la evidencia anterior de destinatario y marca el audio obsoleto, conservando únicamente la aprobación clínica que todavía corresponda al contenido exacto. Cambiar identidad o contenido clínico no restaura silenciosamente una aprobación; los conflictos existentes del repositorio siguen deteniendo la importación.

## PDF, identidad y protección en reposo

La asociación cruza documento y página cuando están disponibles, no reutiliza una misma atención y detecta páginas/documentos duplicados o contradictorios. No se habilita el identificador del PDF completo ante discrepancia de identidad. El respaldo por página sin documento conserva trazabilidad, pero exige revisión y no permite TTS MediWeb. Las incidencias son visibles junto al texto y audio.

El nuevo procesamiento exige ACL y EFS para todas sus carpetas de salida, control, temporal, consolidado y reportes, **antes de escribir datos clínicos**. Si EFS no está disponible, falla de forma cerrada. El catálogo y los MP3 mantienen el cifrado existente. Los mecanismos previos de exportación se conservan. No se afirma que los PDF heredados de descargas anteriores hayan sido cifrados retroactivamente.

El servidor sigue exclusivamente en localhost; `/processing` exige POST, Origin permitido y acciones/campos acotados. Rechaza rutas, credenciales y checkpoints suministrados por el cliente. Conserva CORS exacto y `Cache-Control: no-store`. Se retiró el identificador de atención del mensaje de progreso del runner; no se añadieron logs clínicos, almacenamiento en localStorage ni secretos en React/Vite.

## Archivos de Fase 04

Nuevos:

- `mediweb-downloader/src/searchProfile.js`: reconocimiento, confirmación y reaplicación conservadora de búsquedas.
- `mediweb-downloader/src/processingFlow.js`: coordinación del job existente, cifrado, idempotencia, checkpoints, recuperación y vínculo con lotes.
- `src/components/IntegratedProcessing.jsx`: vista principal integrada, perfiles, confirmación, progreso, cancelación y recuperación.
- `test/phase-04-integration.test.js`: 6 pruebas de asociación, errores de identidad y narrativas sin aprobación.
- `mediweb-downloader/test/processing-flow.test.js`: 10 pruebas con navegador y MediWeb ficticio.
- `mediweb-downloader/test/processing-http.test.js`: 2 pruebas de límites HTTP y recuperación de lotes/invalidación de destinatario.
- `scripts/phase04-functional-check.js`: recorrido funcional en Edge real.
- `docs/FASE_04_RESULTADOS.md`.

Modificados en esta fase:

- `mediweb-downloader/src/evaluationStore.js`, `src/http/app.js`, `src/http/jobManager.js`, `src/http/routes.js`, `src/runner.js`, `src/paths.js` y `src/manifest.js`: estado cifrado aditivo, API, hooks sobre el job, parcial/reinicio, seguridad de salida y escritura atómica. Las rutas `src/...` de esta línea pertenecen al Connector.
- `src/App.jsx`, `src/components/MediwebImporter.jsx`, `src/components/PdfWorkersPreview.jsx`: integración, recuperación y exposición de incidencias.
- `src/lib/importMediwebPdf.js`, `src/lib/workerReviewUx.js`, `src/lib/evaluationPersistence.js`, `src/services/mediwebService.js`: asociación segura, candidatas persistibles, recuperación de audio y comunicación local. Un registro sin audio previo ya no se presenta como si tuviera un audio editado obsoleto.
- `scripts/phase01-functional-check.js`: selector específico de autorización de destinatario ante la nueva casilla de confirmación de búsqueda; no se debilita la comprobación.
- `docs/PLAN_AUTOMATIZACION.md`: seguimiento de la fase.

Se preservaron los demás cambios locales preexistentes. No se modificaron dependencias, lockfiles, `.env`, credenciales, reglas ni umbrales clínicos.

## Pruebas y evidencia

- `npm.cmd test`: **220/220 pasan**, con regresión de Fases 00–03 y 6 nuevas de Fase 04.
- `npm.cmd test --prefix mediweb-downloader`: **116/116 pasan**, con 12 nuevas pruebas de Fase 04.
- `npm.cmd run lint`: pasa.
- `npm.cmd run build`: pasa, 107 módulos.
- `npm.cmd run check --prefix mediweb-downloader`: pasa, 43 archivos.
- `git diff --check`: pasa.
- `npm.cmd run clinical:audit`: no puede completarse; falta `auditoria-local/primeras-hojas.pdf`.
- `npm.cmd run narrative:audit`: no puede completarse; falta `clinical-audit/audit-cases.json`.

No se fabricaron insumos clínicos de auditoría ni se agregaron documentos sensibles. Hashes SHA-256 de lockfiles sin cambios: raíz `364FE34DA2AA37C0C0800475EA0B7D90B6D1D337D7D8A314555760FCCB460AF6`; Connector `13A19B7CAABA2608B02D57EB6694A2C88ABE9C98C315C0EBBCD3CBB6D2B89DC6`.

La prueba funcional de Fase 04 se ejecutó realmente en **Microsoft Edge headless**, con `DownloaderRunner`, paginación, impresión PDF, parser, React/Vite, HTTP del Connector y catálogo AES/DPAPI reales. MediWeb, WhatsApp y TTS fueron interceptados con datos ficticios. Se descargaron 2 reportes ficticios atravesando 2 páginas con una atención repetida, se generaron y vincularon 2 evaluaciones sin aprobación ni TTS, se aprobó y autorizó explícitamente un destinatario, y se realizó 1 solicitud de voz simulada. Tras recarga y reapertura del almacén se recuperaron aprobación, destinatario y MP3; la cola masiva lo reconoció reutilizable.

También pasan las regresiones funcionales en Edge de `scripts/phase03-functional-check.js` (4 solicitudes simuladas: preflight, confirmación, pausa, reinicio, reutilización, edición en carrera y cancelación) y `scripts/phase01-functional-check.js` (3 simuladas: importación manual, aprobación, requisitos MediWeb, revocación, recuperación y edición durante TTS). Ninguna realizó solicitudes reales de voz.

`scripts/phase02-functional-check.js` también pasa: navegación, filtros, detección de duplicados, popup bloqueado, recuperación de comprobaciones, corrección telefónica e invalidación y bloqueo de TTS hasta autorización explícita; 1 solicitud simulada y ninguna real.

En la ejecución final de `scripts/phase04-functional-check.js` se inyectó además una respuesta PDF inválida en la primera lectura del consolidado. La aplicación detuvo esa importación y la recuperación explícita volvió a leer el PDF correcto del Connector. El número de descargas permaneció en **2**, sin aprobación automática ni TTS adicional. La prueba completa finalizó con **1 solicitud TTS simulada y 0 reales**.

**EFS fue simulado únicamente por inyección en ese fixture temporal ficticio**; no se desactivó su exigencia en producción. La prueba de denegación comprueba el bloqueo antes de descargar/escribir resultados. La primera ejecución funcional detectó que el PDF sintético no incluía el marcador de aptitud reconocido por el parser y lo bloqueó; se corrigió el fixture, sin modificar el parser ni las reglas médicas.

Los scripts funcionales eliminan solo sus perfiles y directorios temporales ficticios. No utilizan la sesión institucional ni el perfil personal de Edge. No se realizaron cambios, entregas ni consultas de pacientes reales en MediWeb. **Cero solicitudes reales a ElevenLabs y cero créditos reales consumidos en las pruebas.** Los bytes MP3 sintéticos prueban transporte/persistencia, no calidad acústica.

## Limitaciones y aceptación pendiente

1. Falta aceptación autorizada contra el formulario, navegación, resultados y caducidad reales de MediWeb. Un formulario con otros nombres, campos libres, iframes o búsqueda AJAX en otra ruta se deriva al modo manual. No se inventó compatibilidad con una estructura institucional que no estaba disponible.
2. Falta probar un instalador actualizado, EFS disponible y ACL en la ubicación instalada, reinicio real de Windows y recuperación tras corte real del proceso/equipo. La prueba reabrió el almacén desde disco y recargó Edge; no equivale a reiniciar Windows ni validar EFS positivo real.
3. Una huella de la primera tabla y filtros idénticos recupera el proceso histórico. No se promete descubrir cambios remotos ocultos en páginas posteriores si la primera tabla permanece idéntica. Para atenciones nuevas debe prepararse una búsqueda acotada no procesada; las búsquedas solapadas requieren revisión.
4. La recuperación de resultados inciertos se limita a archivos y checkpoints conocidos, sin reejecutar descargas. La conciliación de archivos no registrados o respuestas sin evidencia suficiente queda a cargo del operador/soporte; no se añadió una acción para borrar reservas a ciegas.
5. Se mantienen las limitaciones institucionales de identidad/consentimiento, autenticación del aprobador, vigencia, retención y respaldos bajo el mismo usuario Windows de las fases anteriores. La tarifa, voz y facturación reales de ElevenLabs no se probaron.
6. Las auditorías clínicas siguen pendientes de los dos insumos autorizados indicados.

Para aceptación manual: preparar un lote ficticio en MediWeb autorizado, confirmar/guardar filtros, iniciar el flujo, comprobar contadores y asociaciones, forzar expiración y cancelación parcial, recargar/reiniciar Connector y recuperar sin redescargar. Verificar que cambios de identidad/teléfono/PDF bloquean la entrega, que importar no aprueba, que un audio aprobado y vigente se reutiliza y que cualquier síntesis nueva requiere los controles y confirmaciones de Fase 03. Repetir con datos reales solo bajo autorización institucional.

No se implementaron Fase 05, programación diaria, n8n ni envío automático por WhatsApp. Para revertir código, revisar el diff y retirar solo cambios de Fase 04 preservando Fases 00–03 y el trabajo del usuario; no eliminar el catálogo, claves DPAPI ni archivos persistidos.
