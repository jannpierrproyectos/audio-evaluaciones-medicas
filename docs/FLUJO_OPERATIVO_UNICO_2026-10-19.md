# Flujo operativo unico

## Composicion final

Importar MediWeb -> Verificar WhatsApp -> Revisar texto -> Convertir en audio -> Enviar manualmente.

Se retiran las cuatro pestanas principales y los atajos duplicados a pantallas de audio. El encabezado muestra progreso real con indicadores no interactivos. Cada pantalla tiene una continuacion util:

- Importacion terminada: Verificar WhatsApp; si ya hay progreso, Continuar lote recupera su etapa.
- WhatsApp: la comprobacion existente se conserva. Continuar con texto clinico abre el primer texto pendiente. Un contacto aplazado o sin WhatsApp no bloquea el audio.
- Texto y audio: editor individual, aprobacion explicita y controles masivos comparten una pantalla. En escritorio la cola masiva queda junto a la lista; en movil sigue al texto. No se aprueban narrativas automaticamente.
- Audio disponible: Continuar con envios. Los MP3 se reutilizan y la cola permanece montada al preparar una entrega.
- Envio: lote actual primero, evidencia guardada reutilizada, preparacion conjunta y declaracion final del envio manual. Otros lotes permanecen secundarios.

La etapa y la seleccion se guardan en review_ui. Recuperar no solicita sintesis ni abre WhatsApp automaticamente. Los indicadores no dan por verificado un contacto solo por avanzar de etapa.

## Archivo no encontrado

La captura del operador muestra un archivo inexistente. El codigo confirmo que el servicio de fuentes y el instalado comparten evaluations-v1, mientras las carpetas de descarga pueden ser diferentes. Esto podia dejar una referencia valida del catalogo fuera de la raiz que consultaba el servicio de desarrollo.

El servicio de fuentes ahora consulta, solo para lectura, la referencia relativa exacta en las ubicaciones conocidas: configuracion instalada, descarga instalada predeterminada y descarga de fuentes. Cada ubicacion conserva su comprobacion de limites, permisos, descifrado y AAD. No se recorren carpetas por nombre de paciente, no se mueven originales ni se vuelven a descargar. Referencias presentes en mas de una ubicacion producen FILE_LOCATION_AMBIGUOUS; una ausencia real mantiene FILE_NOT_FOUND. La interfaz muestra el diagnostico sin atribuirlo a Preview ni registrar consentimiento o envio falso.

La reserva de ventana para entregar se hace dentro del clic y usa una ventana nueva, evitando depender de una pestana de verificacion ya navegada a otro origen. Si falla la preparacion antes de navegar, solo se descarta la ventana vacia reservada. Las comprobaciones de WhatsApp mantienen su logica y sus enlaces sin texto clinico.

## Validacion

- npm test: regresiones clinicas, persistencia, Google, TTS y flujo.
- npm --prefix mediweb-downloader test: regresiones del Connector y lectura cifrada en ubicaciones conocidas.
- npm run lint y npm run build.
- node scripts/validate-delivery-flow.mjs --keep-preview: Edge, ocho personas ficticias, Connector real aislado con proteccion de Windows y voz local simulada. Capturas y resultados en artifacts/sequential-flow (no versionados).

La prueba reproduce archivo ausente, comprueba que no abre la conversacion ni guarda autorizacion, habilita la ubicacion conocida del original y prepara el mismo envio sin descargar ni sintetizar de nuevo. Compara hashes de los ocho PDF, confirma el envio ficticio y verifica avance y recuperacion de la etapa tras recargar. Tambien genera audio para una persona sin WhatsApp.

## Puesta en prueba

La web se publica solo en Preview. No se cambian Google, secretos, ElevenLabs, Hugging Face, la instalacion del Connector ni los lotes existentes. Para cargar el ajuste de rutas, el operador que usa npm run service debe cerrar ese proceso y volver a iniciarlo desde estas fuentes actualizadas. No requiere reinstalar ni borrar datos.

Una declaracion de destinatario que puede resolverse en el mismo boton aparece como pendiente, no como incidencia. Si todos los MP3 ya estan guardados, desaparece la accion de continuar una cola sin pendientes y queda como accion principal Continuar con envios.
