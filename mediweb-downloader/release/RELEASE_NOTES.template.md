# AudioEvaluaciones Connector {{VERSION}}

Novedades:
- Corrige el inicio de descargas de solo primeras hojas o solo reportes completos: las carpetas declaradas existen antes de validar permisos. Permite repetir los tres modos sin usar el historial como bloqueo.
- PDF y MP3 normales, permanentes y con el nombre del paciente en Documentos/PDF y Documentos/MP3 dentro de la carpeta de descargas. Recupera documentos anteriores sin descargas ni sintesis nuevas.
- Importa revisiones de evaluaciones ya descargadas como versiones nuevas pendientes de revision, sin bloquear el lote ni sobrescribir aprobaciones o audios anteriores.
- Muestra el motivo seguro de una discrepancia de importacion en vez de un error generico.
- Reconoce los MP3 aprobados con la politica actual, independiente de WhatsApp y del destinatario. Recupera audios sin otra sintesis.
- Recupera originales cifrados de las descargas hechas anteriormente por el servicio de fuentes, sin moverlos ni descargarlos otra vez.
- PDF y MP3 preparados con el nombre del trabajador.
- Importacion manual sin exigir un formulario de filtros guardable; reconoce la pestana de resultados del Connector.
- Permite descargar nuevamente una busqueda sin bloquearla por descargas anteriores.
- Saludo institucional preparado para la apertura del chat de entrega; comprobacion de WhatsApp sin mensaje.
- Conserva lotes, archivos cifrados, clave DPAPI y configuracion existente al actualizar sobre la instalacion anterior.

Seguridad:
- Esta versión de prueba se distribuye SIN firma digital Authenticode. Windows puede mostrar «Editor desconocido» o una advertencia de SmartScreen. Verifica que la descarga provenga del Release oficial y confirma la instalación manualmente.
- Los archivos se limitan a la carpeta de descargas administrada por AudioEvaluaciones.
- Protección frente a path traversal, rutas absolutas o UNC, y escapes mediante symlinks/junctions.
- Allowlist estricta de `.pdf` y `.mp3`, límite de 25 MB para audio y validación `Origin`/CORS.
- Explorer se ejecuta con argumentos separados y sin shell.
- Sin automatización de WhatsApp, API de Meta ni publicación de archivos médicos.

Integridad:
SHA-256: {{SHA256}}
