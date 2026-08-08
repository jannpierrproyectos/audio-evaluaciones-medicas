# AudioEvaluaciones

Proyecto web para generar texto y audio a partir de Google Sheets, Excel o PDF de evaluaciones medicas.

## AudioEvaluaciones Connector para Windows

**AudioEvaluaciones Connector** es el componente local que permite a la web importar reportes desde MediWeb. Solo debe instalarse en las PC Windows que usarán esa integración; la carga de archivos locales y las demás funciones de AudioEvaluaciones no lo necesitan.

El Connector escucha únicamente en `127.0.0.1`, abre Microsoft Edge (o Google Chrome como respaldo) con un perfil exclusivo y mantiene la sesión local. El inicio de sesión es manual: no solicita, lee ni almacena la contraseña de MediWeb. Los reportes se guardan en `Documentos\AudioEvaluaciones\Descargas`, no en la instalación ni en Vercel.

El instalador incluye su propio runtime de Node.js. El usuario final abre **AudioEvaluaciones Connector** desde el menú Inicio y no necesita Node.js, npm, Git, VS Code, PowerShell ni Inno Setup. Consulta [mediweb-downloader/README.md](mediweb-downloader/README.md) para construir y probar el instalador.

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

## Uso de MediWeb desde la aplicación publicada

AudioEvaluaciones puede estar alojada mediante HTTPS en Vercel mientras AudioEvaluaciones Connector se ejecuta en la PC Windows del usuario. El `fetch` sale directamente del navegador hacia `http://127.0.0.1:8765`: no pasa por Vercel, no existe un proxy `/api/mediweb` y el Connector nunca se publica en Internet. En el build de producción debe configurarse explícitamente:

```dotenv
VITE_MEDIWEB_SERVICE_URL=http://127.0.0.1:8765
```

El código usa ese mismo valor por defecto si la variable no existe. La variable no es secreta y no se mezcla con la configuración TTS.

El origen estable `https://audio-evaluaciones-medicas.vercel.app` ya está autorizado por la configuración segura predeterminada. No se aceptan comodines ni todos los subdominios de Vercel; una URL preview distinta debe autorizarse de forma explícita. Si posteriormente se utiliza, por ejemplo, `https://audio.innomedic.pe`, ese origen también deberá añadirse.

```powershell
cd C:\Users\USER\Documents\AudioEvaluaciones\mediweb-downloader
$env:MEDIWEB_ALLOWED_ORIGINS="http://localhost:5173,http://127.0.0.1:5173,https://ORIGEN-VERCEL-EXACTO"
npm run service
```

Chrome puede solicitar al usuario permiso para que el sitio publicado acceda a servicios de la red local. AudioEvaluaciones muestra un mensaje recuperable si el navegador deniega la comunicación, pero la autorización final solo puede validarse en un navegador real. No se almacenan en React usuario, contraseña, cookies ni tokens de MediWeb; la sesión manual permanece exclusivamente en el navegador local controlado por el Connector.
