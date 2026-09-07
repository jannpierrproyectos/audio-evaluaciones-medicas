# Normalización de texto para TTS

`displayText` es el texto editable y nunca se reemplaza por la versión de audio. Al generar audio, `prepareTextForTts(displayText)` produce `ttsText`; el cliente envía esa copia al servicio ElevenLabs y guarda el último valor en `app_fields.texto_tts`.

## Transformaciones activas

| Entrada display | Salida TTS | Restricción |
|---|---|---|
| `IMC` | `índice de masa corporal` | Acrónimo clínico inequívoco |
| `ECG` | `electrocardiograma` | Acrónimo clínico inequívoco |
| `PA: ...` | `presión arterial: ...` | Solo ante separador/contexto de presión |
| `HDL`, `LDL`, `FEV1`, `FVC` | Deletreo controlado | Solo tokens completos |
| `kg`, `cm`, `kg/m²` | `kilogramos`, `centímetros`, `kilogramos por metro cuadrado` | Unidades antropométricas inequívocas |
| `mg/dL`, `g/dL` | `miligramos por decilitro`, `gramos por decilitro` | Conserva la unidad clínica presente en display |
| `mmHg`, `dB`, `%` | `milímetros de mercurio`, `decibeles`, `por ciento` | Solo en `ttsText` |
| `120/80 mmHg` | `ciento veinte sobre ochenta milímetros de mercurio` | Lectura completa de presión arterial |
| `14.2` | `catorce punto dos` | Decimal clínico de un dígito |
| `32.17` | `treinta y dos punto diecisiete` | La fracción sin cero inicial se verbaliza como número completo |
| `1.05` | `uno punto cero cinco` | Los ceros iniciales de la fracción se preservan verbalmente |
| `<`, `>`, `≤`, `≥`, `±` | Frase equivalente | Solo en TTS |

Los párrafos en mayúsculas se normalizan antes de llegar al servicio. La puntuación y los límites de párrafo se convierten en pausas mediante texto simple; no se usa SSML.

## Decimales y nombres

Los decimales clínicos de hasta tres dígitos enteros se verbalizan de forma determinística. La fracción se lee como un número completo cuando no empieza por cero (`32.17` pasa a `treinta y dos punto diecisiete`). Si contiene ceros iniciales, se leen sus dígitos para no alterar la precisión comunicada (`1.05` pasa a `uno punto cero cinco`). Los nombres no reciben tildes inventadas. Se admite `pronunciationOverrides` explícito y documentado, pero el motor no genera pronunciaciones automáticamente.

La política de unidades se aplica solo al `ttsText`: el `displayText` conserva las unidades clínicas originales para lectura y edición. El normalizador es idempotente, de modo que el paso defensivo del cliente no duplica unidades ya expandidas.

## Servicio sin cambios

- Engine: ElevenLabs.
- Modelo: `eleven_flash_v2_5`.
- Formato preferido: MP3 / `audio/mpeg`.
- Voice ID y secretos permanecen en servidor/servicio.
- Las pruebas validan texto y no sintetizan audio real.
