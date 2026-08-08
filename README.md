# AudioEvaluaciones

Proyecto web para generar texto y audio a partir de Google Sheets, Excel o PDF de evaluaciones medicas.

## TTS externo

La web no ejecuta el motor TTS directamente. Consume un endpoint interno `/api/tts/synthesize`, que a su vez reenvia la solicitud a un microservicio externo configurado con `TTS_SERVICE_URL`.

El contrato esperado del microservicio esta documentado en [docscode/tts-service-contract.md](docscode/tts-service-contract.md).

## Importación local desde MediWeb

La pestaña **Importar PDF** permite elegir entre un archivo local y **Importar desde MediWeb**. La segunda opción se comunica directamente desde el navegador con AudioEvaluaciones Connector, que debe estar ejecutándose en Windows:

```powershell
cd C:\Users\USER\Documents\AudioEvaluaciones\mediweb-downloader
npm run service
```

En desarrollo, el conector está disponible de forma predeterminada en `http://127.0.0.1:8765`. La URL puede configurarse sin secretos mediante:

```dotenv
VITE_MEDIWEB_SERVICE_URL=http://127.0.0.1:8765
```

El inicio de sesión y la búsqueda en MediWeb siguen siendo manuales. AudioEvaluaciones solo recibe conteos agregados durante la detección y el PDF de primeras hojas cuando el usuario pulsa **Procesar en AudioEvaluaciones**. Ese PDF entra al mismo parser y flujo clínico que una carga manual.
