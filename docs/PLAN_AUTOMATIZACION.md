# Plan de automatización — AudioEvaluaciones

**Documento:** `docs/PLAN_AUTOMATIZACION.md`  
**Versión del plan:** 1.0  
**Fecha:** 17 de octubre de 2026  
**Estado:** Plan de implementación; **no** describe funciones ya desarrolladas  
**Repositorio:** `jannpierrproyectos/audio-evaluaciones-medicas`  
**Entorno principal:** Windows, React + Vite, AudioEvaluaciones Connector (Node.js/Playwright), servicio TTS FastAPI y ElevenLabs

> **Regla principal:** trabajar en fases pequeñas, con pruebas, sin alterar las funcionalidades existentes ni enviar información médica a destinatarios no verificados.

## 1. Objetivo

Reducir al mínimo la intervención manual al procesar evaluaciones médicas ocupacionales. La experiencia final esperada es:

1. El operador abre **AudioEvaluaciones** y ordena **Procesar lote**.
2. **MediWeb Connector** utiliza una sesión autorizada y filtros previamente configurados; cuando no sea posible, solicita intervención para iniciar sesión o preparar la búsqueda.
3. El Connector detecta atenciones elegibles y descarga los **PDF completos** y el **consolidado de primeras hojas** para su procesamiento.
4. AudioEvaluaciones extrae datos clínicos, aplica validaciones y genera **narrativas editables** por trabajador.
5. El sistema filtra teléfonos inválidos, identifica duplicados y recupera verificaciones previas vigentes.
6. El operador usa una **bandeja de verificación rápida de WhatsApp** solo para contactos pendientes. Una cuenta de WhatsApp visible **no demuestra** identidad ni autorización de entrega.
7. Se generan **MP3 por lotes únicamente para narrativas aprobadas y destinatarios autorizados**, evitando regeneraciones innecesarias y cargos evitables de ElevenLabs.
8. La **bandeja de entregas** reúne el mensaje, PDF completo y MP3 correctos por trabajador. El operador confirma el envío mediante WhatsApp Web; la aplicación registra esta confirmación de forma explícita.

**Fuentes de datos:** MediWeb es la fuente principal. La carga manual de PDF es alternativa. Google Sheets puede permanecer como opción secundaria, pero **no es la base del nuevo flujo**.

**No es objetivo de esta etapa** programar automáticamente el proceso todos los días. Tampoco introducir n8n ni automatizar envíos desatendidos mediante técnicas no oficiales de WhatsApp Web.

## 2. Estado técnico de partida (a verificar con el código local)

La versión previamente revisada de la rama `main` contiene:

- `src/App.jsx`: selección de fuente MediWeb / PDF manual, análisis de lotes y estado principal.
- `src/components/MediwebImporter.jsx`: apertura de MediWeb, detección, inicio y seguimiento de jobs, importación del consolidado.
- `mediweb-downloader/`: Connector local Windows, Playwright, paginación, descargas y modos `first`, `full`, `both`.
- `src/lib/data/pdf/analyzePdfBatch.js`: extracción, detección de plantilla y agrupación por trabajador.
- `src/components/PdfWorkersPreview.jsx`: revisión y edición narrativa, generación individual de audio y preparación manual para WhatsApp.
- `src/lib/workerReviewUx.js`: preparación de datos y estados de revisión.
- `src/lib/whatsappMessage.js`: normalización de teléfonos peruanos, mensaje de WhatsApp y comprobación manual.
- `src/lib/audioRequestGuard.js`: control de solicitudes duplicadas.
- `src/lib/ttsClient.js`: normalización del texto TTS y consumo de `/api/tts/synthesize`.
- `src/services/mediwebService.js`: comunicación del navegador con el Connector en `127.0.0.1:8765`.
- `api/tts/synthesize.js` y `tts-service/`: proxy y servicio de síntesis.

**Hallazgo prioritario:** `prepareAnalysisForReview()` se observó asignando `reviewed_by_user: true` y `needs_review: false` a trabajadores recién importados. Esa inicialización **no equivale a una aprobación humana** y debe corregirse antes de automatizar generación o entregas.

**Precaución:** este inventario es un punto de partida; Codex debe revisar primero la copia local y cualquier cambio posterior a esta revisión.

## 3. Alcance y límites funcionales

### Se automatizará

- Validación de formato telefónico y detección de duplicados.
- Preparación y navegación de una cola de verificación de destinatarios.
- Reutilización segura de verificaciones vigentes.
- Descarga y consolidación de PDFs mediante el Connector existente.
- Extracción y elaboración de narrativas clínicas iniciales.
- Clasificación automática de excepciones por datos faltantes o inconsistentes.
- Cola de generación TTS tras cumplir todas las condiciones de autorización.
- Persistencia de lotes, estados y referencias a archivos.
- Reutilización de audios sin cambios materiales, con control de versiones.
- Preparación de mensajes, PDF y MP3 para cada entrega.

### Continuará requiriendo intervención cuando corresponda

- Inicio de sesión en MediWeb o resolución de sesión expirada y controles de autenticación.
- Corrección y **aprobación clínica explícita** de narrativas; ningún proceso automático debe fingir dicha aprobación.
- Verificación visual de disponibilidad de WhatsApp cuando no exista comprobación previa vigente.
- Confirmación de la **identidad del destinatario** y de la autorización del canal; tener WhatsApp no demuestra identidad.
- Envío manual asistido por WhatsApp Web y confirmación explícita de que se realizó.
- Revisión de anomalías o errores clínicos y técnicos.

### Fuera de alcance inicialmente

- Envío masivo desatendido por WhatsApp Web sin API oficial.
- Automatización del acceso mediante credenciales o bypass de controles de MediWeb.
- Introducción de n8n como requisito de esta versión.
- Envío de datos médicos a servicios de terceros no autorizados.
- Sustitución completa del motor de descarga MediWeb o del parser clínico existente.

## 4. Arquitectura propuesta

```text
Operador (inicia lote y resuelve excepciones)
    |
    v
AudioEvaluaciones (React + Vite)
    |-- Importación MediWeb / PDF manual
    |-- Panel de lotes y revisión clínica
    |-- Verificación rápida de destinatarios
    |-- Bandeja de generación TTS
    |-- Bandeja de entregas
    |
    +--> AudioEvaluaciones Connector (Windows; localhost)
    |       |-- Sesión de MediWeb autorizada
    |       |-- Búsqueda y descargas PDF
    |       |-- Referencias seguras de archivos
    |       `-- Persistencia operativa (a diseñar)
    |
    +--> Motor clínico y parser actual
    |
    `--> /api/tts/synthesize --> FastAPI --> ElevenLabs
                                      |
                                      `--> MP3 aprobado

WhatsApp Web: apertura y adjuntos preparados;
el operador verifica destinatario y confirma envío.
```

**Límite de confianza:** el Connector escucha localmente en `127.0.0.1`. Una instancia de n8n en la nube no puede acceder directamente a ese servicio; no se deben exponer endpoints locales a Internet para sortear esta restricción.

## 5. Modelo de estados y reglas de negocio

No usar un único campo booleano para representar decisiones diferentes. Mantener separados, como mínimo:

| Dimensión | Estados sugeridos |
|---|---|
| Extracción | `pendiente`, `procesando`, `extraido`, `error` |
| Validación clínica | `pendiente`, `con_alertas`, `bloqueada`, `valida` |
| Aprobación narrativa | `pendiente`, `aprobada`, `invalidada` |
| Teléfono | `faltante`, `invalido`, `formato_valido`, `duplicado_conflictivo` |
| Disponibilidad WhatsApp | `pendiente`, `confirmado_por_operador`, `no_disponible`, `incierto` |
| Identidad y autorización | `pendiente`, `confirmada`, `no_autorizada`, `revocada` |
| Audio | `no_autorizado`, `pendiente`, `generando`, `listo`, `obsoleto`, `error` |
| Entrega | `no_preparada`, `lista`, `en_revision`, `enviada_confirmada`, `fallida` |

Los nombres son orientativos: adaptar a los contratos vigentes sin migraciones peligrosas. Si se mantiene `reviewed_by_user`, debe significar una acción humana verificable y no una inicialización automática.

**Condición para permitir TTS:**

```text
narrativa_aprobada
AND validacion_clinica_sin_bloqueos
AND whatsapp_confirmado_por_operador
AND identidad_destinatario_confirmada
AND autorizacion_de_entrega_vigente
AND pdf_y_evaluacion_vinculados
AND no_existe_audio_vigente_reutilizable
```

- Un teléfono con formato correcto **no** significa que tenga WhatsApp.
- Abrir un enlace `wa.me` **no** confirma la cuenta ni la identidad.
- Marcar manualmente «Tiene WhatsApp» no sustituye la confirmación de identidad y autorización.
- Si cambia teléfono, identidad, consentimiento, texto aprobado o información clínica relevante, invalidar las autorizaciones y los artefactos afectados según la dependencia.
- Un error bloqueante impide TTS incluso si alguien marcó el registro como «revisado».
- No generar ni enviar automáticamente audios para registros que queden en estados inciertos.

## 6. Fases de implementación

### Fase 00 — Seguridad clínica y aprobación real

**Objetivo:** eliminar aprobaciones implícitas y proteger el TTS.

**Tareas:**

1. Revisar `workerReviewUx.js`, `App.jsx`, `PdfWorkersPreview.jsx` y los módulos clínicos.
2. Eliminar la aprobación automática al importar PDFs sin reemplazarla por otra aprobación ficticia.
3. Diferenciar datos extraídos, datos validados y texto aprobado.
4. Agregar acción explícita de aprobación de narrativa, asociada a su versión.
5. Invalidar aprobación cuando cambien datos clínicos o texto relevante.
6. Centralizar la decisión `canGenerateAudio`, sin depender solo de botones deshabilitados en la UI.
7. Agregar pruebas para los caminos aprobados, no aprobados, modificados y con errores.

**Criterios de aceptación:** importar un lote no aprueba ningún registro; editar un texto aprobado lo invalida; ninguna llamada a TTS ocurre si los controles fallan; la carga manual y MediWeb continúan funcionando.

**No incluir:** persistencia nueva, n8n, envío automático, procesamiento masivo ni despliegues.

### Fase 01 — Persistencia operativa y recuperación

**Objetivo:** que los estados sobrevivan al cierre de la página, reinicio del Connector y recuperación de un lote.

**Tareas:**

1. Definir identificadores estables de lote, atención y trabajador; evitar DNI o teléfonos como claves expuestas o en logs.
2. Elegir un almacenamiento local adecuado al instalador Windows (evaluar archivos de estado con escritura atómica y permisos restringidos vs. SQLite).
3. Diseñar migraciones, respaldos, retención, permisos y recuperación.
4. Persistir referencias controladas a PDFs/MP3, no URLs `blob:` transitorias.
5. Persistir estados de revisión, verificación, autorización y entrega con marcas de tiempo.
6. Evitar duplicados por identificador de atención, versión y operación.
7. Recuperar ejecuciones interrumpidas sin repetir solicitudes pagadas.

**Criterios de aceptación:** reiniciar la web o el Connector no borra verificaciones ni estados persistidos; no se pierde correspondencia PDF–trabajador–audio; el sistema evita procesar duplicados.

**Control de privacidad:** cifrado y control de acceso donde corresponda; retención definida; sin datos clínicos en telemetría o logs.

### Fase 02 — Verificación rápida de WhatsApp

**Objetivo:** permitir revisar rápidamente los contactos aún no comprobados.

**Tareas:**

1. Reutilizar `normalizePhoneForWhatsApp()` y la lógica existente de contactos.
2. Clasificar automáticamente números faltantes, inválidos y duplicados.
3. Identificar conflictos: un mismo teléfono asociado a trabajadores diferentes.
4. Crear vista de verificación consecutiva con un contacto visible por vez.
5. Reutilizar una ventana o conversación de WhatsApp Web; no abrir docenas de pestañas.
6. Ofrecer acciones: `Tiene WhatsApp`, `No tiene`, `Incierto / revisar después`.
7. Mantener separada la comprobación de cuenta de la identidad y autorización del destinatario.
8. Recuperar verificaciones persistidas solo si corresponden inequívocamente al trabajador y teléfono, y no han vencido.
9. Proteger la UI contra clics repetidos y cambios de lote durante la revisión.

**Criterios de aceptación:** teléfonos inválidos no abren WhatsApp ni generan audio; el avance al siguiente contacto es inmediato tras registrar una decisión; los números dudosos quedan bloqueados; un conflicto de identidad se deriva a revisión.

**Nota:** no intentar detectar programáticamente si una cuenta de WhatsApp existe mediante scraping masivo ni prometer precisión que WhatsApp Web no garantiza.

### Fase 03 — Generación masiva inteligente de MP3

**Objetivo:** generar únicamente audios aprobados y evitar consumir créditos duplicados.

**Tareas:**

1. Implementar una cola de TTS con concurrencia limitada y operaciones idempotentes.
2. Comprobar nuevamente todos los requisitos **en el momento de solicitar TTS**, no solo cuando se crea la cola.
3. Registrar estado, errores, intentos y versión de la narrativa aprobada.
4. Guardar MP3 de modo persistente y seguro; utilizar `audio/mpeg` y extensión `.mp3`.
5. Calcular una huella del texto TTS normalizado junto con proveedor/modelo/voz/parámetros para decidir reutilización.
6. Mostrar estimación de caracteres/créditos antes de generar y consumo observado cuando esté disponible.
7. Evitar retries automáticos ciegos si hubo timeout después de enviar una solicitud: primero determinar si se generó el archivo.
8. Añadir pausa, reanudación y cancelación seguras sin perder el historial del lote.

**Criterios de aceptación:** registros no autorizados consumen cero créditos; repetir la operación no regenera audios vigentes; un fallo de un trabajador no detiene todo el lote; no se hacen peticiones TTS simultáneas duplicadas.

### Fase 04 — Orquestación del flujo MediWeb

**Objetivo:** reducir los clics necesarios para descargar y procesar el lote.

**Tareas:**

1. Reutilizar el motor `mediweb-downloader` y sus controles de sesión, paginación y cancelación.
2. Evaluar filtros guardados y búsqueda asistida desde la sesión ya iniciada en MediWeb.
3. Mantener inicio de sesión manual cuando sea necesario; no almacenar contraseñas ni intentar saltar MFA/CAPTCHA.
4. Utilizar `both` cuando se necesitan primeras hojas para narrativas y PDFs completos para entrega.
5. Encadenar finalización del job → importación del consolidado → extracción y revisión del lote.
6. Mostrar un panel unificado de progreso real, errores y elementos pendientes.
7. Mantener alternativa de PDF manual completamente funcional.

**Criterios de aceptación:** una vez preparada la sesión, el operador inicia la descarga y análisis desde un flujo unificado; ante expiración de sesión se detiene con mensaje claro; no hay duplicación ni pérdida de PDFs.

### Fase 05 — Bandeja de entregas WhatsApp (manual asistida)

**Objetivo:** preparar todas las entregas con la menor intervención y trazabilidad.

**Tareas:**

1. Listar únicamente los trabajadores con destinatario e identidad autorizados y archivos listos.
2. Vincular inequívocamente nombre, teléfono, documento, PDF completo y MP3 correspondiente.
3. Generar el mensaje institucional actual sin revelar datos clínicos innecesarios en el texto del chat.
4. Permitir abrir el chat en WhatsApp Web y mostrar/ubicar los adjuntos correctos en Windows.
5. Registrar confirmación explícita del operador después de enviar mensaje y adjuntos.
6. Bloquear entregas duplicadas salvo reapertura deliberada, con motivo registrado.
7. Filtrar pendientes, listos, enviados e incidencias; conservar historial mínimo.

**Criterios de aceptación:** abrir el chat no equivale a «enviado»; la cola salta registros incompletos; no se propone adjuntar archivos de otro trabajador; se puede retomar la bandeja tras cerrar la app.

### Fase 06 — Endurecimiento, pruebas y despliegue

**Objetivo:** verificar el sistema completo antes de uso real a escala.

**Escenarios mínimos de prueba:**

- Teléfono peruano válido, inválido, vacío, repetido o cambiado.
- WhatsApp confirmado pero identidad no confirmada.
- Verificación vencida o autorización revocada.
- Documento PDF faltante, corrupto o vinculado incorrectamente.
- Texto aprobado que luego se edita.
- Aptitud pendiente y hallazgos clínicos bloqueantes.
- Interrupción de red, timeout TTS y créditos agotados.
- Cierre de pestaña, reinicio de Windows/Connector y recuperación de lote.
- Intentos de duplicación de MP3 o entrega.
- Lote de prueba con datos ficticios; piloto real solo con autorización institucional.

**Comprobaciones de proyecto (desde la raíz):**

```powershell
cd C:\Users\USER\Documents\AudioEvaluaciones
npm test
npm run lint
npm run build
npm run clinical:audit
npm run narrative:audit
```

**Criterios de aceptación:** todas las pruebas existentes y nuevas pasan o las excepciones se justifican explícitamente; la importación manual y desde MediWeb siguen funcionando; los artefactos clínicos no se exponen en logs; el instalador actualizado se valida en una PC Windows de prueba.

## 7. Orden, dependencias y entregables

| Fase | Depende de | Entregable verificable |
|---|---|---|
| 00 | Ninguna | Aprobación explícita y bloqueo efectivo de TTS |
| 01 | 00 | Persistencia segura de lotes y estados |
| 02 | 01 | Bandeja rápida de verificación de teléfonos |
| 03 | 00–02 | Cola TTS con ahorro de créditos y MP3 persistentes |
| 04 | 01 | Flujo unificado MediWeb → PDF → análisis |
| 05 | 01–04 | Bandeja de entregas asistidas con confirmaciones |
| 06 | Todas | Pruebas integrales, piloto y despliegue controlado |

Se permite desarrollar la fase 04 en paralelo con 02/03 una vez estabilizado el contrato de persistencia, pero **no** activar generación masiva ni entrega sin pasar los controles de 00–03.

## 8. Reglas de desarrollo para Codex

1. Leer este documento y **revisar el código local actual** antes de modificar archivos.
2. Implementar **una fase por solicitud** y mantener los cambios acotados.
3. Preservar importación manual de PDF, MediWeb Connector, edición narrativa y TTS individual.
4. Agregar pruebas de regresión y ejecutar `npm test`, `npm run lint`, `npm run build`, `npm run clinical:audit` y `npm run narrative:audit`.
5. No fabricar hallazgos clínicos ni aprobar narrativas de manera automática como si fueran revisadas por una persona.
6. No exponer API keys, credenciales, cookies o identificadores médicos en frontend, logs, capturas ni commits.
7. Mantener `ELEVENLABS_API_KEY` exclusivamente en backend o variables de entorno seguras; nunca en React/Vite.
8. No versionar `.env`, `.env.local`, `.venv`, `node_modules`, `dist`, `tts_cache`, logs, perfiles de sesión, PDFs o MP3 clínicos.
9. No hacer `git push`, despliegues, cambios de infraestructura o publicación de instaladores sin autorización explícita.
10. Para cada fase, entregar resumen de archivos cambiados, casos probados, resultados, riesgos, pendientes y modo de revertir.
11. No asumir Linux/macOS: instrucciones y comandos compatibles con **Windows PowerShell/CMD**.
12. Preferir MP3 (`audio/mpeg`), sin asumir salida WAV.
13. El texto narrativo final debe evitar mayúsculas sostenidas cuando perjudiquen la dicción del TTS.
14. Cualquier autorización médica, de privacidad o política empresarial pendiente debe resolverse antes de distribuir información clínica.

## 9. Procedimiento de trabajo en VS Code

```powershell
cd C:\Users\USER\Documents\AudioEvaluaciones
git status
git branch --show-current
```

Revisar cualquier cambio local antes de crear una rama; **no ejecutar comandos destructivos** para limpiar el directorio.

Con el árbol de trabajo limpio:

```powershell
git switch -c feat/flujo-masivo-whatsapp
```

Trabajar una fase por vez:

1. Pedir a Codex que analice la fase y enumere archivos/riesgos.
2. Implementar solo el alcance aprobado.
3. Ejecutar todas las pruebas.
4. Revisar `git diff` y probar manualmente los flujos afectados.
5. Registrar un commit por fase una vez aprobados los cambios.
6. Actualizar este documento en la sección 11.

## 10. Primer prompt para Codex (fase 00)

```text
Estamos trabajando en AudioEvaluaciones.
Lee docs/PLAN_AUTOMATIZACION.md y revisa el código local real.

Implementa EXCLUSIVAMENTE la FASE 00: seguridad clínica y aprobación real.

- Revisa src/lib/workerReviewUx.js, src/App.jsx,
  src/components/PdfWorkersPreview.jsx y los módulos clínicos.
- Identifica asignaciones automáticas indebidas de reviewed_by_user
  y limpiezas de needs_review.
- No marques como revisión humana una importación de PDF.
- Separa extracción, validación, aprobación clínica y permiso de TTS.
- Implementa aprobación explícita de la narrativa e invalídala
  cuando cambie el texto o un dato clínico relevante.
- Bloquea TTS si falta aprobación, existen errores bloqueantes
  o no se cumplen condiciones del destinatario en MediWeb.
- Conserva PDF manual, MediWeb, edición y TTS individual.
- Añade pruebas automáticas de casos permitidos y bloqueados.
- Ejecuta npm test, npm run lint, npm run build,
  npm run clinical:audit y npm run narrative:audit.
- No implementes fases posteriores, n8n ni WhatsApp automático.
- No toques secretos ni archivos .env.
- No hagas commit, push ni deploy.

Entrega un resumen de cambios, pruebas, riesgos y verificación manual.
Ante decisiones que alteren semántica clínica, pide confirmación.
```

## 11. Seguimiento de fases

| Fase | Estado inicial | Responsable | Evidencia / PR o commit |
|---|---|---|---|
| 00. Seguridad clínica | Validación funcional simulada ejecutada; auditorías pendientes | Codex | docs/FASE_01_RESULTADOS.md (sin commit) |
| 01. Persistencia | Implementada y probada localmente; aceptación instalada pendiente | Codex | docs/FASE_01_RESULTADOS.md (sin commit) |
| 02. WhatsApp rápido | Implementada y validada localmente; aceptación instalada pendiente | Codex | docs/FASE_02_RESULTADOS.md (sin commit) |
| 03. TTS masivo | Implementada y probada localmente; aceptación instalada y auditorías pendientes | Codex | docs/FASE_03_RESULTADOS.md (sin commit) |
| 04. MediWeb unificado | Implementada y probada localmente con MediWeb simulado; aceptación institucional/EFS/Windows instalado pendiente | Codex | docs/FASE_04_RESULTADOS.md (sin commit) |
| 05. Bandeja de entregas | Pendiente | Por asignar | — |
| 06. Pruebas y despliegue | Pendiente | Por asignar | — |

Actualizar el estado y registrar la evidencia al cerrar cada fase.

## 12. Decisiones pendientes

- **Aprobador clínico:** quién puede autorizar la narrativa final y cómo registrar su identidad de manera auditable.
- **Verificación de destinatarios:** procedimiento institucional para confirmar identidad y consentimiento del trabajador.
- **Caducidad de verificaciones:** plazo que apruebe la clínica; no asumir verificación indefinida.
- **Persistencia:** archivos atómicos vs. SQLite, cifrado, respaldos, retención y acceso por usuario Windows.
- **Consumo TTS:** cómo estimar el costo real y comprobar fallos ambiguos sin duplicar cargos.
- **Entrega:** mantener WhatsApp manual asistido o evaluar a futuro un canal automatizado autorizado y apto para información médica.
- **Filtros MediWeb:** determinar cuáles pueden guardarse y aplicarse de forma segura en la sesión existente.

---

**Definición de éxito:** una sola operación inicia la importación y el procesamiento; el sistema evita gastar créditos para destinatarios no verificados; la intervención humana se concentra en aprobación clínica, identidad/autorización del destinatario, excepciones y confirmación de entrega. Ningún mecanismo automático debe asumir que un contacto tiene WhatsApp, que un trabajador aprobó el canal o que un mensaje se envió correctamente sin evidencia suficiente.
