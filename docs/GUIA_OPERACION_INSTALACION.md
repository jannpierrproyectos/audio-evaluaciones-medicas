# AudioEvaluaciones — instalación, actualización y recuperación

Guía preparada el 18/10/2026. Esta guía no autoriza una publicación ni sustituye la aceptación institucional descrita en `FASE_06_RESULTADOS.md`. Usar primero una PC/VM de prueba con datos ficticios. La instalación existente no fue modificada.

Actualización de la candidata **0.6.0-rc.2 para Windows Home**: consultar el informe único [PREPARACION_DISTRIBUCION.md](PREPARACION_DISTRIBUCION.md). El Connector actualizado cifra descargas y MP3 con AES/DPAPI y usa copias temporales privadas para adjuntar, sin exigir EFS. No se actualizó la instalación existente. Los endpoints TTS externos y Sheets conservan la autorización de pasarela y las barreras de consumo; no introducir credenciales en React/Vite. La firma sigue siendo un paso estricto para distribución.

## Requisitos antes de instalar

- Windows x64, incluido Home Single Language, Microsoft Edge actualizado, usuario definido y disco fijo NTFS con ACL privadas verificables. No se exige EFS en el Connector actualizado. Antes de datos reales, TI debe acreditar cifrado de dispositivo activo y aceptar el riesgo de copias legibles temporales: ACL no es cifrado. Si falla DPAPI, permisos, vigilante o limpieza, conservar el bloqueo.
- Instalador aprobado, firma Authenticode y SHA-256 verificados contra el canal institucional. El staging local de desarrollo no es un instalador aprobado.
- Frontend y Connector del mismo conjunto de entrega probado; TTS con `/health`, `/configuration` y `/synthesize`, MP3 y cabecera `X-TTS-Configuration`, contrato 1. Las funciones nuevas no están garantizadas por el instalador público anterior aunque comparta el número 0.5.0.
- Origen HTTPS institucional exacto autorizado, puerto loopback libre y permiso de acceso a red local del navegador. No abrir puertos al exterior, no configurar CORS `*` y no añadir todos los previews de Vercel.
- Procedimiento de identidad, aprobación clínica, consentimiento/vigencia, respaldo y retención aprobado. La aplicación no autentica por sí sola al operador ni acredita recepción en el servidor de WhatsApp.

## Instalación y primera aceptación

Para comprobar el cambio Home **con datos ficticios y sin instalar**, cerrar personalmente cualquier instancia anterior del Connector que esté usando el puerto 8765; no ejecutar dos a la vez. Desde el repositorio: `npm.cmd --prefix mediweb-downloader run service` y, en otra terminal, `npm.cmd run dev`; abrir la URL local indicada por Vite. El modo de fuentes usa directorios de desarrollo: no utilizarlo para documentos médicos reales. El staging RC2 reconstruido permite la aceptación del runtime empaquetado por separado, pero sigue sin firma ni Setup aprobado. El dominio Vercel y la instalación anterior no se actualizan al modificar estas fuentes.

En el flujo nuevo, «Mostrar» prepara una copia privada legible de hasta 15 minutos. Adjuntar manualmente al chat comprobado y usar las confirmaciones separadas; «Finalizar preparación» individual retira sus copias. No moverlas ni copiarlas fuera de su carpeta. Ante un bloqueo de limpieza, cerrar visores/adjuntos y reiniciar el Connector. Tras reiniciar Windows, iniciar el Connector antes de trabajar para retirar restos; comprobar cifrado de dispositivo y política de residuos antes de datos reales. Estos pasos no sustituyen los requisitos de autorización clínica/destinatario ni permiten TTS sin sus controles.

1. Con autorización para la máquina de prueba, ejecutar el Setup verificado como administrador. Elegir explícitamente si se desea inicio con Windows y acceso directo. El usuario no necesita Node, npm ni Playwright: el paquete incluye Node y usa Edge instalado.
2. Abrir **AudioEvaluaciones Connector** desde Inicio. Comprobar el icono de bandeja y `/health` en `http://127.0.0.1:8765/health`. Confirmar versión y que no existen procesos duplicados. No iniciar otro servicio de desarrollo en el mismo puerto.
3. En Configuración, comprobar URL institucional y carpeta de descargas protegida. En Edge abrir la web y aceptar el permiso de conexión local cuando corresponda. Verificar conexión real desde el dominio publicado; probar desde localhost no demuestra esta aceptación.
4. Abrir MediWeb desde el Connector e iniciar sesión manualmente, incluido MFA/CAPTCHA. No introducir la contraseña en React, configuraciones ni tickets. El perfil se conserva localmente con ACL; no se distribuye con el instalador.
5. Preparar búsqueda y confirmar filtros/resultados. Ejecutar **Iniciar procesamiento completo** con un lote ficticio/autorizado de prueba. Comprobar que solo descarga aptitudes elegibles, respeta identidades/fechas y deja narrativas pendientes de revisión humana.
6. Verificar WhatsApp pendiente, identidad, autorización y PDF por separado. Aprobar la narrativa revisada. Preparar la estimación y confirmar generación masiva solo con TTS de prueba; no consumir créditos reales durante esta aceptación.
7. Abrir la bandeja de entregas. Comprobar mensaje, PDF y MP3 para la misma evaluación. Abrir chat, copiar y mostrar archivos son acciones humanas y no equivalen a enviar. No efectuar envíos reales durante la prueba. Las declaraciones ficticias de envío se usan solo en el entorno de prueba.
8. Conservar confirmaciones parciales, cerrar/reabrir web y Connector y comprobar recuperación. Reiniciar Windows en la máquina autorizada, comprobar inicio opcional, perfil y datos. Repetir con autorización revocada, teléfono cambiado, archivo alterado, TTS incierto y fallo de red: debe bloquear o pedir conciliación, nunca declarar éxito.

## Uso diario

Iniciar el Connector y la web; comprobar conexión; iniciar procesamiento completo; resolver incidencias y sesión expirada; verificar contactos pendientes; revisar/aprobar narrativas; preparar y confirmar generación de audios autorizados; abrir bandeja y preparar entregas. El operador revisa destinatario y adjuntos, envía manualmente en WhatsApp y declara por separado mensaje/PDF/MP3; **Confirmar y siguiente** cierra la entrega y avanza.

Esperar **Cambios guardados** antes de cerrar. Las operaciones inciertas requieren comprobar su resultado; no crear otro lote ni repetir TTS para eludir el bloqueo. El MP3 válido se reutiliza. Cambios de identidad, teléfono, texto, autorización o archivos obligan a comprobar de nuevo las dependencias afectadas.

## Configuración para el responsable técnico

| Componente | Configuración | Ubicación y precaución |
| --- | --- | --- |
| React/Vite | `VITE_MEDIWEB_SERVICE_URL=http://127.0.0.1:8765` | URL pública, nunca API keys. Variables `VITE_*` quedan expuestas en el bundle. |
| Frontend | `VITE_CONNECTOR_RELEASE_MANIFEST_URL`, `VITE_CONNECTOR_RELEASE_REPOSITORY` opcionales | Valores públicos; manifiesto aprobado del conjunto de entrega. |
| Backend Node/Vercel | `TTS_SERVICE_URL` | Solo backend; no se configuró ni desplegó en este trabajo. |
| FastAPI | `TTS_ENGINE`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID` y ajustes de voz existentes | Secretos únicamente en el entorno privado del servicio. No copiarlos a Vite, logs o repositorio. |
| FastAPI | `ALLOWED_ORIGINS` | Orígenes exactos. CORS no autentica ni impide solicitudes de otros servidores. |
| Connector | `config.json`, puerto, `audioEvaluacionesUrl`, `allowedOrigins`, carpeta y actualizaciones | Configuración local del mismo usuario; reiniciar para cambios operativos. Defaults en `mediweb-downloader/config/default-config.json`. |
| Sheets opcional | `GOOGLE_SHEET_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_PROJECT_ID` | Solo backend; no es requisito del recorrido principal MediWeb/PDF. |

Antes de producción, el responsable de infraestructura debe comprobar autenticación/control de acceso y límites de consumo en frontend, funciones TTS y FastAPI. La candidata exige `INSTITUTIONAL_PROXY_TOKEN` en el tramo pasarela→backend y `TTS_SERVICE_ACCESS_TOKEN` en backend→FastAPI. Son secretos distintos de servidor, sin valores de ejemplo ni cambios de secretos en este trabajo. La pasarela debe autenticar al operador, quitar cabeceras del cliente que intenten suplantarla e inyectar su credencial exclusivamente en servidor. El código no inventa una identidad institucional: esa aceptación sigue pendiente. Los límites FastAPI son por proceso y no sustituyen un presupuesto agregado en infraestructura/cuenta. Comprobar HTTPS, permisos locales de Edge, cabeceras y duración real de funciones frente al timeout del proveedor; no asumir que un timeout evita el cargo.

El fallback WAV local no equivale a un MP3 clínico aprobado y no sirve para validar reutilización institucional. En producción se exige el contrato MP3/configuración vigente y aceptación de la voz con un texto autorizado.

## Construcción y publicación controlada

En una copia de trabajo revisada y con dependencias del lockfile, ejecutar pruebas completas, lint, build, auditorías autorizadas y escenarios Edge. Para el Connector se necesita Windows x64, compilador .NET Framework 4.x y **Inno Setup 6**. Si faltan, detener la publicación; el script de Setup devuelve error.

```powershell
# Desde la raíz: validar primero
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run clinical:audit
npm.cmd run narrative:audit

# Desde mediweb-downloader, en entorno de construcción autorizado
npm.cmd test
npm.cmd run check
npm.cmd run build:windows:staging
npm.cmd run smoke:windows:staging
npm.cmd run build:windows:installer
```

El staging reconstruye exclusivamente `mediweb-downloader/build-windows`; conservar fuera de ese directorio cualquier artefacto que deba retenerse. No incluye datos ni claves del usuario. El smoke crea un usuario de prueba aislado, inicia dos procesos consecutivos del runtime empaquetado y valida recuperación cifrada; no es una instalación ni prueba visual de bandeja/Explorer.

Antes de distribuir: aceptar la candidata `0.6.0-rc.1` y su mínima compatible, aplicar firma mediante el procedimiento `sign-windows.js`, validar staging/Setup y calcular su hash. Si falta certificado o la verificación Authenticode no pasa, el script devuelve error: **no distribuir**. No reutilizar el hash del manifiesto público actual para este código nuevo. No publicar un manifiesto que apunte a un Setup inexistente o no probado. El inventario local `CANDIDATE-0.6.0-rc.1.json` no es un manifiesto de actualización pública ni una aprobación de producción.

El procedimiento `npm.cmd run build:windows` encadena construcción, firmas, smoke e instalador. Requiere los insumos de firma ya existentes en un entorno autorizado; esta guía no proporciona ni modifica credenciales. `release:prepare` prepara artefactos locales; no convierte un resultado local en una aceptación. Publicar frontend/servicio/instalador y actualizar el manifiesto solo después de autorización expresa y del cierre de los bloqueos del informe final.

## Actualización y reversión

### Publicación de frontend y TTS, solo después de autorización

Preparar el proyecto Vercel con la raíz del repositorio, instalación por lockfile, build `npm.cmd run build` (o `npm run build` en el runner) y salida `dist`. Configurar las URLs públicas en el entorno del build y `TTS_SERVICE_URL` exclusivamente en backend. Los handlers existentes exportan métodos HTTP desde `api/`, una forma admitida por el [runtime Node de Vercel](https://vercel.com/docs/functions/runtimes/node-js); su funcionamiento en el proyecto institucional todavía debe probarse. Mantener una publicación de prueba protegida y comprobar `/api/tts/configuration`, errores sanitizados y acceso localhost desde Edge antes de promover a producción.

El TTS tiene `tts-service/Dockerfile` con Python 3.11, dependencias fijadas y Uvicorn en puerto 7860. Construir y probar esa imagen en infraestructura autorizada; suministrar secretos por el gestor privado del entorno y colocar autenticación/limitación delante del servicio. El bind `0.0.0.0` del contenedor requiere protección de red y no convierte su API en privada. No cambiar el Connector a ese bind: sigue siendo exclusivamente loopback. Verificar `/health`, `/configuration` y un MP3 de prueba autorizado mediante un proveedor simulado antes de permitir voz real. No se construyó ni publicó esta imagen en Fase 06.

Después de aceptar backend, frontend y Connector como conjunto, publicar solo los artefactos aprobados, comprobar versión/hash/origen y conservar las versiones previas compatibles para reversión. Esta documentación no ejecuta ni autoriza despliegues.

### Recuperación del operador

1. Pausar nuevas tareas, terminar o cancelar pendientes y conciliar incertidumbres. Esperar guardado y cerrar el Connector de forma segura.
2. Finalizar las preparaciones y comprobar que `temporary-attachments-v1` esté vacío; no respaldar adjuntos legibles temporales. Conservar respaldo cifrado y validado del catálogo, binarios, claves DPAPI, configuración, perfil y descargas cifradas. El respaldo de sesiones es sensible. Probar restauración con el mismo usuario y entorno DPAPI antes de actualizar. Copiar `key.dpapi` a otro usuario/equipo **no** garantiza descifrado. Preservar certificado EFS solo si se conservan archivos EFS anteriores; el flujo Home nuevo no lo utiliza.
3. No desinstalar la versión anterior para actualizar. El desinstalador anterior puede borrar LocalAppData y sus claves: la corrección de conservación solo está en el código nuevo, no en instalaciones antiguas. No ejecutar una desinstalación sin respaldo y autorización.
4. Usar el Setup aprobado de actualización. El actualizador valida HTTPS, hosts, tamaño y SHA-256 y bloquea con descargas MediWeb activas; antes de actualizar, cerrar también TTS y entregas pendientes desde la web. Verificar firma y versión, abrir, recuperar lote, comprobar MP3 y referencias PDF sin regenerar.
5. Si falla: detener nuevas operaciones y conservar archivos/logs sanitizados. Revertir frontend al artefacto previo compatible y Connector a un binario aprobado compatible, bajo autorización. No borrar catálogo, claves, historial o bloqueos para forzar recuperación; no restaurar un respaldo antiguo sobre trabajo nuevo sin conciliación, pues podría ocultar operaciones ya iniciadas o entregadas.
6. Ante corrupción se usa la copia cifrada validada existente; ante clave DPAPI/EFS inaccesible, detenerse y escalar al responsable del respaldo. No prometer recuperación entre máquinas ni cargos TTS devueltos.

La nueva fuente Inno conserva datos al desinstalar, pero su aceptación real sigue pendiente. Una eliminación definitiva de datos, sesiones o respaldos requiere la política institucional de retención y autorización separada; la desinstalación no se usa como mecanismo de purga.
