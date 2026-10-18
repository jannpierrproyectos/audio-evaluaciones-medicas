# Fase 00 — Resultado local y validación técnica

Fecha: 17 de octubre de 2026. Sin commit, push ni deploy.

Estado: lista para iniciar validación funcional controlada en navegador con datos ficticios y TTS simulado. La validación clínica con PDFs autorizados y la aceptación funcional siguen pendientes. Esto no habilita uso clínico, distribución real ni Fase 01.

## Trabajo conservado y correcciones de validación

Se conservaron la importación manual y MediWeb, la edición narrativa, el TTS individual y todos los cambios anteriores. No se cambiaron reglas ni umbrales clínicos, Connector, backend, secretos, configuración persistente de npm o persistencia de la aplicación.

La importación queda sin aprobación humana. La aprobación explícita se vincula al texto y a una versión exacta de los datos clínicos en memoria; editar campos clínicos, narrativa o saludo la invalida. El permiso TTS se comprueba en getAudioAuthorization y nuevamente en requestApprovedAudio antes de llamar al proveedor. MediWeb exige comprobación de WhatsApp y confirmación independiente de identidad, autorización y correspondencia del PDF completo.

Durante esta revisión se corrigieron defectos del alcance existente:

- El motor devuelve texto vacío mientras falta revisión humana. La vista ahora muestra el borrador candidato mediante una copia temporal revisada; el trabajador almacenado sigue sin aprobar y TTS sigue bloqueado. No se modificó el motor clínico.
- La edición durante la primera generación conserva el estado generando.
- La respuesta TTS se contrasta con la aprobación y autorización del destinatario que originaron la solicitud, además del texto y los datos actuales. Cambiar destinatario o revocar y volver a confirmar no convierte la respuesta anterior en vigente.
- Se corrigieron tildes dañadas en las etiquetas añadidas en Fase 00.

Archivos corregidos en esta continuación: src/components/PdfWorkersPreview.jsx, src/lib/clinicalApproval.js, test/phase-00-approval.test.js y este informe. Se mantienen los cambios previos de src/App.jsx, src/lib/workerReviewUx.js, src/lib/whatsappMessage.js, test/ux-hotfix.test.js y el seguimiento del plan.

## Diagnóstico e instalación de dependencias

- Node v24.21.0; npm 12.0.2. Registry: https://registry.npmjs.org/. Offline: false. Proxy y https-proxy: null. No se imprimieron tokens ni se leyeron secretos.
- Caché configurada: C:\Users\jannp\AppData\Local\npm-cache.
- npm ping --fetch-retries=0 --fetch-timeout=15000 falló con EACCES dentro del entorno restringido. También se denegó la escritura de logs fuera del workspace. Ese fallo no demuestra una caída del registro.
- La caché tenía otras versiones de zod, pero el intento offline anterior había fallado por ausencia de la versión exacta requerida (4.3.6). No era posible reconstruir todo el lockfile exclusivamente desde esa caché.
- El intento anterior tuvo instalaciones solapadas y un aviso EPERM al limpiar node_modules. No se atribuye a antivirus: no hay evidencia que lo confirme. La consulta de detalles de procesos mediante Get-CimInstance también estaba restringida; no se detuvo ningún proceso ajeno ni se deshabilitaron protecciones.
- Una única instalación con acceso ampliado completó correctamente: npm.cmd ci --ignore-scripts --fetch-retries=0 --fetch-timeout=30000 --no-audit --no-fund. Resultado: 157 paquetes instalados, código 0. Se autorizó la reconstrucción de node_modules incompleto, directorio de dependencias generado; no se borraron manualmente archivos del proyecto ni se limpió la caché.
- npm.cmd ls --depth=0 terminó con código 0, incluyendo semver, eslint y vite. Build confirmó que las dependencias instaladas permiten compilar. Se omitieron scripts de instalación, no los scripts de prueba/build del proyecto.
- npm.cmd cache verify dentro del entorno restringido falló con EPERM al intentar mantenimiento de la caché externa. No se forzó su limpieza. Esta verificación global no está completada; no impidió instalar ni validar el proyecto. No hay evidencia suficiente para diagnosticar corrupción o bloqueo persistente de archivos.
- package-lock.json se conservó: SHA256 antes y después = 364FE34DA2AA37C0C0800475EA0B7D90B6D1D337D7D8A314555760FCCB460AF6.

## Resultados verificables

Comandos ejecutados desde la raíz con npm.cmd, sin cambiar la política de ejecución de PowerShell:

| Comando | Resultado |
|---|---|
| npm.cmd test | 174 pruebas, 174 pasan, 0 fallan; código 0 |
| npm.cmd run lint | Sin errores; código 0 |
| npm.cmd run build | Vite v8.0.8, 99 módulos, compilación correcta; código 0 |
| node --test --test-isolation=none test/phase-00-approval.test.js test/ux-hotfix.test.js test/whatsapp-flow.test.js | 44 pruebas, 44 pasan, 0 fallan; código 0 |
| npm.cmd run clinical:audit | Código 1: falta auditoria-local/primeras-hojas.pdf |
| npm.cmd run narrative:audit | Código 1: falta clinical-audit/audit-cases.json |
| git diff --check | Sin errores |

Las cifras anteriores de 18 y 38 correspondían a ejecuciones diferentes: phase-00-approval + ux-hotfix sumaban 18; agregar whatsapp-flow sumaba 38 (20 pruebas adicionales). El informe anterior omitió esa última ejecución. En esta continuación se agregaron seis pruebas de respuestas TTS, por eso el conjunto de tres archivos suma ahora 44. La suite completa también vuelve a cargar la integración MediWeb, antes impedida por semver ausente; el resultado actual sustituye el anterior de 141 éxitos y un archivo fallido.

Cobertura específica: importación sin aprobación aunque traiga estados previos, aprobación válida, invalidación por texto y datos clínicos, errores bloqueantes/aptitud pendiente, bloqueo sin WhatsApp/identidad/autorización/PDF, cambio de destinatario y revocación. Con promesas TTS diferidas se comprueba respuesta tardía tras edición, revocación, cambio de destinatario, revocar/reconfirmar y cambiar/reconfirmar; las cinco quedan obsoletas y no disponibles como MP3 vigente para preparación. El sexto caso confirma que una respuesta sin cambios permanece vigente. Son pruebas de lógica compartida con la UI, no pruebas de interacción en navegador.

## Insumos pendientes para auditoría

clinical:audit requiere por defecto auditoria-local/primeras-hojas.pdf. Admite una ruta explícita: npm.cmd run clinical:audit -- "C:\ruta-autorizada\primeras-hojas.pdf". Debe usarse un PDF digital real autorizado de la plantilla que procesa la aplicación, sin incorporar datos sensibles al control de versiones.

La auditoría clínica genera clinical-audit/audit-cases.json, audit-summary.json y audit-report-private.md. narrative:audit consume ese audit-cases.json, no un archivo inventado ni una transcripción manual sustituta. Ambas carpetas locales están excluidas en .gitignore. La opción --sanitized añade un reporte saneado, pero también se siguen generando artefactos privados: no compartir automáticamente la carpeta completa.

No se buscaron ni copiaron PDFs clínicos fuera del workspace, no se fabricaron casos para hacer pasar estos comandos y no se añadieron insumos sensibles al repositorio.

## Validación funcional manual pendiente

Iniciar npm.cmd run dev y abrir la URL local que indique Vite. Usar datos ficticios y un servicio TTS simulado para revisar el flujo sin consumo real ni entrega de información clínica.

1. Importar un PDF manual y otro mediante MediWeb Connector: verificar borrador visible, aprobación pendiente y TTS bloqueado. Confirmar que cargar un lote nuevo no reutiliza aprobaciones del anterior.
2. Aprobar explícitamente una narrativa sin bloqueos: comprobar aprobación vigente y una sola solicitud TTS individual. Comprobar el reproductor y descarga MP3.
3. Editar narrativa, datos clínicos y saludo: exigir nueva aprobación; el audio anterior queda obsoleto. Vaciar el texto: bloquear aprobación y TTS. Verificar aptitud pendiente y errores clínicos bloqueantes.
4. En MediWeb, abrir WhatsApp no autoriza TTS; confirmar solo disponibilidad tampoco. Confirmar identidad, autorización y correspondencia del PDF: permitir TTS únicamente con PDF completo vinculado y aprobación clínica vigente.
5. Retardar la respuesta TTS simulada; editar texto, revocar autorización o cambiar destinatario antes de resolverla. Repetir revocando/reconfirmando o cambiando/reconfirmando. Al llegar, el audio debe quedar obsoleto y no ofrecerse como disponible para preparación.
6. Durante TTS, verificar estado generando y prevención de solicitudes duplicadas. Probar cancelación del diálogo de regeneración y confirmación explícita de regeneración. La cancelación del diálogo no cancela una petición ya enviada.
7. Cambiar de trabajador, saludo y lote durante una solicitud y comprobar que no se presenta un archivo vigente en el registro equivocado. Este escenario de interacción queda pendiente de navegador.
8. Restaurar dependencias y pruebas ya está resuelto; para cerrar la aceptación clínica, suministrar el PDF autorizado, ejecutar primero clinical:audit y después narrative:audit, y revisar sus reportes privados con el responsable clínico.

## Riesgos, límites y reversión

No se ejecutó el navegador, no se consumieron créditos reales ni se hicieron entregas. Una autorización revocada después de enviar TTS no revierte una solicitud ya recibida por el proveedor ni garantiza evitar su costo; la protección probada marca la respuesta obsoleta. Las confirmaciones son declaraciones del operador, no verificación externa de identidad. La aprobación local carece de autenticación del aprobador y auditoría persistente; procedimiento institucional y vigencia siguen pendientes según el plan. No se implementó Fase 01 ni ninguna fase posterior.

El proyecto está técnicamente listo para iniciar pruebas funcionales controladas en navegador. La Fase 00 no se declara completamente validada para uso clínico hasta completar los pasos manuales y las dos auditorías con sus insumos autorizados.

Reversión: revisar el diff y revertir únicamente los cambios de Fase 00 si se solicita; preservar el plan preexistente y cambios del usuario. No se ejecutó ninguna reversión automática, commit, push o deploy.


## Actualización durante Fase 01

La comprobación funcional pendiente se ejecutó en Edge con datos ficticios y TTS simulado, integrada en Fase 01. Se verificaron aprobación explícita, bloqueo, invalidación, respuesta tardía, verificación separada de WhatsApp/autorización y carga manual. El informe histórico anterior corresponde a su fecha de validación inicial. Los resultados actuales, alcance y pendientes están consolidados en [FASE_01_RESULTADOS.md](FASE_01_RESULTADOS.md). Las auditorías clínicas continúan pendientes por insumos autorizados ausentes.
