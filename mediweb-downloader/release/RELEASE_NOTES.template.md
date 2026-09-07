# AudioEvaluaciones Connector {{VERSION}}

Novedades:
- Soporte para el flujo asistido y manual de WhatsApp de AudioEvaluaciones.
- Apertura segura en Explorer del PDF completo y del MP3 preparado.
- Persistencia local y deduplicación SHA-256 del audio generado.
- Nuevos endpoints `POST /files/audio`, `POST /files/validate` y `POST /files/reveal`.
- Asociación del PDF completo con cada trabajador mediante un identificador relativo controlado.

Seguridad:
- Los archivos se limitan a la carpeta de descargas administrada por AudioEvaluaciones.
- Protección frente a path traversal, rutas absolutas o UNC, y escapes mediante symlinks/junctions.
- Allowlist estricta de `.pdf` y `.mp3`, límite de 25 MB para audio y validación `Origin`/CORS.
- Explorer se ejecuta con argumentos separados y sin shell.
- Sin automatización de WhatsApp, API de Meta ni publicación de archivos médicos.

Integridad:
SHA-256: {{SHA256}}
