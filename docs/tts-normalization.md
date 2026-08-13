# Normalización de texto para TTS

`displayText` es el texto editable y nunca se reemplaza por la versión de audio. Al generar audio, `prepareTextForTts(displayText)` produce `ttsText`; el cliente envía esa copia al servicio ElevenLabs y guarda el último valor en `app_fields.texto_tts`.

## Transformaciones activas

| Entrada display | Salida TTS | Restricción |
|---|---|---|
| `IMC` | `índice de masa corporal` | Acrónimo clínico inequívoco |
| `ECG` | `electrocardiograma` | Acrónimo clínico inequívoco |
| `PA: ...` | `presión arterial: ...` | Solo ante separador/contexto de presión |
| `HDL`, `LDL`, `FEV1`, `FVC` | Deletreo controlado | Solo tokens completos |
| `mg/dL` | `miligramos por decilitro` | Unidad completa |
| `mmHg` | `milímetros de mercurio` | Unidad completa |
| `kg`, `cm`, número + `m` | Unidad en palabras | Tokens completos/contexto numérico para metros |
| `120/80 mmHg` | `ciento veinte sobre ochenta milímetros de mercurio` | La barra solo cambia cuando sigue la unidad de presión |
| `98%` | `noventa y ocho por ciento` | Enteros de 0 a 999 |
| `<`, `>`, `≤`, `≥`, `±` | Frase equivalente | Solo en TTS |

Los párrafos en mayúsculas se normalizan antes de llegar al servicio. La puntuación y los límites de párrafo se convierten en pausas mediante texto simple; no se usa SSML.

## Decimales y nombres

Los decimales conservan su representación (`24.8`) hasta contar con evidencia de pronunciación de la voz configurada. Los nombres no reciben tildes inventadas. Se admite `pronunciationOverrides` explícito y documentado, pero el motor no genera pronunciaciones automáticamente.

## Servicio sin cambios

- Engine: ElevenLabs.
- Modelo: `eleven_flash_v2_5`.
- Formato preferido: MP3 / `audio/mpeg`.
- Voice ID y secretos permanecen en servidor/servicio.
- Las pruebas validan texto y no sintetizan audio real.
