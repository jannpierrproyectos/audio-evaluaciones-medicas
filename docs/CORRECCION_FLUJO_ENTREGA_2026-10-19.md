# Correccion del flujo de audio y entrega

## Causas y cambios

- El boton masivo quedaba oculto hasta pulsar Calcular audios pendientes. Ahora Generar audios masivos prepara y ejecuta la cola en una accion explicita, con bloqueo inmediato de doble clic, reservas persistentes y reutilizacion de MP3. Recuperar una cola no inicia solicitudes automaticamente.
- Revisar destinatarios seleccionaba evaluaciones bloqueadas por consentimiento, aunque WhatsApp ya estaba comprobado. Ahora la cola de comprobacion avanza entre pendientes de WhatsApp; el consentimiento sigue siendo independiente.
- La bandeja remit?a al operador a controles de autorizacion que ya se habian retirado. Ahora ofrece Confirmar destinatario y preparar envio cuando falta evidencia real. El texto del boton declara identidad, permiso real del canal y PDF de esa evaluacion. No incluye casilla ni fecha, no deduce consentimiento de WhatsApp y reutiliza la evidencia vigente. Los telefonos compartidos requieren una declaracion contextual especifica.
- La declaracion utiliza los endpoints existentes y el catalogo cifrado, valida PDF y binding dos veces y respeta conflictos de revision. Para el lote abierto se guarda mediante la misma cola de actualizaciones que el audio; otros lotes usan revision optimista independiente.
- Se conectan revision y WhatsApp con Audios masivos y Preparar entregas. La bandeja prioriza el lote abierto y avanza a la siguiente entrega resoluble tras la declaracion de envio completo.
- Preparar abre la conversacion, copia el mensaje y muestra los adjuntos. Solo Confirmo que envie mensaje, PDF y MP3 registra un envio completo. Los resultados parciales o inciertos conservan su conciliacion explicita.

## Interacciones

| Operacion | Antes | Ahora |
|---|---|---|
| Iniciar audio masivo desde Audios | Calcular + generar | Generar audios masivos |
| Continuar desde WhatsApp | Volver + buscar etapa | Preparar entregas / Ir a audios masivos |
| Autorizacion ausente con WhatsApp guardado | Sin salida operativa | Una declaracion contextual que guarda y prepara |
| Entrega lista | Preparar y confirmar envio completo | Dos acciones, con adjunto y envio manual en WhatsApp entre ellas |

## Validacion reproducible

- `npm test`
- `npm run lint`
- `npm run build`
- `node scripts/validate-delivery-flow.mjs --keep-preview`

El ultimo comando inicia Edge y un Connector real de codigo en un directorio temporal aislado, con DPAPI y ACL de Windows. MediWeb y la voz se sustituyen por datos ficticios. No conecta el Connector instalado ni servicios de pago. Capturas e informe: `artifacts/delivery-flow/` (no versionados).

Google, credenciales, ElevenLabs, Hugging Face y el Connector instalado no se modifican. La publicacion de esta correccion se prepara en Preview, sin promover a produccion.

## Evidencia

La prueba visual cubre importacion de ocho PDF completos ficticios, recuperacion sin escritura del catalogo, fallo STORE_BUSY diagnosticado, aprobacion individual, audio individual sin WhatsApp y generacion masiva de siete nuevos MP3 con reutilizacion del primero. Tambien comprueba WhatsApp guardado sin casillas, declaracion contextual de destinatario, preparacion sin confirmaciones de envio inventadas, declaracion explicita de envio completo, avance al segundo trabajador y conservacion tras recargar. Los hash de los ocho PDF originales se comparan antes y despues.

La web oficial se comprueba por separado en Edge sin acceder a datos locales: Google configurado, retorno oficial, PKCE, sintesis anonima rechazada, sin contrasena ni casilla de busqueda antigua y sin solicitudes automaticas de voz.
