# AudioEvaluaciones

Proyecto web para generar texto y audio a partir de Google Sheets, Excel o PDF de evaluaciones medicas.

## TTS externo

La web no ejecuta el motor TTS directamente. Consume un endpoint interno `/api/tts/synthesize`, que a su vez reenvia la solicitud a un microservicio externo configurado con `TTS_SERVICE_URL`.

El contrato esperado del microservicio esta documentado en [docscode/tts-service-contract.md](docscode/tts-service-contract.md).
