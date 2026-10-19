# Corrección de recuperación y composición UI

Rama: `ux/flujo-operativo-simplificado`. Este documento sustituye la conclusión visual de la entrega anterior; conserva su auditoría como antecedente.

## Correcciones concretas

`restoreBatch()` mezclaba lectura, actualización de contactos, recuperación de audio y una nueva escritura del catálogo. Un error en cualquiera de esas operaciones podía producir un resultado vacío; su `catch` borraba la causa. `IntegratedProcessing` terminaba mostrando simultáneamente la descarga completa, cero evaluaciones abiertas y un error genérico.

Ahora:

- Abrir un lote valida su identificador, estructura y evaluaciones. **No necesita volver a guardarlo**.
- Una consulta fallida de contactos produce una advertencia y conserva las evaluaciones legibles. Recuperar el MP3 ocurre por separado y no impide revisar.
- Los fallos devuelven y registran códigos de etapa y causa conocidos, sin mensajes de excepción, identificadores clínicos ni secretos. Ejemplo probado: `BATCH_LOAD_STORE_BUSY`, con explicación comprensible y reintento de apertura.
- No se borra el lote abierto antes de comprobar su reemplazo. No se descarga desde MediWeb para resolver un error de recuperación.
- El estado del proceso distingue archivos descargados, lote almacenado y evaluaciones efectivamente abiertas. El éxito visible requiere estas últimas.
- La consulta de estado verifica las referencias guardadas. Inicializar el historial de un proceso finalizado no reescribe el catálogo. Un lote vacío no se puede vincular como importación terminada.

## Cambios de composición

`IntegratedProcessing.jsx` tiene vistas separadas de búsqueda, progreso, resultado disponible y recuperación fallida. El resultado contiene tres indicadores compactos, una acción principal «Revisar evaluaciones», otra búsqueda e historial secundario. El formulario desaparece al procesar. No aparecen valores `completed` ni instrucciones técnicas repetidas.

«Procesar evaluaciones» obtiene automáticamente la comprobación existente del Connector y usa su token para iniciar. Se eliminó la casilla adicional. Un filtro no reconocible, una discrepancia o una sesión vencida mantienen el bloqueo contextual; no equivalen a revisión clínica ni consentimiento.

La navegación distingue **Importar → Revisar → Audios → Entregas**. La revisión tiene una barra breve de destinatario y navegación, sin estadísticas de WhatsApp desplazando el texto. La generación masiva presenta audios guardados, textos aprobados y pendientes. En la entrega, el mensaje completo queda plegado y la confirmación conjunta recibe prioridad después de preparar los adjuntos.

## Prueba con Connector real aislado

El ejecutable de aceptación usa las clases reales `DownloaderRunner`, `JobManager`, `ProcessingFlow`, `EvaluationStore`, `createApp`, `managedFiles`, `encryptedOutput` y `TemporaryAttachments`.

Se ejecutan en Windows con Edge, servidor HTTP propio en un puerto libre, directorio temporal exclusivo, AES-GCM, DPAPI y permisos NTFS reales. No invoca el servicio instalado, su perfil, sus credenciales ni su catálogo. Las páginas de origen contienen ocho trabajadores ficticios y la respuesta TTS se genera localmente. La conversación es una página local y Explorer se sustituye por un registro de apertura; no se envía información a WhatsApp.

Se comprobó:

1. Inicio sin evaluaciones ni casilla redundante.
2. Procesamiento real de ocho reportes ficticios y generación de PDF.
3. Importación por el parser de la aplicación: ocho evaluaciones y ocho PDF asociados, sin aprobación automática.
4. Recarga y recuperación de las ocho evaluaciones: ninguna nueva descarga y catálogo cifrado idéntico byte a byte.
5. Fallo controlado de lectura `STORE_BUSY`: sin anuncio de éxito, sin escritura del catálogo y con código seguro. Reintento exitoso sobre los mismos archivos.
6. Revisión clínica individual y aprobación explícita.
7. Generación local simulada sin WhatsApp y reutilización sin segunda síntesis.
8. Autorización explícita del destinatario y preparación real de dos copias protegidas para entrega. Ningún archivo se marcó enviado.
9. Conservación de los ocho registros, sus referencias y las huellas de los ocho PDF originales.
10. Escritorio y móvil sin desbordamiento horizontal ni errores de página.

La voz sintética de prueba comprueba transporte, almacenamiento y reutilización; no evalúa calidad acústica. La entrega sigue siendo manual. El Connector instalado y producción permanecen sin modificar.

## Evidencia y ejecución

Resultados: 254 pruebas de la aplicación y 153 del Connector aprobadas, ESLint sin errores y compilación Vite correcta. La aceptación en Edge completó los ocho estados solicitados y dejó once capturas. El resultado registra ocho evaluaciones, ocho reportes ficticios leídos una sola vez, una síntesis local simulada, cero solicitudes externas, dos adjuntos protegidos y cero errores de página. Se comprobó además la navegación siguiente/anterior entre entregas pendientes y la reutilización desde otra sesión del navegador.

- [Galería comparativa y estados](../artifacts/ux-correction/index.html).
- [Resultados de la aceptación en navegador](../artifacts/ux-correction/results.json).
- Las once capturas finales están en `artifacts/ux-correction/after/`; fueron examinadas, y la composición se corrigió durante esa revisión.
- Las capturas `before/` proceden de la versión visual rechazada. No se fabricó una imagen del incidente clínico del usuario.

```powershell
npm.cmd test
npm.cmd --prefix mediweb-downloader test
npm.cmd run lint
npm.cmd run build
node scripts/validate-processing-ux.mjs
```

Para dejar el entorno de aceptación disponible después de las pruebas:

```powershell
node scripts/validate-processing-ux.mjs --keep-preview
```

Abre `http://127.0.0.1:4180`. El modo conservado contiene el lote ficticio de ocho evaluaciones ya procesado. Los botones de la franja de prueba permiten simular y restablecer la lectura fallida sin modificar el catálogo. Ctrl+C cierra y limpia exclusivamente el directorio temporal creado por esa ejecución.
