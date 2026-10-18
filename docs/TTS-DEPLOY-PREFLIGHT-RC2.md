# TTS: despliegue seguro de AudioEvaluaciones 0.6.0-rc.2

## Alcance de esta corrección

La consulta `GET /api/tts/configuration` ahora es de solo lectura y no requiere el token institucional del operador. El backend sigue exigiendo su propio `TTS_SERVICE_ACCESS_TOKEN` antes de solicitar esa configuración a FastAPI. El endpoint `POST /api/tts/synthesize` **mantiene** sus dos controles: autorización institucional en Vercel y autenticación backend a TTS. No se envían credenciales privadas en React ni se permite síntesis anónima.

## Integración pendiente, no publicar en producción aún

1. Confirmar que el servicio FastAPI externo implementa `GET /configuration`, `POST /synthesize` y un token `TTS_SERVICE_ACCESS_TOKEN` compatible. La versión antigua puede no exponer `/configuration`. Un 404 en la página antigua no significa fallo de ElevenLabs.
2. Configurar **el mismo token backend→backend** en FastAPI y en Vercel, exclusivamente como variable de entorno privada. No escribirlo en GitHub, React ni `VITE_*`.
3. Incorporar autenticación real del operador (sesión institucional o proxy autenticado) antes de POST. El secreto `INSTITUTIONAL_PROXY_TOKEN` no puede enviarse desde una web pública; no introducirlo en código cliente ni variables `VITE_*`. La autorización clínica y del destinatario siguen siendo obligatorias.
4. Configurar `TTS_SERVICE_URL` del lado del servidor. La variable heredada `VITE_TTS_SERVICE_URL` se conserva temporalmente por compatibilidad con el hosting anterior, pero se recomienda `TTS_SERVICE_URL` para servicio privado.
5. Validar primero el despliegue Preview protegido. Preview privado no implica que el dominio de producción esté protegido. No publicar hasta implementar la autenticación de POST y comprobar el acceso remoto.
6. Una vez configurado, `GET /api/tts/configuration` devuelve `provider`, `model`, `voice_ref`, `format: mp3`, `contract: 1`. Este GET no sintetiza audio. No realizar pruebas pagadas hasta comprobar los controles.

## Regresión

`node --test test/tts-readonly-config.test.js`: usa únicamente identidades ficticias. Comprueba que la metadata pueda consultarse sin token del operador en un backend correctamente configurado, pero que la síntesis rechace solicitudes sin autorización. Configuraciones inseguras siguen cerradas.
