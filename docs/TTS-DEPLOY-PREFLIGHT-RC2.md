# AudioEvaluaciones RC2 — conexión directa al Space ya existente

La nueva versión **no requiere duplicar ni actualizar** el Space `JannPi/audioevaluaciones-tts` ni volver a configurar ElevenLabs.

## Modo de compatibilidad (solo Vercel Preview al principio)
En el proyecto Vercel `audio-evaluaciones-medicas`, Settings → Environment Variables, crear:
- `TTS_LEGACY_MODE` = `1` (solo **Preview**).
- `TTS_OPERATOR_PASSPHRASE` = una contraseña **privada y distinta** de más de 32 caracteres (solo Preview; NO usar `VITE_*`). Mantenerla únicamente en Vercel y el administrador de contraseñas; jamás en GitHub o mensajes.
- Reutilizar `VITE_TTS_SERVICE_URL` existente, que actualmente apunta al servicio de voz. Si el valor no es exactamente `https://jannpi-audioevaluaciones-tts.hf.space`, definir además `TTS_SERVICE_URL` = esa dirección exacta solo en Preview. El backend prioriza `TTS_SERVICE_URL`.
- NO crear `TTS_SERVICE_ACCESS_TOKEN` para el Space antiguo. El backend utiliza el modo específico sin token únicamente hacia ese hostname HTTPS. Las solicitudes de síntesis desde la web **sí** exigen sesión de operador.

En este modo el backend consulta `GET /health` para conocer proveedor y modelo. El Space antiguo no publica la identidad exacta de voz/settings; el sistema marca explícitamente la configuración como `legacy_service` y usa un fingerprint estable del Space. Esto NO detecta cambios externos de voz ni ajustes en Hugging Face: si los cambias, invalida manualmente los MP3 existentes. No modificar esa configuración durante la prueba.

## Activación y verificación
1. Tras crear las variables solo en Preview, ejecutar Redeploy en Vercel para `fix/tts-readonly-config-rc2` con las variables actualizadas. Sin tocar producción.
2. `GET /api/tts/session` en Preview debe devolver `{ "configured": true, "authenticated": false }`. No genera audio.
3. `GET /api/tts/configuration` debe devolver `provider:"elevenlabs"`, `format:"mp3"`, `settings.legacy_service:true`; no genera audio. Esto valida `/health` del Space.
4. En Preview, abrir «Acceso al audio», ingresar la contraseña de operador y revisar el estado de la sesión.
5. Generar UN solo MP3 con una evaluación autorizada: petición real facturable, nunca se lanza desde pruebas automáticas. Verificar que se conserva y se reproduce antes de aprobar producción.
6. Después de la validación, repetir las dos variables en Production y promover a producción coordinadamente; NO hacerlo antes.

## Protecciones
Solo el hostname exacto `jannpi-audioevaluaciones-tts.hf.space` y HTTPS pueden usarse sin token del servicio; cualquier otro hostname falla cerrado. La app no expone el secreto de ElevenLabs ni la contraseña institucional. El Space antiguo permanece sin cambios. La sesión compartida por contraseña no equivale a trazabilidad nominativa del operador.

## Tests
`npm run build` ejecuta regresiones de autenticación y modo legacy antes de Vite. No llaman a ElevenLabs.
