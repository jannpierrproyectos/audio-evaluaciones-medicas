# Flujo operativo 0.6.0-rc.3

Esta version aplica las ultimas instrucciones del operador y sustituye las propuestas anteriores de historial visible y declaraciones de envio.

- Importacion: la descarga por pasos vuelve a ser la pantalla principal. Ambos es la opcion inicial para obtener evaluaciones y PDF completos. Al terminar se abren las evaluaciones automaticamente; el boton siguiente lleva a WhatsApp.
- Nuevas descargas: se puede volver a descargar la misma busqueda. No se restaura el ultimo proceso ni se muestra historial en la interfaz. Los originales existentes no se borran.
- WhatsApp: se mantiene la comprobacion masiva existente y la reutilizacion de evidencia vigente. No se envia mensaje al verificar un numero.
- Texto y audio: revision individual explicita y generacion individual/masiva en la misma pantalla. La existencia de WhatsApp no bloquea el MP3. Se mantienen las reservas de solicitudes TTS para evitar cobros duplicados.
- Entrega: preparar abre el chat con el saludo institucional y muestra PDF/MP3 con nombre del trabajador. No exige permiso del portapapeles para preparar los archivos. Copiar mensaje queda opcional.
- Siguiente trabajador solo navega. No exige declaraciones, formularios parciales ni registros y no marca nada como enviado. Los registros anteriores no se borran.

El almacenamiento cifrado operativo se conserva para proteger archivos, revisiones y reservas TTS. Eliminar el historial de la interfaz no elimina datos clinicos del equipo. La actualizacion instalada consulta tambien las ubicaciones anteriores registradas por checkpoints del servidor, sin mover originales ni admitir rutas arbitrarias del navegador.

El instalador se genera mediante el flujo existente Windows Connector build: pruebas, construccion, smoke aislado, SHA-256, publicacion del asset y solo despues actualizacion del manifiesto de descarga de la web. No se modifica ElevenLabs, Hugging Face ni la autenticacion Google.
