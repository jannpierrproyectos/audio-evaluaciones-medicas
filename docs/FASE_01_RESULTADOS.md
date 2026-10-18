# Fase 01 — Informe único de implementación y validación

Fecha: 17 de octubre de 2026. Repositorio AudioEvaluaciones. Sin commit, push, deploy ni publicación de instalador.

## Estado

Fase 01 implementada en el código local: lotes, evaluaciones, comprobaciones, aprobaciones y MP3 se conservan mediante almacenamiento cifrado del Connector y se recuperan desde la aplicación. La comprobación funcional pendiente de Fase 00 se integró y ejecutó en Edge con datos ficticios y TTS simulado.

Lista para validación de aceptación en una instalación Windows de prueba. No se declara aceptación clínica ni despliegue productivo: faltan los insumos autorizados de las auditorías, la prueba del instalador real y las comprobaciones institucionales indicadas al final.

## Decisión de arquitectura y seguridad

Se eligieron archivos cifrados con escritura atómica, en lugar de SQLite. El Connector ya incluye Node 20+ y copia su directorio src al instalador; esta solución no necesita módulos nativos nuevos, motor SQL ni cambios de dependencias. Los dos lockfiles se conservaron. No se duplicó el motor clínico.

Ubicación de producción y desarrollo: %LOCALAPPDATA%\AudioEvaluacionesConnector\evaluations-v1. Nunca se usa el directorio público de la web, localStorage, IndexedDB ni el repositorio para conservar información clínica.

- Clave AES aleatoria de 256 bits; protegida con DPAPI CurrentUser en key.dpapi. Los argumentos del proceso PowerShell no contienen claves ni contenido clínico. Los errores públicos son genéricos.
- AES-256-GCM autentica catálogo y MP3, con nonce aleatorio y contexto asociado que impide intercambiar archivos de audio entre operaciones.
- ACL de la carpeta sin herencia, acceso para el SID del usuario actual. La persistencia falla cerrada si Windows/DPAPI/permisos no están disponibles. Esto no protege contra un proceso malicioso que ya ejecuta con la identidad del mismo usuario o un administrador del equipo.
- DPAPI CurrentUser está vinculado al contexto del usuario Windows; no se promete portabilidad del respaldo a otra cuenta/equipo. Referencia técnica: [Microsoft DataProtectionScope](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.dataprotectionscope).
- El catálogo guarda estados y un diario de operaciones. Los MP3 son archivos cifrados separados, con metadatos de versión dentro de su contenido autenticado; no se guardan URLs blob transitorias.
- Se omiten páginas, texto PDF crudo, trazas de depuración y referencias a copias de audio exportadas. Los campos clínicos necesarios, texto aprobado y comprobaciones quedan dentro del cifrado.
- La API local exige Origin permitido y JSON; CORS rechaza otros orígenes. Las respuestas tienen Cache-Control: no-store. No se exponen rutas absolutas del almacén.

## Identidad, versiones y duplicados

Cada lote y evaluación tiene UUID opaco. worker_id es una referencia HMAC del documento, usando la clave local; no es un DNI visible como nombre de archivo o clave de operación. Si no hay documento fiable, se usa identidad independiente y no se fusionan personas por parecido de nombres.

La misma importación, identificada por PDF/fuente/metadatos, devuelve el lote ya guardado. Cuando existe referencia explícita de atención (ficha, fecha y documento), también se detectan repeticiones entre PDFs y dentro del lote. Un DNI o una fecha por sí solos nunca fusionan evaluaciones. Los registros ya presentes se omiten y se señalan los lotes correspondientes; contenido clínico discrepante para la misma atención produce conflicto, sin sobrescribir aprobaciones previas. Sin referencia inequívoca, no se adivina que dos PDFs distintos corresponden a la misma atención.

Las escrituras usan revisión optimista. Dos ventanas no pueden sobrescribir silenciosamente el mismo lote con una versión atrasada. El cliente serializa sus guardados y muestra cuándo están pendientes o fallaron. Durante guardados pendientes se avisa antes de cerrar la ventana; un cierre forzado antes de la confirmación puede perder el último cambio aún no recibido por el Connector.

## Recuperación y conservación

El usuario abre la aplicación, consulta Lotes guardados y selecciona Recuperar lote. Se restaura también el saludo. No se importa de nuevo como si fuera un registro recién aprobado.

Se usan archivos temporales cifrados, flush del archivo y rename para publicar cada escritura. El catálogo cuenta con copia cifrada validada. Un bloqueo exclusivo impide escritores concurrentes; un lock de un proceso inequívocamente muerto puede recuperarse. Si los catálogos están corruptos o el esquema es desconocido, no se reemplazan por un catálogo vacío. Los temporales y binarios huérfanos conocidos se limpian dentro del directorio controlado.

Si el MP3 quedó publicado atómicamente justo antes de una caída del catálogo, sus metadatos autenticados permiten reconstruir la operación. Si no hay respuesta persistida, la solicitud queda incierta: no se vuelve a cobrar automáticamente. Una intención guardada que todavía no tenía reserva no se confunde con una solicitud enviada.

Esquema inicial 1. Fase 00 no tenía almacenamiento persistente que migrar. Los esquemas futuros desconocidos se rechazan; cualquier migración futura deberá conservar una copia cifrada antes de transformar datos.

Retención: no hay borrado automático por edad sin política institucional aprobada. El operador dispone de Eliminar lote, con confirmación; se quitan estados, operaciones, referencias, catálogo/copia actualizados y binarios asociados. No se borran PDFs de origen, copias exportadas ni documentos que el usuario descargue por su cuenta. No se promete borrado forense en SSD o respaldos externos. Para respaldo manual, cerrar el Connector y copiar la carpeta completa cifrada, incluida key.dpapi; recuperar dentro del contexto Windows compatible y verificar integridad antes de continuar. El respaldo automático externo no se implementó.

## Comprobaciones y aprobaciones

Se guardan los estados faltante, inválido, pendiente, confirmado por operador y sin WhatsApp. Cada comprobación explícita registra teléfono, identidad/vínculo, fecha y origen; se conserva su historial dentro de la evaluación. La observación inicial de importación no es una comprobación humana.

WhatsApp y autorización de entrega siguen separados. Para la autorización persistente, el operador indica fecha y hora de vencimiento; no se inventó un plazo institucional. Cambiar fecha, teléfono o identidad obliga a confirmar de nuevo. Una autorización vencida o revocada bloquea TTS. La recuperación comprueba que la verificación corresponda al teléfono e identidad actuales; nunca toma una comprobación histórica como permiso vigente.

Las aprobaciones conservan identificador, evaluación, fecha, versión clínica exacta y texto. Se validan al recuperar; diferencias de identidad, evaluación, texto, saludo o contenido invalidan la aprobación. Se reutilizan las funciones de Fase 00 y las reglas existentes, sin cambiar criterios ni umbrales médicos.

## MP3 y TTS individual

La huella de reutilización incluye evaluación/lote, versión clínica, destinatario, texto aprobado, texto TTS normalizado, proveedor, modelo, referencia de voz, parámetros, idioma, formato y versión del contrato. El backend publica únicamente configuración no secreta: la voz se representa por referencia hash; nunca se publica la API key.

Antes de pedir TTS se guardan intención y reserva. La misma operación no se envía otra vez por un clic repetido, otra ventana o una recarga. Un MP3 vigente se recupera y reproduce sin nueva solicitud pagada. Cambios de contenido/configuración lo vuelven obsoleto. Las respuestas tardías se contrastan con el estado actual; cambios de lote, texto, destinatario o revocación impiden aceptarlas como vigentes.

Los MP3 persistentes permanecen cifrados; se descifran en memoria para crear URLs blob del reproductor. La copia explícita para seleccionar en Explorer/WhatsApp exige ACL y EFS en su carpeta/archivo; si Windows no permite EFS, se bloquea la escritura de esa copia y se conserva el MP3 en el almacén AES. La prueba de EFS fue denegada en este entorno: la selección de esa copia en Explorer queda pendiente en un equipo compatible. La descarga explícita del navegador es una exportación decidida por el usuario, fuera del almacén protegido.

La carga manual se conserva y utiliza el Connector local para guardar. Con un Connector antiguo o cerrado no se finge que el trabajo quedó persistido: la aplicación presenta un error y no habilita el flujo durable. El servicio TTS debe estar actualizado para publicar /configuration y X-TTS-Configuration. El mock WAV anterior y servicios sin configuración identificable no se consideran MP3 reutilizables; las pruebas usan un TTS MP3 simulado.

## Archivos

Nuevos:

- mediweb-downloader/src/evaluationStore.js: catálogo/MP3 cifrados, revisiones, duplicados, operaciones, recuperación y eliminación.
- mediweb-downloader/src/windowsProtection.js: DPAPI, ACL y protección EFS de exportación.
- mediweb-downloader/src/http/stateRoutes.js: API local de persistencia.
- src/lib/evaluationPersistence.js: repositorio cliente, recuperación, verificación de versiones, huellas y TTS durable individual.
- api/tts/configuration.js: configuración pública no secreta del proveedor.
- test/phase-01-persistence.test.js y mediweb-downloader/test/evaluation-store-http.test.js: regresiones de datos/seguridad/HTTP.
- scripts/phase01-functional-check.js: prueba aislada y repetible en Edge.
- docs/FASE_01_RESULTADOS.md: este informe.

Modificados en Fase 01: src/App.jsx, src/components/PdfWorkersPreview.jsx, src/lib/clinicalApproval.js, src/lib/whatsappMessage.js, src/lib/ttsClient.js; mediweb-downloader/src/service.js, src/http/app.js y src/managedFiles.js; server/ttsService.js, server/viteTtsApiPlugin.js, api/tts/synthesize.js y tts-service/app/main.py; seguimiento en PLAN_AUTOMATIZACION.md y nota en FASE_00_RESULTADOS.md.

Se conservaron también todos los cambios anteriores de Fase 00. No se modificaron archivos .env, credenciales, umbrales clínicos, lockfiles ni infraestructura. El empaquetado existente copia los nuevos módulos src sin introducir módulos nativos; no se construyó ni publicó instalador.

## Pruebas y evidencia

Resultados finales desde la raíz, con Windows y npm.cmd:

| Comando | Resultado |
|---|---|
| npm.cmd test | 188/188 pasan, código 0 |
| npm.cmd run lint | Código 0 |
| npm.cmd run build | Código 0; Vite, 100 módulos |
| npm.cmd test --prefix mediweb-downloader | 102/102 pasan, código 0 |
| node scripts/phase01-functional-check.js | Código 0; cinco comprobaciones funcionales en Edge |
| Comprobación AST de tts-service/app/main.py | Correcta; no sustituye prueba del servicio Python desplegado |
| git diff --check | Sin errores |
| npm.cmd run clinical:audit | Código 1: falta auditoria-local/primeras-hojas.pdf |
| npm.cmd run narrative:audit | Código 1: falta clinical-audit/audit-cases.json |

Cobertura nueva: persistencia y reapertura, cifrado/minimización, recuperación desde copia y rechazo de corrupción, IDs/atenciones distintas, deduplicación con ficha, conflictos de revisión, reservas concurrentes, recuperación y reutilización exacta de MP3, cambio de voz/configuración, invalidez de identidad/texto/saludo, vencimiento, rechazo de exportación sin protección, respuestas tardías por edición/revocación/cambio de destinatario/lote, intención no enviada y caída entre binario y catálogo. DPAPI y ACL se probaron realmente en Windows, también al reabrir el almacén.

La prueba funcional usa un Connector HTTP y almacén temporal reales, una instancia Vite aislada y Edge headless. Usa evaluaciones ficticias y un PDF digital generado en memoria. Se comprobó: borrador visible sin aprobación, aprobación explícita/TTS individual, recarga y reapertura del almacén conservando aprobación/MP3, reutilización sin otra solicitud, edición durante TTS dejando audio obsoleto, MediWeb simulado con requisitos separados de WhatsApp/autorización/PDF, revocación y carga manual de PDF sin aprobación implícita. Se realizaron tres llamadas TTS simuladas; no hubo llamadas a proveedores de voz ni a MediWeb reales. El MP3 sintético verifica transporte y almacenamiento, no calidad ni decodificación acústica de voz real.

La suite del Connector falló inicialmente en ocho pruebas por ausencia del navegador Playwright; tras instalar Chromium de pruebas, las 102 pruebas pasaron. Se instalaron dependencias del Connector sin modificar su lockfile. Los intentos intermedios no se ocultan ni se presentan como defectos clínicos. La validación funcional detectó y corrigió una reaplicación de ACL que pedía privilegios innecesarios.

Las cifras históricas de Fase 00 siguen siendo 18 pruebas en dos archivos o 38 al añadir whatsapp-flow; luego fueron 44 tras seis casos de respuestas tardías. La suite actual incorpora Fase 01 y tiene 188 casos; no son recuentos equivalentes.

## Límites reales y aceptación pendiente

1. Las auditorías requieren un PDF fuente autorizado. Ejecutar clinical:audit primero, que produce clinical-audit/audit-cases.json; después narrative:audit. No se fabricaron datos para sustituirlos ni se incorporaron documentos sensibles al repositorio.
2. No se ejecutó instalación/actualización del instalador ni reinicio completo del sistema operativo. Se verificó la reapertura real del almacén y la recarga del navegador; falta un piloto en una PC Windows instalada, con el mismo usuario Windows.
3. La prueba funcional de MediWeb fue simulada. Falta comprobar sesión real, descarga Ambos, disponibilidad del PDF original después del reinicio y correspondencia de archivos con un lote autorizado.
4. Los PDFs de origen del flujo existente siguen siendo archivos del usuario/Connector; esta fase no cifra retroactivamente documentos preexistentes ni cambia el motor de descarga. Deben conservarse bajo la política de acceso/cifrado del equipo. La persistencia nueva no crea copias PDF en claro.
5. Si se cierra el navegador antes de recibir/subir el resultado TTS o el proveedor devuelve un timeout ambiguo, no existe un contrato remoto idempotente para recuperar con certeza ese audio. La reserva queda incierta y bloquea el reenvío: no se promete recuperación remota ni devolución del costo. Debe investigarse el resultado del proveedor antes de una resolución operativa; no hay reintentos ciegos ni una función que finja ausencia de cargo.
6. Los cambios aún no confirmados por el Connector no sobreviven necesariamente a un cierre forzado. Esperar Cambios guardados antes de cerrar. Ante un conflicto, conservar la ventana, resolverlo y recuperar el lote explícitamente; el cliente no sobrescribe la versión de otra ventana.
7. Probar en el equipo de destino el soporte EFS de la exportación Explorer. En este entorno se rechazó la prueba y no se escribió una copia MP3 desprotegida. Reproductor/recuperación AES son independientes de EFS.
8. El responsable institucional debe definir procedimiento de identidad, quién puede aprobar, vencimientos y política de retención/respaldo. La fecha introducida es una declaración explícita del operador, no una verificación externa. No se añadió autenticación de aprobador ni se simula que exista.

Para repetir la aceptación: iniciar el Connector actualizado y npm.cmd run dev; importar PDF ficticio, aprobar, esperar guardado, generar MP3 simulado, cerrar/reabrir, recuperar lote y comprobar que no aumenta el contador de TTS. Repetir con WhatsApp negativo/positivo, autorización vencida/revocada, edición de texto/saludo/identidad y respuesta TTS retardada. Verificar conflicto entre dos ventanas, eliminación deliberada de un lote de prueba y recuperación de la copia cifrada. Después repetir las auditorías con insumos autorizados y revisar sus reportes privados.

## Reversión

No se ejecutó reversión. Para volver al código anterior, revisar el diff y retirar solo los cambios de Fase 01, conservando Fase 00 y el trabajo del usuario. Antes, respaldar la carpeta cifrada completa con el Connector cerrado. No eliminar key.dpapi ni el almacén para revertir código: perder la clave puede volver irrecuperables los datos. Los binarios generados y datos locales no se versionaron.
