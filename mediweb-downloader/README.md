# MediWeb Downloader

Módulo local e independiente que convierte los reportes `Imp S.F` de MediWeb a PDF. El inicio de sesión, la navegación hasta **Atenciones → Ocupacional**, los filtros y la búsqueda siguen siendo manuales. Después de confirmar el resumen inicial, la paginación automática está activada por defecto y recorre todas las páginas de resultados.

## Requisitos para desarrollador

- Windows con PowerShell.
- Node.js 20 o posterior.
- Acceso autorizado a `https://resultados.innomedic.pe`.
- Espacio local suficiente para los PDF clínicos.

```powershell
cd C:\Users\USER\Documents\AudioEvaluaciones\mediweb-downloader
npm install
npx playwright install chromium
```

Playwright usa un perfil local en `.auth/mediweb-profile`. La herramienta no lee ni almacena usuario o contraseña y no automatiza el inicio de sesión.

## Requisitos para usuario final

El usuario final solo necesita Windows x64 y Microsoft Edge o Google Chrome instalado. El Setup incluye Node.js y las dependencias de producción; no requiere Node, npm, VS Code, Git, PowerShell, CMD, Playwright CLI ni Inno Setup. Tras instalar, **AudioEvaluaciones Connector** permanece en la bandeja del sistema sin consola negra.

La versión instalada usa estas rutas mutables, siempre fuera de `Program Files`:

```text
%LOCALAPPDATA%\AudioEvaluacionesConnector\auth
%LOCALAPPDATA%\AudioEvaluacionesConnector\config.json
%LOCALAPPDATA%\AudioEvaluacionesConnector\tmp
%LOCALAPPDATA%\AudioEvaluacionesConnector\logs
%USERPROFILE%\Documents\AudioEvaluaciones\Descargas\YYYY-MM-DD_HH-mm-ss
```

El perfil `auth` es exclusivo del Connector y conserva la sesión/cookies del navegador, pero el Connector no guarda la contraseña. Al desinstalar se elimina LocalAppData, incluido `auth`; los reportes en Documentos se conservan.

### Uso diario del icono de bandeja

El icono junto al reloj expresa con texto los estados **Iniciando**, **Activo**, **MediWeb abierto**, **Procesando evaluaciones**, **Se produjo un error** y **Detenido**. Su menú ofrece:

- abrir AudioEvaluaciones en el navegador predeterminado;
- abrir o reutilizar MediWeb mediante el motor existente;
- abrir la carpeta de reportes;
- activar/desactivar el inicio con Windows;
- editar configuración y abrir diagnóstico;
- ver versión, iniciar/detener, reiniciar y salir.

Si hay un job activo, reiniciar, detener o salir exige confirmación y usa la cancelación cooperativa antes de cerrar. No se muestran nombres, DNI, aptitudes ni datos clínicos en tray, notificaciones o logs.

## Flujo de ejecución

1. Ejecuta uno de los comandos descritos abajo.
2. En Chromium, inicia sesión manualmente.
3. Abre **Atenciones → Ocupacional**, configura los filtros y pulsa **Buscar**.
4. Comprueba que la tabla muestre la columna `Imp S.F`.
5. Regresa a PowerShell y presiona Enter.
6. Revisa el resumen de la primera página y confirma con `S`.

No se hace un escaneo previo completo. La ejecución lee, filtra y procesa cada página una sola vez antes de avanzar con el control DOM `Siguiente`. Se detiene cuando el control no existe, no es visible o está deshabilitado.

## Modos y comandos

- `first`: genera un único `primeras-hojas.pdf` con todas las primeras páginas correctas.
- `full`: genera un PDF completo individual por atención.
- `both`: genera ambos; el reporte completo se carga una sola vez y de ese mismo PDF se copia la primera página.

Prueba de una sola página:

```powershell
npm run start -- --mode both --single-page --limit 5
```

Prueba controlada de dos páginas:

```powershell
npm run start -- --mode both --max-pages 2 --per-page-limit 3
```

Prueba mínima del cambio de página:

```powershell
npm run start -- --mode both --max-pages 2 --per-page-limit 2
```

Procesar todas las páginas:

```powershell
npm run start -- --mode both
```

Procesar como máximo 150 elegibles:

```powershell
npm run start -- --mode both --limit 150
```

Solo primeras hojas de todas las páginas:

```powershell
npm run start -- --mode first
```

Solo reportes completos:

```powershell
npm run start -- --mode full
```

Otros argumentos:

- `--limit N`: límite global de atenciones elegibles. No se reinicia en cada página y la herramienta deja de recorrer páginas cuando lo alcanza.
- `--per-page-limit N`: procesa como máximo `N` elegibles nuevas de cada página, pero continúa hacia la siguiente. Está pensado para pruebas de paginación y diagnósticos con pocas descargas; no reemplaza a `--limit`.
- `--max-pages N`: visita como máximo `N` páginas de resultados. Debe ser un entero mayor o igual a 1.
- `--single-page`: procesa únicamente la página visible y nunca pulsa `Siguiente`; conserva el comportamiento anterior como respaldo.
- `--delay N`: pausa secuencial entre reportes en milisegundos; el valor predeterminado es 900.
- `--output RUTA`: carpeta base alternativa para la salida.

`--single-page` y `--max-pages` no pueden combinarse. `--per-page-limit` sí puede combinarse con cualquiera de ellos. Si se combinan `--limit` y `--per-page-limit`, cada página respeta ambos: el límite por página reduce la selección local y el límite global detiene toda la ejecución cuando se alcanza.

## Filtro y orden

La columna se identifica por el encabezado exacto `APTITUD`; `CRITERIOS DE APTITUD` nunca se usa como sustituto. Son elegibles los valores normalizados que comienzan con `APTO`, incluidos `APTO CON RESTRICCIÓN` y `APTO CON RESTRICCIONES`. Se excluyen `OBSERVADO`, `PENDIENTE`, `NO APTO`, valores vacíos y estados desconocidos.

El orden global es página 1 de arriba hacia abajo, luego página 2, página 3 y así sucesivamente. Las exclusiones no cambian el orden de las elegibles. La numeración de archivos completos es global y no vuelve a `001` al cambiar de página.

La deduplicación también es global. Prefiere `idcomprobante`; si falta, usa combinaciones internas seguras y deja la URL normalizada únicamente en memoria como último recurso. Un registro repetido no se descarga, no se agrega al consolidado, no altera la numeración y no cuenta como error.

Con `--per-page-limit`, todas las filas siguen detectándose, deduplicándose y clasificándose. Las elegibles que exceden la capacidad de su página simplemente no se seleccionan: no se convierten en exclusiones clínicas, no cuentan como errores y no se procesan posteriormente como duplicados. La numeración de los reportes seleccionados y el orden del consolidado continúan siendo globales.

## Seguridad de la paginación

`Siguiente` se busca mediante DOM, con esta prioridad:

1. un elemento visible con `rel="next"`;
2. un enlace o botón cuyo texto normalizado sea exactamente `Siguiente` dentro de una zona semántica de paginación;
3. un único enlace o botón visible con ese texto exacto en el documento.

Antes de avanzar se crea en memoria una firma basada en los identificadores/códigos de las atenciones visibles y su cantidad; no se guardan URLs completas. Si vuelve a aparecer una firma visitada, el proceso se detiene con `pagina_repetida`, agrega un warning al manifest y conserva todos los resultados correctos.

El cambio de página se detecta exclusivamente mediante polling del contenido de la tabla y su firma. No requiere un evento de navegación, un cambio de URL ni `networkidle`, por lo que admite actualizaciones AJAX y también detecta un cambio manual realizado mientras está esperando. Primero intenta un clic normal y, si la tabla no cambia, ejecuta una única vez `element.click()` sobre el mismo control como fallback. Cada espera de cambio dura como máximo 15 segundos. Si ambos intentos fallan, termina con `error_paginacion` sin borrar lo generado.

Una página posterior vacía se vuelve a comprobar antes de decidir. Si permanece vacía y ya no existe un control `Siguiente`, la ejecución termina normalmente.

## Sesión expirada y cancelación

Si la sesión expira, los archivos existentes se conservan. El usuario inicia sesión otra vez, regresa a **Atenciones → Ocupacional**, repite la búsqueda y presiona Enter. Aunque MediWeb vuelva a la página 1, el conjunto global de identificadores permanece en memoria: las páginas ya registradas se atraviesan sin descargar duplicados hasta encontrar atenciones nuevas.

Ctrl+C marca la ejecución como cancelada, conserva los PDF y primeras hojas guardados hasta ese punto, actualiza los archivos de control e intenta cerrar las páginas y el contexto.

## Salida y guardado progresivo

Cada ejecución crea una sola estructura:

```text
downloads\YYYY-MM-DD_HH-mm-ss\
  audioevaluaciones\primeras-hojas.pdf
  reportes-completos\001_CODIGO_PACIENTE.pdf
  control\manifest.json
  control\resultados.csv
```

No se crean consolidados por página. `manifest.json` y `resultados.csv` se reemplazan de forma segura después de cada atención y después de cada página. Cada atención y exclusión incluye `paginaMediWeb`. Cuando existe un reporte completo, su registro conserva también `telefono`, `numeroDocumento` y `archivoPdfCompleto`; en modo `first` esos campos permanecen vacíos.

El manifest contiene `perPageLimit`, un arreglo `pages` con detectadas, elegibles, seleccionadas, excluidas y duplicadas por página, además de `pagination.enabled`, `singlePage`, `maxPages`, `paginasVisitadas`, `ultimaPaginaCompletada` y `motivoFinalizacion`. Los motivos posibles son `ultima_pagina`, `limite_alcanzado`, `max_pages_alcanzado`, `single_page`, `pagina_repetida`, `error_paginacion` y `cancelado`.

Definiciones de contadores:

- `totalPaginasVisitadas`: páginas de resultados distintas registradas durante la ejecución.
- `totalDetectado`: filas DOM con `Imp S.F` vistas una vez por página lógica; varios enlaces de reporte dentro de la misma fila no la duplican.
- `totalUnico`: atenciones únicas después de la deduplicación global.
- `totalElegible`: atenciones únicas con aptitud elegible encontradas.
- `totalExcluido`: atenciones únicas no elegibles encontradas.
- `totalSeleccionado`: elegibles incluidas en el procesamiento después de aplicar `--limit` y `--per-page-limit`.
- `totalProcesado`: seleccionadas cuyo procesamiento terminó correctamente o con error.
- `totalDuplicado`: filas detectadas que ya estaban representadas por una atención única.
- `excluidosObservado`, `excluidosPendiente`, `excluidosNoApto`, `excluidosOtros`: desglose de exclusiones únicas.
- `reportesCompletosGenerados`: PDF completos escritos correctamente.
- `primerasHojasAgregadas`: primeras páginas incorporadas al consolidado único.
- `errores`: procesamientos terminados con estado de error; las exclusiones y duplicados no cuentan.

## Privacidad y alcance

La ejecución es local, secuencial y sin telemetría. El progreso no muestra DNI, nombre completo, URL ni contenido clínico. No incluye envío por WhatsApp/correo, frontend, AudioEvaluaciones, narrativa, audio, nube, cron ni automatización de credenciales.

## Integración con AudioEvaluaciones

El módulo ofrece dos formas de ejecución que usan el mismo motor de descarga:

- CLI interactiva: `npm run start`
- Servicio HTTP local: `npm run service`

Para iniciar el servicio en Windows:

```powershell
cd C:\Users\USER\Documents\AudioEvaluaciones\mediweb-downloader
npm run service
```

El servicio escucha exclusivamente en `http://127.0.0.1:8765`; nunca en `0.0.0.0`. Debe permanecer abierto durante todo el tiempo que AudioEvaluaciones lo utilice. `GET http://127.0.0.1:8765/health` permite comprobar si el conector está disponible sin abrir MediWeb.

El flujo previsto es: iniciar el servicio, llamar `POST /mediweb/open`, iniciar sesión manualmente en la ventana Playwright, navegar a **Atenciones → Ocupacional**, aplicar los filtros, pulsar **Buscar** y llamar `POST /mediweb/detect`. La API no acepta usuario, contraseña, cookies ni tokens, y no existe un endpoint de login.

Endpoints disponibles:

- `GET /health`: estado no clínico del servicio, navegador y job activo.
- `POST /mediweb/open`: abre o reutiliza el navegador persistente con el perfil `.auth`.
- `POST /mediweb/detect`: devuelve solo conteos agregados de la tabla visible.
- `POST /jobs`: inicia un job en memoria con `mode`, `limit`, `maxPages`, `perPageLimit` y `singlePage`.
- `GET /jobs/:jobId`: devuelve estado y contadores reales; no calcula porcentajes ficticios.
- `POST /jobs/:jobId/cancel`: solicita cancelación cooperativa en el siguiente punto seguro.
- `GET /jobs/:jobId/first-pages`: transmite `primeras-hojas.pdf` al completar un job `first` o `both`.
- `GET /jobs/:jobId/manifest`: devuelve únicamente el resumen sanitizado, sin la lista de pacientes.
- `GET /jobs/:jobId/worker-metadata`: entrega al origen web autorizado los metadatos operativos mínimos para asociar cada trabajador importado; rechaza solicitudes sin `Origin` y no altera el endpoint sanitizado del manifest.

Solo se admite un job activo. Los jobs y su estado existen únicamente en la memoria del proceso de `npm run service`; no hay Redis, cola externa, worker remoto ni persistencia de jobs. Los PDF, manifest y CSV generados sí se conservan progresivamente en `downloads` como en la CLI.

Variables opcionales no sensibles:

```powershell
$env:MEDIWEB_SERVICE_PORT="8765"
$env:MEDIWEB_ALLOWED_ORIGINS="http://localhost:5173,http://127.0.0.1:5173,https://ORIGEN-VERCEL-EXACTO"
npm run service
```

`MEDIWEB_SERVICE_PORT` usa `8765` de forma predeterminada. `MEDIWEB_ALLOWED_ORIGINS` es una lista separada por comas. La precedencia es: variable de entorno explícita, `config.json` local y defaults seguros. Los origins predeterminados son exactamente `http://localhost:5173`, `http://127.0.0.1:5173` y `https://audio-evaluaciones-medicas.vercel.app`.

La lista se normaliza eliminando espacios y el slash final; después se compara el origen serializado completo (`scheme + host + port`). La política CORS es estricta: no se emite `Access-Control-Allow-Origin: *`, no se aceptan `*.vercel.app` implícitamente y un `Origin` no configurado recibe `403`. Cada deployment preview debe añadirse por su origen exacto. Las peticiones HTTP sin `Origin` se permiten para PowerShell, CLI y pruebas locales; como el proceso escucha exclusivamente en loopback, siguen proviniendo de la misma PC. Cuando sí existe `Origin`, siempre se valida.

Las peticiones `OPTIONS` no ejecutan rutas ni abren navegador o jobs. Solo autorizan los métodos `GET` y `POST` y, cuando se solicita, el header `Content-Type`. Si un preflight de un origen permitido incluye `Access-Control-Request-Private-Network: true`, el servicio responde `Access-Control-Allow-Private-Network: true`; un origen no permitido no recibe ese header. Todos los endpoints de estado/control y `first-pages` usan `Cache-Control: no-store`.

Los navegadores modernos también pueden solicitar al usuario permiso de acceso a la red local para una web HTTPS que llama a loopback. Ese permiso pertenece al navegador y no puede concederse desde el Connector. Se conserva la compatibilidad de preflight PNA, pero la prueba definitiva requiere aceptar el permiso del sitio en el navegador real. No se configura HTTPS local ni certificados en esta fase.

Primera comprobación sin abrir MediWeb:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/health
```

Después abre la URL publicada y confirma **Conectado**. Autoriza siempre la URL de producción estable; si se prueba una preview de Vercel, añade exactamente esa preview a `MEDIWEB_ALLOWED_ORIGINS`.

La API usa `node:http` en lugar de Express porque el conjunto de rutas y middleware es pequeño; así se mantiene una implementación directa sin agregar dependencias de producción.

## Solución de problemas

- **No se encuentran enlaces:** verifica que la tabla tenga filas reales y una acción `Imp S.F`.
- **Navegador no abre en desarrollo:** ejecuta `npx playwright install chromium` desde esta carpeta.
- **Navegador no abre en la versión instalada:** instala o repara Microsoft Edge o Google Chrome. No se descarga un navegador automáticamente.
- **El reporte queda en blanco:** espera a MediWeb y reintenta; cada atención admite hasta dos intentos.
- **Falla la paginación:** usa temporalmente `--single-page` y conserva el manifest para diagnóstico.
- **PDF diferente al manual:** compara saltos de página, imágenes y CSS de impresión con una descarga manual autorizada.

## Primera prueba real recomendada

```powershell
cd C:\Users\USER\Documents\AudioEvaluaciones\mediweb-downloader
npm run start -- --mode both --max-pages 2 --per-page-limit 3
```

## Build del instalador Windows

### Arquitectura

El paquete no usa Electron: no necesita una segunda interfaz ni otro navegador embebido. El staging contiene `runtime\node.exe`, el código del Connector, dependencias npm de producción, configuración predeterminada y licencias. Para producción se incluye `playwright-core` y se usa `launchPersistentContext()` con `channel: "msedge"`; si Edge no puede iniciar, se prueba `channel: "chrome"`. Chromium administrado por Playwright queda solo para desarrollo y no se empaqueta.

La experiencia de bandeja usa un host WinForms x64 compilado como `winexe` con el compilador de .NET Framework incluido en Windows. No se añadió una dependencia npm nativa: esto evita ABI binario con Node y evita `systray2`, cuyo último release publicado es antiguo. El host es un adaptador pequeño; inicia `runtime\node.exe` con `CreateNoWindow`, recibe eventos operativos JSON por stdout privado y envía `shutdown` por stdin. `trayService.js`, `service.js`, `JobManager` y `Runner` comparten un `EventEmitter`; no existe un segundo servidor ni un segundo JobManager.

No se usa Windows Service porque Playwright y su sesión requieren el escritorio interactivo del usuario. El autoarranque por usuario utiliza `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` y puede cambiarse sin elevación. En inicio automático solo aparece el tray: no abre AudioEvaluaciones ni MediWeb.

El nombre visible y publisher neutral del instalador son **AudioEvaluaciones Connector** y **AudioEvaluaciones**. No se atribuye el paquete a una empresa inexistente.

El runtime copiado es `process.execPath`. Se requiere Node.js 20 como mínimo para construir; se recomienda una versión LTS x64 vigente. La PC destino no necesita Node instalado.

### Requisitos para construir

- Windows x64.
- Node.js 20 o posterior y npm.
- Dependencias instaladas con `npm ci`.
- Inno Setup 6 para generar el `.exe` final. Puede instalarse manualmente con `winget install JRSoftware.InnoSetup`.
- El compilador `csc.exe` de .NET Framework 4.x disponible en Windows para construir el host WinForms.

Si `ISCC.exe` está en una ubicación no estándar, define `ISCC_PATH` con su ruta completa. El build no instala Inno Setup automáticamente.

### Comandos

Desde `mediweb-downloader`, en PowerShell o CMD:

```powershell
npm run build:windows:staging
npm run smoke:windows:staging
npm run build:windows:installer
```

O ejecuta todo en secuencia:

```powershell
npm run build:windows
```

El staging queda en `build-windows\staging`. El smoke test arranca explícitamente `build-windows\staging\runtime\node.exe`, usa un puerto temporal y solo consulta `/health`; no abre MediWeb. El instalador final queda en `dist-windows\AudioEvaluacionesConnector-<version>-Setup.exe`.

El build ejecuta `npm ci --omit=dev`, omite descargas de browser y falla si el staging contiene `.auth`, `.env*`, descargas, logs, temporales, tests, PDF, CSV o manifests reales. La estructura resultante es:

```text
staging\
  AudioEvaluacionesConnector.exe
  assets\AudioEvaluacionesConnector.ico
  runtime\node.exe
  app\package.json
  app\package-lock.json
  app\src\
  app\node_modules\
  config\default-config.json
  licenses\
```

En el primer inicio instalado se crea `%LOCALAPPDATA%\AudioEvaluacionesConnector\config.json`. Puede editarse sin privilegios administrativos. El instalador solicita UAC únicamente para escribir en `Program Files`; el uso diario no requiere elevación ni crea reglas de Firewall.

La configuración incluye `port`, `audioEvaluacionesUrl`, `downloadsDir`, `startWithWindows` y `allowedOrigins`. Cambiar puerto, URL/origins o descargas requiere reinicio y el diálogo lo ofrece. Una URL configurada se normaliza a un origin exacto; nunca se introduce `*` ni se autorizan todos los subdominios Vercel.

Los logs locales están en `%LOCALAPPDATA%\AudioEvaluacionesConnector\logs`. El host y Node conservan como máximo cinco archivos de 2 MB por componente. Los logs empaquetados omiten el progreso detallado del Runner y sanitizan URLs e identificadores; no hay telemetría ni crash reporting cloud.

### Versionado y upgrade

La versión proviene de `package.json` y se inyecta en `/health`, el host nativo, los metadatos Inno y `AudioEvaluacionesConnector-<version>-Setup.exe`. El `AppId` de Inno permanece estable para que 0.2.0 actualice 0.1.0 en la misma entrada de Aplicaciones instaladas.

Durante upgrade, Inno solicita cierre cooperativo al host nuevo. Para 0.1.0 conserva además un fallback restringido a la ventana cuyo título exacto es **AudioEvaluaciones Connector**; nunca termina procesos Node arbitrarios. La actualización reemplaza Program Files, pero no ejecuta la limpieza de desinstalación: conserva `auth`, `config.json` y Documentos. Una desinstalación real elimina LocalAppData y conserva los reportes.

## Actualizaciones seguras y distribución (0.3.0)

La versión se obtiene únicamente de `package.json`. `/health` la expone como `version`; React y el Connector consultan por HTTPS el contrato público `https://audio-evaluaciones-medicas.vercel.app/connector-release.json`. Las comparaciones usan `semver`, no comparación lexicográfica. El contrato distingue `latestVersion` y `minimumSupportedVersion`: una versión compatible anterior muestra un aviso opcional, mientras una versión inferior al mínimo bloquea solamente la integración MediWeb. Una caída del manifest no bloquea el uso del Connector actual.

El Connector comprueba al iniciar y cada 12 horas, con caché de cinco minutos y una sola notificación por versión. No descarga en background. El usuario puede iniciar el flujo desde **Buscar actualizaciones** en el tray o desde la web. El API loopback mínimo es:

- `GET /update/status`: estado no destructivo;
- `POST /update/check`: consulta controlada del manifest;
- `POST /update/download`: descarga el asset definido por el manifest, nunca una URL enviada por React;
- `POST /update/download/cancel`: cancela una descarga activa;
- `POST /update/install`: pide instalar el Setup ya verificado.

Todas estas rutas reutilizan el bind `127.0.0.1` y la misma allowlist CORS exacta. La descarga requiere HTTPS, valida cada redirect, permite únicamente `github.com`, `objects.githubusercontent.com` y subdominios de `githubusercontent.com`, limita el archivo a 200 MB, aplica timeout de conexión y timeout global, y comprueba SHA-256. Un hash distinto elimina el `.partial` o Setup alterado. Antes del consentimiento de instalación, Node y el host WinForms vuelven a calcular el hash. Un job activo devuelve conflicto y no se cancela automáticamente.

Los archivos verificados quedan en `%LOCALAPPDATA%\AudioEvaluacionesConnector\updates\<version>\`. Se conservan la versión pendiente y, como máximo, una anterior. Inno se abre en modo normal después del cierre cooperativo de Playwright, HTTP y Node. El upgrade conserva `auth`, `config.json`, la preferencia HKCU Run y `Documents\AudioEvaluaciones\Descargas`; `configVersion: 1` y la combinación defaults + config existente permiten añadir campos sin invalidar configuraciones 0.2.0.

### Preparar v0.3.0 sin publicarla

```powershell
cd C:\Users\USER\Documents\AudioEvaluaciones\mediweb-downloader
npm test
npm run build:windows
npm run release:prepare
```

`build:windows` sigue el orden host → firma opcional del host → Inno Setup → firma opcional del Setup. `release:prepare` calcula el hash después de cualquier firma, valida versión y nombre, y genera en `dist-windows`: el Setup, `SHA256SUMS.txt`, `connector-release.json` y las notas. También actualiza `..\public\connector-release.json` con una URL inmutable predecible bajo `releases/download/v<version>/...`. No publica ni usa credenciales.

Para firma Authenticode futura, configura fuera del repositorio `WINDOWS_SIGN_CERT_PATH`, `WINDOWS_SIGN_CERT_PASSWORD` y, opcionalmente, `WINDOWS_SIGN_TIMESTAMP_URL`/`SIGNTOOL_PATH`. Sin certificado el build continúa con una advertencia. La firma ayuda a identificar al editor; SmartScreen también depende de reputación y no se promete que sus avisos desaparezcan de inmediato.

Publicación manual: revisa los cuatro artifacts, crea manualmente el Release `v0.3.0` en `jannpierrproyectos/audio-evaluaciones-medicas`, sube únicamente Setup y `SHA256SUMS.txt`, copia las notas generadas, publica el Release y despliega después el manifest ya generado en Vercel. No reemplaces un binario publicado bajo la misma versión: cualquier cambio exige incrementar SemVer.

### Prueba manual del Setup en esta PC

1. Detén cualquier Connector de desarrollo.
2. Instala `dist-windows\AudioEvaluacionesConnector-<version>-Setup.exe`.
3. Abre **AudioEvaluaciones Connector** desde Inicio, sin abrir VS Code ni ejecutar npm.
4. Abre `https://audio-evaluaciones-medicas.vercel.app`.
5. Ve a **Importar desde MediWeb** y confirma **Conectado**.
6. Pulsa **Abrir MediWeb** y confirma que abre Edge o Chrome con el perfil exclusivo del Connector. No descargues reportes para este smoke manual.

### Prueba en una segunda PC

1. Copia únicamente `AudioEvaluacionesConnector-<version>-Setup.exe`.
2. Instálalo y abre **AudioEvaluaciones Connector**.
3. Abre la web publicada y confirma **Conectado**.
4. No copies el repositorio, `node_modules`, Node.js ni herramientas de desarrollo.

El instalador aún no está firmado y Windows SmartScreen puede mostrar una advertencia. Esto es esperado en esta fase; no se modifican políticas de Windows. Windows Service, actualización automática y firma de código quedan fuera de esta versión.

### Prueba de upgrade 0.1.0 → 0.2.0

1. Con 0.1.0 instalada, anota que existe una sola entrada en Aplicaciones instaladas.
2. Cierra cualquier procesamiento y ejecuta el Setup 0.2.0 sin desinstalar primero.
3. Abre el Connector y confirma el icono junto al reloj, `/health` versión 0.2.0 y **Conectado** en Vercel.
4. Comprueba que `config.json` y el perfil `auth` siguen presentes.
5. Comprueba que Documentos conserva las descargas y que sigue existiendo una sola entrada instalada.
