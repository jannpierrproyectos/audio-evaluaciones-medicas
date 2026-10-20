# Archivos persistentes y nombres de entrega

Los PDF completos se conservan cifrados en la carpeta de descargas del Connector, dentro de cada lote en `reportes-completos`. En modo de fuentes la raiz predeterminada es `mediweb-downloader/downloads`; en modo instalado es `%USERPROFILE%/Documents/AudioEvaluaciones/Descargas`, salvo configuracion personalizada. El formato cifrado conserva la extension `.pdf`, pero se abre mediante el Connector.

Los audios originales se guardan como binarios `.enc` junto al catalogo en `%LOCALAPPDATA%/AudioEvaluacionesConnector/evaluations-v1`. `attachments-v1`, dentro de ese almacen, contiene las copias cifradas para preparar entregas. Las copias legibles para adjuntar estan en `%LOCALAPPDATA%/AudioEvaluacionesConnector/temporary-attachments-v1`; solo estas caducan a los quince minutos. Su caducidad no elimina los originales.

Los adjuntos preparados ahora llevan el nombre del destinatario validado, por ejemplo `01_Evaluacion_Persona_Ficticia.pdf` y `02_Audio_Persona_Ficticia.mp3`. La descarga individual del MP3 tambien usa el nombre del trabajador, incluso al recuperar un lote. No se cambian las referencias de los originales, la huella del audio, el contenido, las aprobaciones ni las verificaciones.

La sesion temporal registra el nombre saneado antes de escribir el adjunto; la limpieza solo admite el nombre declarado y los nombres genericos antiguos. Mantiene la comprobacion de permisos, enlaces simbolicos, hash, vigilante y tiempo maximo. Se rechaza contenido ajeno antes de borrar ningun archivo.

## Connector instalado antiguo

Actualizar la web no actualiza el proceso local. Una instalacion antigua puede seguir atendiendo el puerto 8765 aunque se haya trabajado antes con el servicio de fuentes. Su politica antigua incluye el destinatario en la huella del MP3 y no reconoce correctamente audios generados con la politica actual, que separa audio y entrega. Tampoco interpreta las declaraciones pendientes con el mismo detalle que la web actual.

Para probar estas fuentes, salir del Connector instalado desde su icono de bandeja antes de iniciar `npm.cmd --prefix mediweb-downloader run service`. No desinstalar, copiar archivos individuales sobre la instalacion, borrar lotes ni regenerar audios para resolver la incompatibilidad. La carpeta persistente de evaluaciones es la misma; el servicio de fuentes tiene lectores para los originales en las ubicaciones conocidas.

## Validacion

- Regresiones de entrega, archivos administrados, ubicaciones conocidas y adjuntos temporales.
- Persistencia y recuperacion de MP3 y cola masiva sin segunda sintesis.
- Nombres con tildes, caracteres Windows invalidos, rutas, controles y limites de longitud.
- Vencimiento y reinicio de copias con nombre, conservando PDF y MP3 originales.
- Prueba aislada con DPAPI, permisos y vigilante reales de Windows, PDF/MP3 ficticios y ninguna llamada externa.

Estos cambios no modifican la instalacion existente ni publican la web automaticamente.

El saludo institucional existente se precarga mediante el parametro text del enlace de WhatsApp solo al preparar o abrir una entrega validada. La comprobacion de existencia sigue abriendo exclusivamente el telefono, sin mensaje. Precargar y copiar el saludo no registra ninguna parte como enviada: la declaracion de envio sigue siendo manual.
