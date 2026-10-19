# Audio en la web pública

La comprobación de solo lectura del 18 de octubre de 2026 en
`https://audio-evaluaciones-medicas.vercel.app` devolvió:

- `/api/tts/session`: `configured: true`, `authenticated: false`.
- `/api/tts/configuration`: ElevenLabs, `eleven_flash_v2_5`, MP3.

El servicio público está configurado. La ausencia de configuración detectada en
desarrollo local no describía el estado de producción. No se generó voz real.

## Vinculación inicial del navegador

La rama incorpora `/api/tts/device`. Un administrador crea un enlace privado,
válido durante diez minutos y exclusivamente para el origen indicado. El enlace
no contiene la clave de ElevenLabs ni la clave de administración. Su posesión
permite vincular un navegador durante esos diez minutos: no es un enlace público
ni un token de un solo uso. No se debe compartir, guardar en Git ni registrar.

Después de publicar y validar esta rama en una **Preview**, ejecutar en la terminal:

```powershell
node scripts/create-tts-device-link.mjs https://URL-DE-LA-PREVIEW.vercel.app
```

La terminal solicita, sin mostrarla ni guardarla, la clave ya existente en Vercel
`TTS_OPERATOR_PASSPHRASE`. No pegarla en el chat ni escribirla como argumento del
comando. No se cambia ninguna credencial. Abrir el enlace resultante en el
navegador habitual. Para producción se utiliza el mismo comando con
`https://audio-evaluaciones-medicas.vercel.app`, **solo después de validar y publicar
allí la versión corregida**. El endpoint aún no existe en la versión anterior.

La página intercambia el enlace por una cookie `Secure`, `HttpOnly`,
`SameSite=Strict`, borra el fragmento de la URL y vuelve a la aplicación. El
fragmento no se transmite en peticiones HTTP, parámetros, referencias ni logs
de acceso. El token temporal existe transitoriamente en la página de activación,
sin persistirse en almacenamiento accesible por JavaScript. La página usa CSP
con nonce y no carga scripts externos.

## Uso habitual y límites reales

La sesión dura treinta días y se renueva al consultar la sesión o la configuración
para generar audio. Mientras el operador use ese navegador dentro del plazo, no
hay otro inicio de sesión ni contraseña por audio, lote o reinicio del navegador.
Tras treinta días sin uso, borrar cookies, cerrar sesión o cambiar de navegador,
se necesita otra vinculación. La navegación privada no conserva el acceso.

Una solicitud pública sin cookie válida sigue rechazándose antes de llamar al
proveedor. La aprobación clínica continúa siendo individual; los controles de
WhatsApp y autorización de entrega no bloquean la síntesis. Un rechazo explícito
por falta de vinculación libera la reserva sin marcar la síntesis como incierta.

El cierre de sesión existente elimina la cookie de ese navegador. Cambiar la
clave administrativa invalida todas las sesiones y enlaces anteriores. Este
mecanismo mantiene la limitación del sistema previo: no identifica nominalmente
al operador ni permite revocar un dispositivo individual desde un catálogo.

## Validación sin créditos

`node scripts/check-tts-device-browser.mjs` usa Edge real y los handlers públicos
sin pasar por la excepción de desarrollo local. El TTS es un servidor HTTP ficticio
aislado. Comprueba vinculación, cookie inaccesible a JavaScript, recuperación del
acceso en otro contexto con las cookies del navegador y rechazo de solicitudes
anónimas sin consumir voz. Las pruebas unitarias comprueban enlace manipulado,
origen distinto, vencimiento, renovación y revocación por cambio de clave.

No se ha desplegado esta modificación ni cambiado producción, ElevenLabs,
credenciales o el Connector instalado.
