# Acceso al audio con Google

Esta implementación sustituye, cuando se configura Google, la contraseña de
AudioEvaluaciones y los enlaces privados de vinculación. La única cuenta
autorizada para solicitar TTS es `jannpierr.proyectos@gmail.com`, con correo
verificado por Google. Se puede iniciar sesión desde distintas computadoras.

## 1. Google Cloud: configurar primero el entorno de pruebas

1. Abrir <https://console.cloud.google.com/> con la cuenta indicada y crear un
   proyecto para las pruebas de AudioEvaluaciones.
2. Abrir **Google Auth Platform → Branding**. Indicar el nombre AudioEvaluaciones,
   correo de soporte y correo de contacto del administrador.
3. En **Audience**, elegir **External**, mantener el estado de pruebas y agregar
   `jannpierr.proyectos@gmail.com` a los usuarios de prueba.
4. En **Data Access**, usar únicamente identidad y correo (`openid`, `email`). No
   habilitar Gmail, Drive ni otros permisos para esta integración.
5. En **Clients → Create client**, elegir **Web application**.
6. Registrar en **Authorized redirect URIs** la dirección exacta de la Preview:
   `https://URL-EXACTA-DE-PREVIEW.vercel.app/api/auth/google-callback`.
   No usar comodines. No se necesita un origen de JavaScript porque el intercambio
   de códigos se realiza íntegramente en el servidor.
7. Guardar el **Client ID** y **Client secret** en el administrador de contraseñas
   o directamente en Vercel. No poner el secreto en el chat, Git, `.gitignore`,
   código React, variables `VITE_*` ni capturas.

Al preparar producción, utilizar su proyecto/cliente OAuth según las políticas de
Google, con el retorno exacto:
`https://audio-evaluaciones-medicas.vercel.app/api/auth/google-callback`.
Añadir un retorno en Google Cloud no modifica la web ni la despliega.

## 2. Vercel: variables solo del backend

En **Project → Settings → Environment Variables**, configurar primero únicamente
**Preview**, preferiblemente limitado a `ux/flujo-operativo-simplificado`:

| Variable | Valor |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | ID del cliente OAuth web de pruebas |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Secreto del cliente OAuth web de pruebas |
| `GOOGLE_OAUTH_REDIRECT_URI` | URL exacta de retorno registrada para esa Preview |
| `GOOGLE_AUTH_SESSION_SECRET` | Secreto nuevo aleatorio de al menos 32 caracteres |

Para crear un secreto nuevo en tu propia terminal, sin escribirlo como argumento:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copiar el resultado exclusivamente en Vercel. No reutilizar la clave de operador
anterior, expuesta durante la conversación. Las claves actuales de ElevenLabs y
del servicio de voz permanecen intactas y solo en backend.

Después de configurar las variables, desplegar nuevamente la **Preview**, nunca
producción durante esta validación. La URL base configurada debe corresponder a
esa misma Preview; no se infiere a partir de cabeceras de un visitante.

## 3. Validación real pendiente de las credenciales

1. Abrir la Preview: debe aparecer **Continuar con Google**.
2. Seleccionar `jannpierr.proyectos@gmail.com`; debe aparecer **Cuenta conectada**.
3. Recargar y reiniciar el navegador: debe conservar el acceso.
4. Cerrar sesión; intentar otra cuenta: debe denegarse.
5. Una solicitud de síntesis sin sesión debe devolver 401 antes de llamar al TTS.
6. Verificar audios individuales y masivos con un TTS ficticio. No consumir
   ElevenLabs durante las pruebas automatizadas.

No se ha configurado Google Cloud ni cambiado Vercel desde este trabajo. Hasta
que existan las credenciales y se publique la Preview, el acceso real con Google
no se puede validar ni se presenta como terminado en la web pública.

## Comportamiento y protección

- Flujo de código de autorización con PKCE S256, estado, nonce y transacción de
  diez minutos ligada al navegador mediante cookie HttpOnly SameSite=Lax.
- La biblioteca oficial `google-auth-library` verifica firma, emisor, audiencia y
  vencimiento. Se comprueban también nonce, correo verificado, cuenta permitida,
  sujeto estable y, cuando existe, la parte autorizada (`azp`).
- Solo se guarda una sesión propia firmada con el sujeto estable de Google. No se
  conservan tokens de acceso, ID ni renovación de Google en React, localStorage,
  cookies de JavaScript, el Connector o el catálogo clínico.
- Cookie de sesión HttpOnly, Secure en HTTPS y SameSite=Strict. Dura treinta días
  y se renueva con el uso. Tras borrar cookies o treinta días sin uso se vuelve a
  entrar con Google; no hay contraseña propia ni enlaces de vinculación.
- Al activar variables OAuth, las sesiones de contraseña y enlaces antiguos no
  autorizan TTS. Tampoco lo autorizan el token institucional o la excepción de
  desarrollo local. Una configuración Google incompleta falla cerrada.
- La aprobación clínica, las reservas contra cargos duplicados, el MP3 cifrado y
  la independencia respecto de WhatsApp se conservan. Un 401 previo al proveedor
  libera la reserva en lugar de dejarla como solicitud incierta.
- El acceso Google protege la generación de audio; no cambia el mecanismo de
  protección y almacenamiento del Connector instalado ni añade acceso remoto a
  los archivos clínicos de otra PC. Esos archivos siguen en el equipo original.

## Pruebas reproducibles

```powershell
node --test test/google-auth.test.js
node scripts/check-google-auth-browser.mjs
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

La prueba de Edge utiliza React, los handlers reales y la verificación RSA real
de la biblioteca oficial. Sustituye únicamente al proveedor externo por datos y
claves ficticios, e intercepta el acceso al Connector instalado. No equivale a
haber iniciado sesión en Google Cloud con credenciales reales. Las capturas y
resultados se generan en `artifacts/google-auth/`.

Se añade la biblioteca oficial de Google únicamente al backend: evita construir
un verificador JWT propio. No se añade un servicio de identidad de pago, una base
de datos ni una librería visual.

Fuentes oficiales: [flujo de servidor](https://developers.google.com/identity/protocols/oauth2/web-server),
[verificación de identidad](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token),
[políticas OAuth](https://developers.google.com/identity/protocols/oauth2/policies).
