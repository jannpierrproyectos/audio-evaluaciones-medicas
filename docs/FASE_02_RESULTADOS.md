# Fase 02 — Informe único de implementación y validación

Fecha: 17 de octubre de 2026, America/Lima. AudioEvaluaciones. Sin commit, push, deploy ni publicación de instaladores.

## Estado

Fase 02 implementada y validada localmente: análisis automático de teléfonos, detección de duplicados entre lotes, recuperación conservadora de comprobaciones, cola de revisión con guardado inmediato, navegación y reanudación, filtros y bloqueo central de TTS para destinatarios incompletos o no autorizados en el flujo MediWeb.

La prueba funcional se ejecutó realmente en Microsoft Edge con datos ficticios, Connector HTTP y almacenamiento temporal cifrado reales. WhatsApp y el proveedor de voz fueron simulados; no se consultaron cuentas reales ni se enviaron mensajes. Quedan pendientes la aceptación en una instalación Windows real, el procedimiento institucional de identidad/consentimiento y las auditorías con insumos autorizados.

## Arquitectura y almacenamiento

Se reutiliza exclusivamente el repositorio de Fase 01 y su catálogo AES-256-GCM con clave protegida por DPAPI CurrentUser, ACL y revisiones optimistas. No se cambió el formato criptográfico ni se creó otra base de datos, carpeta pública, almacenamiento del navegador o archivo de contactos en claro.

La acción `contacts` de la API local `/state` obtiene una vista de identidad, teléfono, comprobación y autorización de las evaluaciones guardadas. No devuelve narrativas, aprobaciones clínicas, hallazgos, recomendaciones ni MP3. Mantiene los controles de Origin/CORS y `Cache-Control: no-store` existentes. Los contactos solo se usan en memoria y sus resultados se guardan dentro del catálogo cifrado.

Al importar, recuperar, abrir la cola y antes de solicitar TTS, la aplicación consulta el contexto guardado y vuelve a analizar el lote activo. Una operación asíncrona se vincula al lote y a la evaluación correspondientes; no puede aplicar el resultado de un contacto a otro lote. Las revisiones de Fase 01 siguen impidiendo sobrescrituras silenciosas entre ventanas.

## Teléfonos y duplicados

Se reutiliza `normalizePhoneForWhatsApp()`, sin alterar sus reglas peruanas. Se clasifican formato válido, inválido, incompleto y ausente. Un teléfono válido no se marca como cuenta existente.

Los resúmenes muestran válidos, inválidos, ausentes, incompletos, pendientes, confirmados, sin WhatsApp, duplicados y conflictos. Los recuentos corresponden a evaluaciones del lote activo; los duplicados también consideran contactos guardados en otros lotes. Inválidos incluye ausentes e incompletos; estos dos se desglosan aparte. Confirmado describe existencia de WhatsApp, no permiso de TTS.

Documento e identidad nominal normalizados permiten distinguir a una misma persona con varias evaluaciones de personas distintas con el mismo teléfono. Sin documento fiable no se fusionan personas por nombre. Las evaluaciones continúan siendo independientes.

Un teléfono compartido entre identidades distintas tiene un conflicto explícito. El TTS queda bloqueado hasta que el operador confirme identidad, autorización, PDF y que comprobó la identidad para ese teléfono compartido. La declaración se vincula al grupo de identidades detectado; añadir una identidad diferente invalida esa resolución. Marcar una cuenta sin WhatsApp conserva el bloqueo sin obligar a repetir inútilmente su comprobación en cada vuelta.

## Recuperación y compatibilidad

Las comprobaciones existentes de Fase 01 se conservan cuando coinciden teléfono, identidad y vinculación, con fechas válidas. Su declaración conjunta explícita de identidad/autorización/PDF sigue siendo compatible; no se fabrican comprobaciones humanas ni se aprueba clínicamente al importar.

Para recuperar existencia de WhatsApp desde otra evaluación se exige:

- Coincidencia de documento/identidad nominal y teléfono normalizado.
- Comprobación positiva válida y autorización de origen vigente.
- Fecha de vigencia explícita; no se inventa un plazo ni se concede reutilización indefinida entre evaluaciones.
- Ausencia de un conflicto de identidad para el número y de una decisión negativa más reciente aplicable.

Solo se recupera la existencia de la cuenta. No se trasladan aprobación clínica, identidad/autorización de entrega ni correspondencia del PDF a una evaluación diferente. El resultado conserva fecha original, origen `recuperada`, vencimiento y referencia a la comprobación de origen. Las comprobaciones encadenadas se contrastan con su procedencia; revocar o perder el antecedente bloquea la copia, sin restaurarla silenciosamente después.

Cambios de teléfono o identidad invalidan la comprobación y las autorizaciones asociadas. Una comprobación caducada o discrepante no autoriza TTS. Un consentimiento revocado o vencido continúa bloqueando la entrega/TTS aunque la cuenta siga existiendo. Cada decisión explícita conserva fecha, identidad, origen e historial en el almacenamiento cifrado.

Los campos nuevos son aditivos. No se migraron destructivamente lotes de Fase 01. La representación exacta de `recipientVersion()` se conservó al extraerla a un módulo independiente.

## Funcionamiento de la cola

Desde el panel de trabajadores se accede mediante **Verificar WhatsApp pendientes**. La pantalla presenta resumen, lista filtrable, nombre, teléfono, formato, existencia de cuenta y estados independientes de identidad, autorización y PDF.

Acciones disponibles: **Abrir WhatsApp**, **Tiene WhatsApp**, **No tiene WhatsApp**, **Revisar después**, **Anterior**, **Siguiente** y **Volver al panel**. Se puede corregir el teléfono; la corrección obliga a comprobar de nuevo el chat. Los filtros incluyen pendientes, confirmados, sin WhatsApp, bloqueados y todos; también hay filtros de WhatsApp en el panel principal.

La declaración positiva o negativa se habilita después de abrir correctamente el chat del contacto mostrado. Abrirlo no guarda una confirmación. Los números inválidos no abren ventanas ni permiten declarar una cuenta válida; pueden aplazarse o corregirse.

Las decisiones se guardan inmediatamente. Se espera la confirmación del guardado del resultado antes de avanzar al siguiente pendiente. El cursor, filtro y registros visitados de la vuelta quedan en `whatsapp_queue` dentro del lote cifrado. **Revisar después** mantiene el contacto pendiente y evita un bucle en la misma vuelta. **Reanudar pendientes** inicia otra vuelta. Se puede salir, recargar, recuperar el lote y continuar sin repetir resultados ya guardados.

Se bloquean clics repetidos y navegación durante un guardado. Los cambios de lote o de vinculación invalidan las operaciones obsoletas; un error de persistencia no se interpreta como éxito ni habilita una llamada pagada.

## Apertura de WhatsApp y seguridad

Las comprobaciones usan el mismo mecanismo de ventana del navegador y enlaces `https://wa.me/<teléfono>`. No llevan mensaje, DNI, nombre, resultados ni texto clínico en parámetros. No hay scraping, consultas no oficiales, comprobación automática de cuentas ni envío automático.

Se intenta reutilizar una ventana con nombre y referencia controlada. `opener` se elimina antes de navegar. Edge puede negar la navegación posterior de una ventana que ya es de otro origen: en ese caso se intenta cerrar únicamente la ventana de comprobación creada por la aplicación y sustituirla, conservando la protección de `opener`. Si el navegador tampoco permite abrir/cerrar, se informa al operador y no se registra una confirmación. No se retiene `opener` para eludir la política del navegador.

## Identidad, autorización y TTS

`getRecipientChecks()` centraliza formato, cuenta, identidad, autorización vigente, PDF y resolución de duplicados. `getAudioAuthorization()` y `requestApprovedAudio()` reutilizan esa decisión; no se añadió un segundo motor clínico ni una regla de autorización exclusiva del botón.

La cola permite declarar por separado identidad verificada, autorización del canal, correspondencia trabajador/PDF y fecha de vencimiento. Guardarlas requiere una selección explícita adicional al resultado de cuenta. Si hay un teléfono compartido se exige también su comprobación individual. El Connector valida la referencia del PDF antes de aceptar esa autorización desde la interfaz. Una declaración de cuenta por sí sola no levanta una revocación ni concede consentimiento.

La aprobación clínica sigue siendo una acción diferente, ligada a su texto y versión. El TTS MediWeb exige aprobación clínica válida, validación sin bloqueos y destinatario autorizado; cambiar teléfonos o permisos no fabrica una aprobación médica. La comprobación se repite antes de la solicitud individual.

Se conserva el contrato previo de Fases 00/01 para PDF manual sin destinatario declarado: generación local individual con aprobación clínica y sin bloqueos. Cuando el registro manual tiene datos operativos de destinatario, se aplican las mismas verificaciones de contacto. La cola no habilita entrega WhatsApp para registros sin teléfono/PDF ni introduce generación masiva. No se amplió ninguna excepción existente.

## Archivos de esta fase

Nuevos:

- `src/components/WhatsAppReviewQueue.jsx`: lista, ficha de contacto, declaraciones independientes, navegación, corrección y estados de guardado.
- `src/lib/whatsappReview.js`: análisis, recuperación conservadora, estados/filtros, navegación y ventana de comprobación.
- `src/lib/recipientIdentity.js`: representación compatible de la vinculación de destinatario.
- `src/lib/recipientPolicy.js`: decisión común de autorización del destinatario.
- `test/phase-02-whatsapp.test.js`: doce casos nuevos de regresión.
- `scripts/phase02-functional-check.js`: recorrido reproducible de Edge con datos ficticios.
- `docs/FASE_02_RESULTADOS.md`: este informe.

Modificados:

- `src/App.jsx`: consulta de antecedentes, sincronización, guardado del cursor/decisiones y comprobación previa al TTS.
- `src/components/PdfWorkersPreview.jsx`, `src/App.css`: acceso a la cola, resúmenes, filtros, advertencia de conflicto y diseño adaptable. Se corrigió el filtro que podía quedar desactualizado al vencer una autorización.
- `src/lib/whatsappMessage.js`: comprobación de identidad, evaluación y fechas al recuperar una cuenta.
- `src/lib/clinicalApproval.js`: conexión con la política común; sin cambios de criterios clínicos.
- `src/lib/evaluationPersistence.js`: acceso a la vista de contactos del repositorio existente.
- `mediweb-downloader/src/evaluationStore.js`, `mediweb-downloader/src/http/stateRoutes.js`: acción de lectura `contacts` sobre el catálogo cifrado.
- `mediweb-downloader/test/evaluation-store-http.test.js`: privacidad de esa respuesta y preservación de los controles HTTP.
- `test/whatsapp-flow.test.js`: regresión actualizada para el mecanismo reutilizable de apertura.
- `docs/PLAN_AUTOMATIZACION.md`: seguimiento de Fase 02.

Se conservaron los cambios previos sin commit de Fases 00/01. No se modificaron secretos, `.env`, credenciales, umbrales médicos, cifrado, lockfiles ni infraestructura. No se implementaron Fase 03, n8n ni envíos automáticos.

## Resultados verificables

| Comando / comprobación | Resultado |
|---|---|
| `npm.cmd test` | 200/200 pasan; código 0 |
| `npm.cmd test --prefix mediweb-downloader` | 102/102 pasan; código 0 |
| `npm.cmd run lint` | Código 0 |
| `npm.cmd run build` | Código 0; Vite, 104 módulos |
| `node scripts/phase02-functional-check.js` | Código 0; diez puntos de navegación y tres grupos de comprobaciones funcionales |
| `node scripts/phase01-functional-check.js` | Código 0; las cinco comprobaciones funcionales anteriores siguen pasando |
| `git diff --check` | Sin errores |
| `npm.cmd run clinical:audit` | Código 1; falta `auditoria-local/primeras-hojas.pdf` |
| `npm.cmd run narrative:audit` | Código 1; falta `clinical-audit/audit-cases.json` |

Las doce pruebas nuevas cubren formato/incompletos/ausentes, duplicados entre personas y repetición de la misma persona, recuperación vigente sin trasladar permisos, antecedente negativo, revocación de la procedencia, cambios de identidad/teléfono, navegación sin bucles, bloqueos de ventanas y reemplazo seguro entre orígenes, autorización central/TTS, compatibilidad Fase 01 y almacenamiento cifrado después de reapertura. La suite completa incluye las pruebas reales de DPAPI/ACL de Fase 01.

Edge se ejecutó en modo headless, con un almacén temporal protegido por DPAPI real, API local real y React/Vite reales. Se cargaron siete evaluaciones ficticias más un antecedente en otro lote. Se verificaron:

1. Recuperación de existencia sin heredar autorización, resumen y comienzo en el primer pendiente.
2. Rechazo de popup bloqueado sin permitir una confirmación falsa.
3. Guardado y avance después de **Tiene WhatsApp**, **No tiene WhatsApp** y **Revisar después**.
4. Bloqueo del número compartido hasta completar declaraciones y comprobación específica de identidad.
5. Uso de una sola ventana de comprobación junto a la aplicación, con la sustitución segura cuando Edge restringe la navegación.
6. Teléfono inválido bloqueado; salida, recarga y reapertura real del almacén recuperando el cursor.
7. Corrección de teléfono, nueva comprobación exigida, filtros y navegación anterior/siguiente.
8. Aprobación clínica con solo cuenta confirmada: cero peticiones TTS. Declaraciones completas y aprobación clínica: una petición TTS simulada.
9. Enlaces sin parámetros ni contenido clínico. Cero consultas a WhatsApp, MediWeb o ElevenLabs reales y cero envíos.

Los fallos intermedios de Edge no se ocultaron: permitieron corregir la reasignación de `opener` y la restricción de navegación entre orígenes. También se ajustaron aserciones de prueba para distinguir ausencia de autorización (`null`/sin campo) y roles accesibles de la lista. No se desactivaron controles de producción para aprobar las pruebas. Los MP3 de prueba verifican transporte/persistencia, no calidad acústica de voz real.

Los lockfiles conservaron sus hashes de Fase 01: raíz `364FE34DA2AA37C0C0800475EA0B7D90B6D1D337D7D8A314555760FCCB460AF6`; Connector `13A19B7CAABA2608B02D57EB6694A2C88ABE9C98C315C0EBBCD3CBB6D2B89DC6`.

## Riesgos y aceptación pendiente

- No se comprobó disponibilidad real de ninguna cuenta. Las confirmaciones son declaraciones del operador; tener WhatsApp no acredita identidad ni consentimiento.
- Falta aceptación con el Connector actualizado instalado, una sesión real MediWeb y el procedimiento institucional autorizado. No se instaló ni publicó una versión productiva, ni se reinició Windows. La prueba reabrió el almacenamiento desde disco y recargó Edge.
- No se definió arbitrariamente una vigencia institucional. La fecha se introduce explícitamente; antecedentes sin vigencia suficiente no se reutilizan entre evaluaciones.
- La sincronización consulta los contactos al importar/recuperar/abrir la cola/guardar resultados/solicitar TTS. No es una suscripción en tiempo real a otras ventanas. Las revisiones del lote siguen protegiendo las escrituras concurrentes; ante un conflicto se debe recuperar la versión vigente.
- El navegador puede impedir reutilizar o cerrar una ventana externa. La aplicación prioriza no conservar `opener` y no fingir una comprobación; puede requerirse intervención para permitir popups.
- Los cambios aún sin confirmar por el Connector pueden perderse si se fuerza el cierre. Esperar la confirmación de guardado. Permanecen las limitaciones de Fase 01 para TTS ambiguo, exportación EFS, PDFs originales y respaldo bajo el mismo usuario Windows.
- Las auditorías clínicas siguen pendientes por los dos insumos indicados. No se inventaron casos clínicos ni se añadieron archivos sensibles para sustituirlos.

Para la aceptación manual: iniciar el Connector actualizado y la aplicación, importar un lote ficticio, comprobar los resúmenes, recorrer la cola, aplazar un registro, salir/recargar y recuperar el lote. Probar teléfono compartido, consentimiento vencido/revocado, cambio de teléfono/identidad y popup bloqueado. Verificar que una cuenta confirmada sin autorización y aprobación clínica no genera MP3. Repetir con una muestra real únicamente cuando exista autorización institucional y estén disponibles los insumos de auditoría.

## Reversión

No se ejecutó reversión. Revisar el diff y retirar únicamente los cambios de Fase 02, conservando Fases 00/01 y el trabajo del usuario. No eliminar el almacén ni su clave DPAPI para revertir código. Los campos nuevos son aditivos y quedan cifrados; un cliente anterior no conoce la resolución de duplicados ni los controles nuevos, por lo que no debe usarse para autorizar TTS después de una reversión sin revisar su política de acceso.
