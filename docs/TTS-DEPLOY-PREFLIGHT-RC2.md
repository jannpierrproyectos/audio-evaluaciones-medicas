# AudioEvaluaciones RC2 — activación de TTS real sin cortar producción

## Implementado en esta rama

- GET /api/tts/configuration: consulta de solo lectura con credencial de servicio únicamente en backend.
- POST /api/tts/synthesize: requiere servicio TTS protegido y sesión de operador o proxy institucional autenticado.
- POST /api/tts/session: inicio de sesión con contraseña del operador. La web recibe una cookie firmada HttpOnly, SameSite=Strict, Secure por HTTPS; no expone tokens de backend en React.
- La aplicación comprueba la sesión **antes** de reservar una solicitud de audio que podría ser cobrada.
- Tests sin llamadas reales al proveedor: `test/tts-session.test.js`, `test/tts-readonly-config.test.js`. El comando `npm run build` ejecuta ambos antes de Vite.

## Pendientes obligatorios

1. **No modificar todavía el Space de Hugging Face que consume la web antigua.** Actualizarlo con el requisito de token rompería su integración anterior. Crear primero un Space de prueba (o un despliegue aislado) con el código `tts-service/` de esta rama, su configuración privada de ElevenLabs y un nuevo token secreto `TTS_SERVICE_ACCESS_TOKEN` de al menos 32 caracteres.
2. En Vercel (entorno Preview), definir `TTS_SERVICE_URL` apuntando al nuevo Space de prueba por HTTPS; `TTS_SERVICE_ACCESS_TOKEN` igual al token del Space; y una contraseña **distinta** `TTS_OPERATOR_PASSPHRASE` de al menos 32 caracteres. No usar variables `VITE_*` para contraseñas ni tokens. Las contraseñas existentes de ElevenLabs permanecen en Hugging Face.
3. Desplegar de nuevo la rama `fix/tts-readonly-config-rc2` en Preview para recoger esas variables. Comprobar `GET /api/tts/configuration` (provider=elevenlabs, format=mp3) y `GET /api/tts/session` (configured=true, authenticated=false). Esos GET no consumen créditos.
4. Iniciar sesión mediante el panel «Acceso al audio». Verificar un MP3 real solo con evaluación, destinatario y autorizaciones correspondientes. Esa solicitud sí puede consumir créditos de ElevenLabs.
5. Una vez aprobada la validación Preview, migrar a producción de forma coordinada y retirar la integración antigua si deja de usarse. **No desplegar a producción antes de completar la prueba real.**

La sesión de acceso compartido es una puerta de entrada técnica, no sustituye una identificación nominativa y auditoría institucional del operador. La clínica requiere verificación y aprobación independiente.

## Pruebas locales (Windows CMD)

```cmd
node --test test/tts-session.test.js test/tts-readonly-config.test.js
npm.cmd run build
```
