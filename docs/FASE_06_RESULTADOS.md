# Fase 06 final — validación integral y preparación institucional

Fecha: 18/10/2026, America/Lima. Windows `10.0.26200`, Node `v24.21.0`, x64. Se leyeron el plan, los informes 00–05 y el código actual, conservando sus cambios locales. No se hizo commit, push, deploy, instalación/desinstalación, publicación de artefactos, modificación de secretos ni cambios de criterios médicos.

## Dictamen

| Nivel solicitado | Estado | Alcance |
| --- | --- | --- |
| A. Técnicamente validada para pruebas locales | **APROBADA** | Suites, build, controles de recuperación, Edge con datos ficticios y proveedores simulados; staging real con reinicio de proceso y cifrado Windows. |
| B. Preparada para aceptación institucional | **PENDIENTE** | Código y guía preparados; faltan Setup compilado/firmado, PC de aceptación con EFS, infraestructura protegida, piloto MediWeb y auditorías autorizadas. No usar datos reales para el piloto hasta cumplir sus requisitos. |
| C. Aprobada para producción | **PENDIENTE — NO APROBADA** | Los bloqueos de seguridad, infraestructura y aceptación clínica indicados abajo impiden autorizar producción. |

La validación técnica está realizada dentro de los límites disponibles. No se presenta una simulación como aceptación de EFS, Explorer, WhatsApp, MediWeb institucional o Vercel desplegado. No se afirma que exista un Setup nuevo listo para distribuir.

## Arquitectura final y funciones conservadas

React/Vite utiliza un único parser y motor clínico para PDF manual y consolidado MediWeb. `Iniciar procesamiento completo` coordina búsqueda confirmada, `DownloaderRunner`/`JobManager`, descarga `both`, extracción, narrativas y recuperación de lotes. El Connector mantiene sesión local y escucha únicamente en `127.0.0.1`; no se expone a Internet.

`EvaluationStore` conserva catálogo, lotes, autorizaciones, aprobaciones, colas y entregas con AES-256-GCM, clave DPAPI CurrentUser, ACL y escrituras atómicas/copias autenticadas. Los MP3 se guardan cifrados y se reutilizan por evaluación, identidad, versión, texto TTS y configuración. PDF y exportaciones administradas se protegen con EFS en el flujo institucional; si no puede comprobarse la protección se bloquean operaciones.

La verificación rápida conserva formato, existencia de WhatsApp, identidad, consentimiento y correspondencia de PDF independientes. La aprobación exige una acción humana y contenido exacto. La cola masiva requiere estimación y confirmación, revalida antes de TTS, conserva estados inciertos sin reintentos ciegos y mantiene generación individual. La bandeja vincula mensaje/PDF/MP3 con hashes, guarda confirmaciones parciales y exige cierre explícito; las declaraciones no prueban recepción en WhatsApp.

Se conservaron importación manual, edición narrativa, descarga MediWeb, verificación rápida, aprobación explícita, TTS individual/masivo, reutilización y entrega manual. No se añadió n8n, programación ni envío automático.

## Defectos corregidos en Fase 06

1. **Pérdida de datos al desinstalar:** la fuente Inno eliminaba todo LocalAppData, que ahora incluye catálogo y claves DPAPI. Se retiró esa eliminación automática. La corrección no modifica el desinstalador ya instalado; actualizar sin desinstalar y respaldar primero. No se probaron instalación/desinstalación reales.
2. **Éxito falso de construcción:** faltar `ISCC.exe` devolvía código 0. Ahora el comando falla explícitamente con código 1 y no afirma haber generado un Setup.
3. **Sesión local:** antes de abrir el navegador se crea y restringe por ACL el perfil. Un directorio no protegible impide lanzar el navegador.
4. **Protección de archivos:** las descargas clásicas del Connector empaquetado también protegen salidas y temporales antes de escribir; el revelado heredado comprueba EFS/permisos cuando usa el servicio de producción. La bandeja conserva además hashes y controles de identidad. No se permitió una alternativa en claro para superar pruebas.
5. **Errores y logs:** las API TTS/Sheets y plugins de desarrollo no registran objetos de error ni devuelven cuerpos remotos. FastAPI no devuelve excepciones con texto/rutas; el cliente ElevenLabs no incorpora el cuerpo de error del proveedor. Se retiraron texto arbitrario del DOM y detalles de excepciones de los logs de paginación, y el diagnóstico React deja de imprimir el objeto de error. Los mensajes indican revisar configuración/estado y no reintentar resultados inciertos.
6. **Empaquetado:** el validador exige los módulos nuevos y rechaza directorios de datos/pruebas, claves DPAPI, binarios cifrados y certificados privados. El smoke ahora importa un lote ficticio por HTTP, cierra/reinicia el proceso empaquetado y comprueba recuperación cifrada, sin tocar la instalación existente.

## Resultados reproducibles

| Comprobación/comando | Clasificación | Resultado observado |
| --- | --- | --- |
| `npm.cmd test` | APROBADA | **224/224** pruebas. Incluye golden clínicos, importación, aprobaciones, identidad, invalidaciones, TTS incierto y entregas. |
| `npm.cmd test`, en `mediweb-downloader` | APROBADA | **139/139** pruebas. Incluye sesiones, paginación, asociaciones, persistencia, rutas, CORS y actualizaciones. |
| `npm.cmd run lint` | APROBADA | Sin errores. |
| `npm.cmd run build` | APROBADA | Build de producción local, 114 módulos. No desplegado. |
| `npm.cmd run check`, Connector | APROBADA | 49 archivos JavaScript correctos. |
| `node --check` sobre JavaScript del repositorio | APROBADA | 158 archivos `.js`/`.mjs` no ignorados; JSX validado por lint/build. |
| Sintaxis Python mediante `ast.parse` | APROBADA | Cinco módulos de `tts-service/app`; sin cargar `.env`, modelos o proveedores. No sustituye pruebas del FastAPI desplegado. |
| `node scripts/phase06-security-check.js` | APROBADA, alcance estático | `public` y `dist` sin artefactos médicos ni patrones de claves privadas conocidos. No equivale a pentest ni verifica todos los formatos de secreto posibles. |
| `git diff --check` | APROBADA | Sin errores de espacios. |
| Lote de 500 evaluaciones | APROBADA, sintética | 400 elegibles, 100 sin aprobación bloqueadas; consulta de operaciones, sin TTS. Recuperación de un elemento iniciado como incierto, cola pausada. No es prueba de rendimiento de MediWeb real ni síntesis real de 500 audios. |
| `npm.cmd run build:windows:staging` | APROBADA, construcción real | Host C# x64 compilado, Node incluido y dependencias productivas del lockfile. Staging de **195,1 MB**. |
| Validador de staging final | APROBADA | Incluye módulos de Fases 00–05 y protecciones nuevas; excluye datos, claves, documentos y pruebas. |
| `npm.cmd run smoke:windows:staging` | APROBADA, proceso real | Runtime incluido responde `/health` 0.5.0; dos procesos consecutivos recuperan lote AES-GCM/DPAPI en usuario de prueba aislado; sin marcador ficticio en claro en el vault. No inicia el host de bandeja ni instala. |
| `npm.cmd run build:windows:installer` | **FALLIDA, herramienta ausente** | Falta **Inno Setup 6 / ISCC.exe**; código 1. No se generó Setup nuevo. No se instalaron herramientas del sistema sin autorización. |
| Firma del host compilado | **FALLIDA para distribución institucional** | `Get-AuthenticodeSignature`: `NotSigned`. No se invocó firma ni se modificaron credenciales. |
| `npm.cmd run clinical:audit` | FALLIDA por insumo ausente; aceptación PENDIENTE | Falta exactamente `auditoria-local/primeras-hojas.pdf`; código 1. |
| `npm.cmd run narrative:audit` | FALLIDA por insumo ausente; aceptación PENDIENTE | Falta exactamente `clinical-audit/audit-cases.json`; código 1. |

No se alteraron lockfiles: SHA-256 raíz `364FE34DA2AA37C0C0800475EA0B7D90B6D1D337D7D8A314555760FCCB460AF6`; Connector `13A19B7CAABA2608B02D57EB6694A2C88ABE9C98C315C0EBBCD3CBB6D2B89DC6`. Las reconstrucciones solo reemplazaron los artefactos propios del directorio de build verificado dentro del repositorio. La última corrección JavaScript de paginación se sincronizó al staging y se repitió smoke; no se sobrescribió una instalación.

### Evidencia funcional en Edge

| Script | Clasificación | Evidencia |
| --- | --- | --- |
| `scripts/phase01-functional-check.js` | APROBADA, datos ficticios | PDF manual real, borrador sin aprobación, aprobación/TTS individual simulado, reinicio, reutilización, edición durante TTS y revocación. Tres solicitudes simuladas. |
| `scripts/phase02-functional-check.js` | APROBADA en repetición aislada; incidencia de concurrencia registrada | Teléfonos inválidos/duplicados/sin WhatsApp, recuperación, popup bloqueado, navegación y cuenta separada de autorización. Un TTS simulado. |
| `scripts/phase03-functional-check.js` | APROBADA, simulada | Lote mixto, estimación, rechazo de confirmación, pausa, recuperación, reutilización, cancelación y respuesta obsoleta. Cuatro TTS simulados. |
| `scripts/phase05-functional-check.js` | APROBADA, simulada | Preparación interrumpida, asociación PDF/MP3, intención incierta, conciliación, confirmaciones parciales, reinicio y cierre/avance. Cero TTS. |
| `scripts/phase06-functional-check.js` | APROBADA, recorrido integral simulado | Mismo lote desde tabla MediWeb hasta cierre manual de entrega: dos descargas, parser real, dos TTS simulados y recuperación. EFS y Explorer sustituidos solo en el fixture ficticio. |

El recorrido integral usa Edge headless real, React, HTTP local, `DownloaderRunner`, paginación, PDF generado/extraído, motor narrativo y almacén AES-GCM/DPAPI reales. Intercepta todas las páginas MediWeb/WhatsApp y solicitudes de voz con respuestas ficticias. Incluye una atención NO APTO excluida y una fila repetida entre páginas: solo dos PDFs elegibles llegan al lote. El primer intento de importar el consolidado falla deliberadamente; recuperar relee los PDFs existentes sin redescargar. Ningún registro queda aprobado por importar.

Las dos aprobaciones y declaraciones de destinatario se hacen con controles explícitos de la interfaz. La cola masiva requiere confirmación y sintetiza dos MP3 ficticios. Tras reapertura se reconocen ambos como reutilizables, sin otras solicitudes. La misma evaluación pasa a la bandeja, se comprueban documentos/fechas y hashes, se simula revelar adjuntos, se conservan dos confirmaciones tras recarga/reapertura y solo la tercera declaración seguida de **Confirmar y siguiente** completa y avanza. No se transforma una intención incierta en éxito.

Una ejecución de Fase 02 concurrente con construcción falló al observar tres pestañas en vez de dos. Se repitió aislada y pasó sin reducir las aserciones ni retirar controles. No se atribuye una causa única sin evidencia: la reutilización/cierre de ventanas sigue requiriendo aceptación visual en Edge institucional; la seguridad no depende de que abrir el chat confirme identidad o envío. Advertencias de fuentes/índices PDF.js en fixtures no impidieron extracción ni las verificaciones.

**Cero envíos reales, cero consultas a cuentas reales de WhatsApp/MediWeb y cero créditos reales de ElevenLabs en las pruebas.** Los MP3 sintéticos no validan calidad de voz ni exactitud acústica de una lectura clínica real.

## Aceptación Windows, seguridad e infraestructura

| Comprobación | Estado | Evidencia/límite |
| --- | --- | --- |
| DPAPI CurrentUser, ACL y AES-GCM reales | APROBADA | `scripts/phase06-windows-check.js` crea/reabre vault ficticio y verifica ausencia del marcador en bytes persistidos. También pasa desde staging. |
| Perfil persistente Edge real | APROBADA, ficticia | Cierre y reapertura conservan una cookie ficticia en perfil temporal con ACL. No se accedió al perfil institucional. |
| EFS real en este entorno | **FALLIDA** | `protectExportDirectory` no puede proteger el directorio de prueba. No se escribe MP3 sin protección; la denegación se mantiene. No se acepta producción con este resultado. |
| Explorer real y adjuntos reales | **PENDIENTE** | Los fixtures sustituyen el revelado. No se declara aceptación de Explorer con EFS simulado ni se abren documentos reales. |
| Instalar/desinstalar, Inicio, icono de bandeja | **PENDIENTE** | Compilación y contratos automatizados pasan; no se ejecutó Setup ni se alteró la instalación existente, cuyo ejecutable se detecta en la ubicación habitual. |
| Inicio automático Windows y reinicio del sistema | **PENDIENTE** | Pruebas de configuración/contratos HKCU pasan; no se cambió el registro ni se reinició Windows. Reinicio del proceso staging sí probado. |
| Sesión institucional MediWeb/MFA/expiración | **PENDIENTE real** | Sesión válida/expirada probadas con páginas ficticias y tests. No se inició sesión institucional ni se automatizaron credenciales. |
| HTTPS Vercel → localhost/Edge | **PENDIENTE real** | Configuración/orígenes revisados y CORS probado localmente; no se probó el dominio publicado con este código ni su permiso de acceso a red local. |
| Loopback, CORS y rutas administradas | APROBADA local | Servicio enlaza `127.0.0.1`; orígenes exactos, preflight y acceso arbitrario a archivos cubiertos por suites. No usar CORS como autenticación. |
| Temporales y exportaciones institucionales | APROBADA en controles; aceptación EFS PENDIENTE | Vault cifrado, escritura atómica, salidas/temporales protegidos antes de escribir en flujo integrado/empaquetado, revelado protegido y bloqueo de rutas. No se promete borrado físico seguro ni cifrado retroactivo de documentos externos. CLI/desarrollo heredado no es una vía aprobada para datos reales. |
| Secretos/logs/archivos públicos | APROBADA con alcance de revisión local | Solo URLs públicas en variables Vite usadas por React; secretos del proveedor en backend. Scan local y errores sanitizados. No se inspeccionaron valores de secretos ni logs institucionales de pacientes. |
| Duplicados, invalidaciones y resultados inciertos | APROBADA automatizada | Evaluación/operación/entrega, hashes, versiones, cambios de identidad/número/texto/PDF/audio, revocaciones, fallos de red y respuestas tardías cubiertos; incertidumbre no reintenta por sí sola. |
| Actualizador | APROBADA en pruebas; ejecución real PENDIENTE | HTTPS/allowlist, SHA-256, tamaño, cancelación y bloqueo con descarga activa. No se ejecutó actualización. Cerrar también TTS/entregas y comprobar firma antes del cambio. |
| Control de acceso a frontend/TTS/FastAPI y límites de consumo | **PENDIENTE, bloqueo de producción** | Los endpoints no incorporan autenticación institucional ni identidad fiable del aprobador. Una comprobación de React no autoriza solicitudes directas al backend; CORS tampoco. Exigir control de acceso/gateway y límites verificados antes de exponer voz real o datos reales. No se inventó un proveedor de identidad ni se cambiaron secretos. |
| Compatibilidad/publicación del conjunto nuevo | **PENDIENTE** | Código local y staging siguen con 0.5.0; manifiesto público describe un artefacto histórico con hash propio y mínima 0.2.0. No prueba que ese instalador incluya Fases 00–06. Asignar nueva SemVer/mínima compatible, compilar, firmar, probar y actualizar manifiesto únicamente bajo autorización. |
| Servicio TTS desplegado, voz, cuotas y timeouts | **PENDIENTE real** | Sintaxis y contrato revisados; HTTP y MP3 simulados. Comprobar plataforma, autenticación, HTTPS, cabeceras, configuración MP3 y duración de funciones; no se llamó a ElevenLabs. |

Se revisaron también `vercel.json`, handlers `api/`, configuración Vite, `tts-service/Dockerfile` (Python 3.11, puerto 7860) y dependencias Python fijadas. Los métodos HTTP exportados coinciden con la forma documentada por el [runtime Node de Vercel](https://vercel.com/docs/functions/runtimes/node-js); eso no demuestra configuración o funcionamiento del proyecto publicado. El contenedor TTS escucha en todas sus interfaces y no tiene autenticación incorporada: su red/gateway necesita aceptación explícita. No se construyó ni desplegó imagen Docker, no se alteró la configuración del proyecto Vercel y no se confundió ese bind de contenedor con el loopback obligatorio del Connector.

## Validación clínica

Los tests deterministas y golden siguen pasando y no se modificaron reglas o umbrales. Esto **no** sustituye la aprobación clínica institucional. Hace falta el PDF autorizado `auditoria-local/primeras-hojas.pdf`; `clinical:audit` produce después `clinical-audit/audit-cases.json`, utilizado por `narrative:audit`. No se fabricaron hallazgos ni insumos para declarar superadas estas auditorías, ni se subieron documentos clínicos a servicios externos.

## Revisión operativa y guía

El recorrido diario se comprobó con los botones existentes: iniciar procesamiento, identificar incidencias, verificar WhatsApp, aprobar texto, preparar/confirmar audios, abrir bandeja y confirmar/avanzar. No se rediseñó la aplicación ni se añadieron pantallas redundantes. La mejora de errores orienta a revisar configuración, almacenamiento o incertidumbre sin exponer datos.

La guía [GUIA_OPERACION_INSTALACION.md](GUIA_OPERACION_INSTALACION.md) contiene requisitos, instalación/primera aceptación, uso diario, variables por componente, construcción, firma/publicación autorizada, respaldo, actualización y reversión. No se ejecutaron esos pasos de distribución. No borrar claves/catálogos ni restaurar respaldos antiguos sobre operaciones nuevas sin conciliación; DPAPI y EFS dependen del usuario/entorno y sus mecanismos de recuperación institucionales.

## Archivos de Fase 06

- Nuevos: `docs/FASE_06_RESULTADOS.md`, `docs/GUIA_OPERACION_INSTALACION.md`; `scripts/phase06-functional-check.js`, `phase06-security-check.js`, `phase06-windows-check.js`; `test/phase-06-security.test.js`; `mediweb-downloader/test/phase-06-hardening.test.js`.
- Installer/build: `mediweb-downloader/installer/AudioEvaluacionesConnector.iss`, `scripts/build-windows-installer.js`, `scripts/packaging.js`, `scripts/smoke-windows-staging.js`, `test/packaging.test.js`, `mediweb-downloader/README.md`.
- Seguridad de sesión/archivos/logs: `mediweb-downloader/src/browser.js`, `runner.js`, `managedFiles.js`, `pagination.js`; `src/components/MediwebImporter.jsx`.
- Sanitización de errores: `api/tts/synthesize.js`, `api/sheets/trabajadores.js`, `server/viteTtsApiPlugin.js`, `server/viteSheetsApiPlugin.js`, `tts-service/app/main.py`, `tts-service/app/elevenlabs_service.py`.
- Generados locales ignorados: `dist` y `mediweb-downloader/build-windows` (host/staging). No contienen documentos de paciente ni datos del usuario. No se publicaron.

Todos los cambios anteriores permanecen. Los bloqueos restantes son aceptación e infraestructura verificables, no fases nuevas: Setup/firma y Windows instalado; EFS/Explorer; acceso protegido a TTS/frontend; compatibilidad/versionado de release; MediWeb institucional; auditorías y responsables clínicos; política de respaldo/retención. Hasta cerrarlos, mantener **A**, con **B/C pendientes**.
