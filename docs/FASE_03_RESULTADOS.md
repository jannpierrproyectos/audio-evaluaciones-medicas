# Fase 03 — Generación masiva inteligente de MP3

Fecha: 17 de octubre de 2026, America/Lima. Trabajo local, sin commit, push, deploy ni publicación de instaladores.

## Alcance y arquitectura

Se conservaron todos los cambios locales de Fases 00–02. Se implementó una cola por lote sobre el repositorio cifrado de Fase 01, sin otra base de datos ni almacenamiento clínico en localStorage, logs o archivos públicos. No se cambiaron reglas clínicas, secretos, dependencias ni lockfiles.

`planBulkAudio` prepara una estimación y clasifica cada evaluación mediante `getAudioAuthorization`, el normalizador TTS existente y el diario de operaciones del Connector. No solicita voz. La interfaz requiere una segunda acción y confirmación explícita para comenzar o continuar; rechazarla no consume TTS.

`BulkAudioRunner` procesa con concurrencia de 1 por defecto, configurable entre 1 y 3. Guarda el estado antes de despachar y tras cada resultado. Estados: pendiente, generando, completado, reutilizado, bloqueado, error, incierto y cancelado. Cada elemento registra huella, hash de evidencia de aprobación/autorización, número de intentos y fechas; no vuelve a duplicar el texto clínico en la cola. Al preparar otra cola, la anterior permanece en el historial cifrado del lote.

La aplicación vuelve a consultar contactos, comprueba el PDF administrado para MediWeb y contrasta configuración, huella y evidencia con la estimación. `generatePersistentAudio` conserva la comprobación central inmediatamente antes de invocar TTS. El seguimiento de solicitudes individuales y masivas comparte el mismo conjunto activo y las mismas reservas atómicas del Connector. Las revisiones optimistas impiden sobrescribir silenciosamente trabajo de otra ventana.

La pausa deja terminar y guardar las solicitudes iniciadas y conserva pendientes. La cancelación cancela únicamente pendientes. Tras recarga o recuperación, la cola queda pausada y exige confirmar su continuación; no funciona como un servicio en segundo plano cuando el navegador está cerrado.

## Autorización y reutilización

Se mantienen aprobación clínica explícita y versión exacta, errores bloqueantes, formato telefónico, comprobación de WhatsApp, identidad, autorización vigente, conflictos de teléfono compartido y correspondencia del PDF. Tener WhatsApp no sustituye las otras verificaciones.

Se conserva la excepción existente: un PDF manual sin destinatario declarado permite audio local individual o masivo con aprobación clínica y sin errores. Si declara destinatario, se aplican las verificaciones centrales. MediWeb mantiene sus requisitos completos y validación del archivo PDF vinculado.

La huella incluye evaluación, lote, identidad/datos operativos, versión clínica, texto final, texto normalizado, proveedor, modelo, voz y configuración. El diario y la recuperación validan pertenencia y metadatos; no se reutiliza el audio de otro trabajador ni una configuración distinta. El registro del MP3 incorpora también identificador y fecha de la aprobación que originó la síntesis. Reaprobar contenido idéntico puede reutilizar su MP3 cuando la aprobación actual y todas las verificaciones sean válidas; cambiar la evidencia después de estimar obliga a preparar otra cola.

Editar texto, saludo, datos clínicos o identidad, o revocar/vencer la autorización, invalida la disponibilidad correspondiente. Una respuesta tardía puede conservarse cifrada para conciliación, pero queda obsoleta y no se ofrece como audio vigente para WhatsApp. La interfaz masiva accede al reproductor individual mediante «Ver MP3», sin crear otra vía de exportación.

## Fallos, recuperación y protección

Se reutilizan AES-256-GCM, DPAPI CurrentUser, ACL del usuario Windows, escritura atómica, copia validada y diario del Connector. Los MP3 permanecen cifrados en el almacén. No se modificó ni eludió la protección EFS de las exportaciones administradas existentes; si EFS no está disponible, estas siguen fallando de forma cerrada.

Antes de una solicitud de voz queda una reserva durable. Una reserva ya solicitada no autoriza un segundo envío; también bloquea solicitudes para otra versión de la misma evaluación mientras exista incertidumbre. Un fallo HTTP, de transporte, de validación de respuesta o de escritura después de enviar se trata conservadoramente: no demuestra ausencia de consumo ni tiene reintento automático. El cliente limita el transporte a 180 segundos; abortar no implica cancelar la síntesis ni recuperar créditos.

Si el MP3 cifrado se escribió antes de interrumpirse la actualización del catálogo, la consulta del diario recupera sus metadatos autenticados sin sintetizar de nuevo. Un error previo a enviar permite cancelar la reserva como no enviada. Un fallo al guardar el estado de inicio impide solicitar TTS. Ante conflicto o fallo de almacenamiento, se detiene el despacho; los resultados ya guardados se recuperan del diario. Se advierte al intentar cerrar la ventana con escrituras, errores de guardado o solicitudes activas.

La recuperación compara también la huella del MP3 con el elemento interrumpido: un audio válido de otra versión no se atribuye como resultado de esa cola. Las solicitudes inciertas no pasan automáticamente a pendientes. Sin un archivo local conciliable ni evidencia del proveedor, requieren revisión operativa externa; no se añadió un botón para borrar reservas y volver a cobrar a ciegas.

## Estimación de consumo

Se cuentan caracteres del texto efectivamente preparado por el normalizador existente, excluyendo elementos bloqueados y MP3 reutilizables. La tarifa base versionada el 17/10/2026 usa 0,5 créditos/carácter para Flash/Turbo v2/v2.5 y 1 para Multilingual v2, de acuerdo con la [documentación oficial de identificadores y tarifas](https://help.elevenlabs.io/hc/en-us/articles/21811236079505-How-do-I-find-the-model-ID).

La pantalla y la confirmación indican que son créditos **base estimados**, sin precio monetario ni consulta del saldo. Los [multiplicadores de voces de la biblioteca](https://help.elevenlabs.io/hc/en-us/articles/26050485079057-What-are-custom-rates-and-credit-multipliers) pueden aumentar el cargo. Para servicios/modelos sin tarifa reconocida, se muestran caracteres y créditos no determinados, sin inventar una tarifa. La estimación conservada corresponde al lote inicialmente preparado; los estados muestran el avance real. El contrato TTS actual no expone consumo observado de la cuenta, por lo que se indica como no disponible. Revisar las tarifas antes de operar con una cuenta real o un modelo nuevo.

## Archivos de esta fase

- `src/lib/bulkAudio.js`: planificación, estimación, huellas de evidencia, ejecución y recuperación de cola.
- `src/components/BulkAudioPanel.jsx`: resumen, motivos, estimación, confirmación, progreso, controles y acceso al MP3.
- `src/App.jsx`: integración del lote, cola/historial cifrados, guardas compartidas, comprobaciones de configuración y destinatario, recuperación y aviso de cierre. La actualización de contactos aplica el resultado sobre el estado vigente para conservar completados concurrentes.
- `src/App.css`: presentación compacta de la sección masiva.
- `src/lib/evaluationPersistence.js`: metadatos de aprobación en audio, propagación de obsolescencia al reutilizar y error identificable de resultado incierto.
- `src/lib/ttsClient.js`: límite de transporte; se conserva el tratamiento incierto después de enviar.
- `test/phase-03-bulk.test.js`: 14 casos nuevos con TTS exclusivamente simulado.
- `mediweb-downloader/test/bulk-audio-store.test.js`: 2 casos nuevos de cola/historial cifrados y recuperación tras fallo de escritura.
- `scripts/phase03-functional-check.js`: Edge real con datos ficticios, Connector temporal real y voz interceptada.
- `scripts/phase02-functional-check.js`: espera acotada del cierre asíncrono de la pestaña en Edge antes de conservar la misma aserción estricta de una sola ventana de comprobación.
- `docs/FASE_03_RESULTADOS.md` y seguimiento de `docs/PLAN_AUTOMATIZACION.md`.

Los demás archivos modificados o nuevos preexistentes pertenecen a las fases anteriores y se preservaron.

## Pruebas y validaciones

- `npm.cmd test`: **214/214 pasan**, incluidas las 14 nuevas de Fase 03 y regresión de Fases 00–02.
- `npm.cmd test --prefix mediweb-downloader`: **104/104 pasan** en ejecución aislada, incluidos los 2 casos nuevos.
- `npm.cmd run lint`: pasa.
- `npm.cmd run build`: pasa, 106 módulos.
- `npm.cmd run check --prefix mediweb-downloader`: pasa, 41 archivos JavaScript comprobados.
- `git diff --check`: pasa.
- `npm.cmd run clinical:audit`: no pudo completarse; falta `auditoria-local/primeras-hojas.pdf`.
- `npm.cmd run narrative:audit`: no pudo completarse; falta `clinical-audit/audit-cases.json`.

No se fabricaron insumos de auditoría ni se incorporaron PDFs o resultados clínicos sensibles. Los dos lockfiles mantienen sus hashes SHA-256 previos: raíz `364FE34DA2AA37C0C0800475EA0B7D90B6D1D337D7D8A314555760FCCB460AF6`; Connector `13A19B7CAABA2608B02D57EB6694A2C88ABE9C98C315C0EBBCD3CBB6D2B89DC6`.

Una ejecución simultánea de varias suites produjo un fallo de temporización de la prueba antigua `pagination-ajax.test.js` y una terminación del transporte de Playwright (`Unexpected end of JSON input`). No se cambiaron ni debilitaron esas pruebas; la suite completa del Connector pasó al repetirse aislada. La primera prueba funcional de Fase 03 ya había pasado en Edge real. Las repeticiones finales se registran a continuación.

`node scripts/phase03-functional-check.js`: **pasa en Microsoft Edge headless real**, con Connector HTTP y almacén temporal AES/DPAPI reales. Se verificaron 3 autorizados/2 bloqueados, estimación sin TTS, rechazo de confirmación, pausa con una solicitud iniciada, recuperación tras recarga y reinicio del almacén, continuación confirmada, reutilización masiva e individual, edición durante síntesis y cancelación de otra cola preparada. Resultado final: **4 solicitudes simuladas, 0 reales**. Se utilizaron perfiles y archivos temporales ficticios, retirados por el propio script; no se usó el perfil personal del navegador ni datos reales.

`node scripts/phase01-functional-check.js`: **pasa**; regresión de importación manual real de un PDF ficticio, aprobación, edición durante TTS, recuperación de MP3, reutilización individual y requisitos MediWeb. Tres solicitudes simuladas, ninguna real.

`node scripts/phase02-functional-check.js`: **pasa**; regresión de recuperación de comprobaciones, popup bloqueado, duplicados, identidad/autorización explícitas, navegación, filtros, corrección telefónica e invalidación, recarga y TTS autorizado. Una solicitud simulada, ninguna real. Una ejecución anterior comprobó prematuramente el número de pestañas antes de terminar su cierre asíncrono (3 en vez de 2); se añadió una espera máxima de 5 segundos, conservando exactamente la aserción de 2 páginas (aplicación y comprobación), sin modificar los controles de WhatsApp del producto.

## Límites y aceptación operativa

Pendientes: aceptación con el Connector instalado, reinicio real de Windows, cuenta/voz/tarifa de producción, verificación institucional de identidad/consentimiento, auditorías con insumos autorizados y política de retención. La aprobación y las declaraciones del operador conservan las limitaciones de autenticación/auditoría de Fases 00–02. No se probó la facturación real de ElevenLabs ni se afirma que un error evite cargos.

Para verificar manualmente, usar datos ficticios y un servicio TTS simulado: importar PDF manual y MediWeb; comprobar registros sin aprobación o destinatario incompleto; preparar la estimación y rechazar/aceptar confirmación; pausar y cancelar con una solicitud iniciada; recargar y recuperar; continuar; repetir el lote y confirmar reutilización; editar, cambiar identidad o revocar consentimiento durante una solicitud y comprobar obsolescencia y bloqueo de WhatsApp. Validar también un fallo de guardado y recuperación sin repetir solicitudes inciertas.

No se implementaron Fase 04, n8n, envío automático por WhatsApp ni generación desatendida al cerrar el navegador. No se consumieron créditos reales durante las pruebas: las solicitudes de voz fueron dobles de prueba o rutas interceptadas con bytes sintéticos identificados como MP3; no equivalen a una validación de calidad acústica ni de contenido clínico real.
