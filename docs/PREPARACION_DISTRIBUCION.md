# Preparación de distribución — Windows Home, candidata 0.6.0-rc.2

## Dictamen vigente: adjuntos sin EFS

18/10/2026, America/Lima. Se implementó la alternativa solicitada para **Windows Home Single Language**, sin exigir Pro ni EFS en el flujo de AudioEvaluaciones servido por el Connector actualizado. No se modificaron reglas clínicas, TTS, secretos, envío manual ni la instalación en uso. Sin commit, push o deploy. Este apartado sustituye el requisito EFS del informe anterior, conservado al final como evidencia histórica.

**Las copias para adjuntar son legibles y no tienen cifrado por archivo. Los permisos NTFS no equivalen a EFS.** El repositorio implementa preparación local con controles de acceso, caducidad y limpieza; el uso de documentos médicos reales sigue condicionado a la aceptación de privacidad, al estado del equipo y a las comprobaciones pendientes siguientes. No se declara aprobada la producción.

### Arquitectura y funcionamiento

1. Se conserva el catálogo AES-256-GCM con clave protegida por DPAPI `CurrentUser`. Las nuevas descargas de PDF, el consolidado y los controles JSON/CSV se cifran **antes de la primera escritura**, con esa misma clave y contexto vinculado a su ruta relativa. No se crean claves, credenciales ni un segundo catálogo. Los nuevos PDF completos usan nombres UUID. El parser y las rutas existentes descifran en memoria; no hay un segundo motor clínico.
2. Los MP3 de adjuntos usan referencias opacas y contenido cifrado en `evaluations-v1/attachments-v1`, dentro del almacén existente. Se conserva el MP3 original y su autorización/huella. La caché es derivada, no provoca síntesis ni cargos y puede recuperarse después de reiniciar. La escritura cifrada es atómica.
3. Solo una acción explícita «Mostrar PDF/MP3» crea una copia legible bajo `%LOCALAPPDATA%\AudioEvaluacionesConnector\temporary-attachments-v1\<UUID>\adjunto.pdf` o `adjunto.mp3`. No se aceptan rutas del frontend para esa carpeta ni nombres con identidad. Se comprueban huella, autorización y asociaciones existentes antes de revelar la copia mediante Explorer.
4. Se exige disco fijo NTFS, rutas sin redirecciones/reparse points y directorios con propietario actual y una única regla explícita de control total para su SID, sin herencia de otros permisos. Los archivos heredan esa ACL privada. Si no se comprueba la protección o no arranca el vigilante independiente, **no se escribe el contenido legible**. EFS no se sustituye silenciosamente: esta es una política distinta de temporales, expresamente solicitada.
5. Cada copia tiene un máximo de **15 minutos**, no renovado por reutilizar una copia vieja. Un proceso Node oculto e independiente confirma que está vigilando antes de crear el adjunto. Comprueba caducidad y existencia del proceso padre cada segundo; utiliza también tiempo monotónico para limitar cambios del reloj. Al cerrar/finalizar o confirmar el envío del adjunto se retira su copia. Las invalidaciones detectadas también retiran las copias afectadas. «Finalizar preparación» individual ahora solicita limpieza efectiva, no solo restablece la pantalla.
6. La caída del Connector deja al vigilante encargado de retirar el archivo; un archivo bloqueado se reintenta. En el próximo inicio del Connector se limpian las sesiones reconocidas caducadas/abandonadas antes de permitir nuevas copias. Se rechazan sesiones vivas, contenido desconocido, junctions y fallos de limpieza. No se borran árboles arbitrarios ni se reutilizan como éxito resultados inciertos.

**Reinicio de Windows:** un vigilante no puede ejecutarse mientras Windows está apagado. Tras un corte/reinicio la limpieza ocurre al volver a arrancar el Connector, antes de nuevas exportaciones; no se instaló una tarea de inicio de sesión ni se cambió el inicio automático de la instalación actual. Si el Connector no vuelve a iniciarse, los restos pueden permanecer en disco. Esto requiere cifrado de dispositivo y procedimiento institucional para proteger el intervalo; no se promete eliminación durante el apagado.

### Cifrado de dispositivo y riesgos residuales

La edición comprobada realmente es `CoreSingleLanguage`. `manage-bde.exe` y `Get-BitLockerVolume` están presentes, pero las consultas de estado denegaron acceso administrativo tanto en sandbox como fuera de él. **Estado del cifrado de C: PENDIENTE; no se afirma ni activo ni ausente.** No se cambiaron políticas, claves de recuperación, servicios ni configuración de Windows.

Microsoft indica que [Cifrado de dispositivo puede estar disponible en Windows Home](https://support.microsoft.com/en-us/windows/security/encryption/device-encryption-in-windows). Su presencia depende del dispositivo y la configuración; disponer del comando no acredita protección activa. TI debe verificar volumen completamente cifrado y protección activa, sin suspensión, y recuperación de claves mediante un procedimiento autorizado; véase [comprobación del estado de BitLocker](https://learn.microsoft.com/en-us/windows/security/operating-system-security/data-protection/bitlocker/operations-guide?tabs=powershell). No registrar ni adjuntar claves al repositorio.

El cifrado de dispositivo protege el volumen frente a acceso sin conexión cuando está bloqueado/apagado. No impide a programas ejecutados como el mismo usuario, malware, administradores con privilegios o una sesión desbloqueada leer los adjuntos. La ACL limita otras cuentas ordinarias; no protege frente a toma de posesión administrativa ni acceso físico al disco sin cifrado. La eliminación es lógica: **no es borrado seguro garantizado en SSD**, ni limpia por sí sola journal, copias de seguridad, memoria/paginación, miniaturas, recientes o cachés creadas por Explorer, navegador o WhatsApp. Mover/copiar el archivo fuera de la carpeta administrada escapa al control del Connector.

Los documentos y exportaciones anteriores no se convierten, eliminan ni mueven automáticamente. Un PDF manual/de una descarga anterior puede seguir existiendo en claro en su ubicación original, y un archivo EFS anterior requiere recuperación con el usuario/clave compatibles. Los nuevos archivos `AED1` son contenedores cifrados, aunque conserven extensión PDF/JSON/CSV: deben abrirse mediante la aplicación, no directamente en Explorer. No usar un Connector anterior para interpretarlos. La retención de descargas/cachés cifradas se debe incluir en el procedimiento institucional de datos; la caducidad de 15 minutos corresponde a las copias legibles.

### Validación del cambio

| Comprobación | Estado | Evidencia |
| --- | --- | --- |
| Home Single Language, DPAPI/AES, ACL NTFS, PDF/MP3 y lanzamiento real de Explorer | **APROBADO en su alcance** | `node scripts/home-attachments-check.js`: archivos ficticios, permisos reales, dos lanzamientos iniciales de Explorer sin mock. |
| Limpieza al finalizar y recuperación del MP3 cifrado | **APROBADO** | La misma prueba retira ambas copias y reinicializa el almacén. |
| Caída real del proceso y caducidad real | **APROBADO** | Se mató el proceso ficticio; su vigilante retiró el adjunto. Otra copia caducó con el padre vivo. Cero temporales de prueba restantes. |
| Selección visual de Explorer y adjuntado manual a chat ficticio | **PENDIENTE** | El controlador de escritorio no pudo conectar su pipe nativo, incluso tras reintento y reinicialización. Lanzar el proceso no se presenta como comprobación visual ni envío. |
| Reinicio completo de Windows, usuario alternativo y archivo bloqueado por WhatsApp real | **PENDIENTE** | Hay pruebas de recuperación/rechazo y reinicio de procesos; no se reinició Windows ni se usó WhatsApp real. |
| Estado de cifrado de dispositivo | **PENDIENTE** | Consultas administrativas denegadas; no se desactivó protección alguna. |
| `npm.cmd test` / pruebas completas del Connector | **APROBADO** | Aplicación 230/230; Connector 151/151, cero omitidas. Incluye once pruebas nuevas de almacenamiento/temporales, recuperación, invalidación, rutas, cierre protegido y carrera de refresco. |
| Lint, build y sintaxis del Connector | **APROBADO** | `npm.cmd run lint`, `npm.cmd run build` (114 módulos), `npm.cmd --prefix mediweb-downloader run check` (52 archivos). |
| Backend Python | **APROBADO con proveedor ficticio** | 7/7; ejecutadas antes de reconstruir el staging. No se alteró TTS. |
| `public`/`dist` y `git diff --check` | **APROBADO en su alcance** | Sin hallazgos del scan de patrones conocidos ni errores de whitespace; no sustituye pentest. |
| Auditorías clínica/narrativa | **PENDIENTE** | Ambos comandos terminan con código 1 por los insumos ausentes indicados abajo. |
| Edge con descargas cifradas | **APROBADO en su alcance ficticio** | Recorrido completo en Edge headless real: dos PDF MediWeb simulados, parser/narrativas, fallo de importación y recuperación, verificaciones/aprobaciones humanas simuladas, dos MP3 simulados recuperables, bandeja y confirmaciones parciales. AES/DPAPI, NTFS y vigilantes reales; chat y revelado de esta regresión inyectados. Explorer real se probó aparte. Cero solicitudes reales al proveedor. |
| Staging RC2 y reinicio real de proceso | **APROBADO** | `build:windows:staging` y `smoke:windows:staging`: arranque con el runtime incluido, reinicio real y recuperación AES/DPAPI sin marcador ficticio en claro. No equivale a instalar o reiniciar Windows. |

La primera prueba de Explorer/temporales falló durante la preparación, antes de una exportación validada. Se añadió diagnóstico por etapa y se amplió la espera de arranque del vigilante a 30 s, manteniendo la obligación de ACK previo a la escritura. La repetición real pasó, incluida caída y caducidad. Las primeras regresiones de Edge agotaron la espera de 90 s al incorporar verificaciones NTFS reales; no se contaron como aprobadas. Las escrituras atómicas ya cifradas dejaron de lanzar comprobaciones PowerShell redundantes por checkpoint; se conservan los controles del directorio al iniciar el lote y los de lectura/exportación.

Otro intento de Edge falló por `EBUSY` cuando Vite intentó vigilar un temporal del compilador durante la reconstrucción del staging. Se excluyeron únicamente `build-windows` y `dist-windows` de la vigilancia de desarrollo, tanto en Vite como en el fixture. No se excluyeron fuentes ni pruebas. El intento fallido no se presenta como aprobación.

Tras ese recorrido, la revisión detectó una carrera del refresco de bandeja: su presentación pública llama «incierta» también a una intención que sigue en curso. Se corrigió la limpieza para actuar sobre el estado persistente realmente invalidado/incierto, sin retirar por un simple refresco el adjunto pendiente de asentarse. Se añadió regresión específica; no se convirtió incertidumbre en éxito ni se relajaron autorizaciones. El inventario previo de RC2 generado en este encargo se retiró por quedar obsoleto y se regeneró después de sincronizar la corrección con el staging; no se cambió el manifiesto público.

Staging real reconstruido: **0.6.0-rc.2**, 195,1 MB, Node 24.21.0 x64, host **NotSigned**, SHA-256 `437C620F1D83C593CC57F655E6088066EFB3F922BE185FF466AB37AC02A30C55`. Inventario nuevo `mediweb-downloader/dist-windows/CANDIDATE-0.6.0-rc.2.json`, 2264 archivos, cero discrepancias tras comprobar todos sus hashes; SHA-256 del inventario final `7C7B91952EC5A71CE2E06FCDDD9AC56D90E5C80FD860765FE1806FEE9444D928`. No existe Setup nuevo ni publicación. El rebuild sustituyó únicamente artefactos generados y dependencias Python de validación desechables dentro de `build-windows`, después de ejecutar 7/7 pruebas; no borró trabajo fuente ni instalación.

### Condiciones para documentos médicos reales y operación

- Antes de usar datos reales, TI/Privacidad debe aceptar expresamente los temporales legibles y sus residuos, comprobar el cifrado de dispositivo y recuperación, y definir cuentas, bloqueo de sesión, antimalware, sincronización, respaldos y retención. **Con cifrado de disco desconocido esta aceptación sigue pendiente.** El Connector no certifica ese cifrado ni una política institucional automáticamente.
- Probar con datos ficticios «Mostrar PDF/MP3», comprobar visualmente nombre/contenido/identidad, adjuntar manualmente al chat ficticio y finalizar. No enviar a trabajadores reales durante la aceptación. Mantener cerrados visores/adjuntos cuando se finaliza; si la limpieza falla, cerrarlos y reiniciar el Connector, sin borrar claves o catálogo.
- Probar corte del Connector, reinicio de Windows y arranque posterior: no deben quedar copias legibles antes de una nueva exportación. Probar permiso insuficiente, junction y bloqueo de archivo: deben impedir preparación insegura. Una sesión activa de otro Connector no se elimina automáticamente.
- Usar frontend y Connector **0.6.0-rc.2** del mismo conjunto. No se actualizó ni sustituyó el Connector instalado. El staging/inventario previo `0.6.0-rc.1` no contiene este cambio y no debe distribuirse como versión Home; sus hashes históricos no validan las fuentes actuales. El manifiesto público no se modificó.
- Siguen pendientes Setup/Inno, firma institucional, gateway/infraestructura reales, MediWeb y auditorías autorizadas. Los insumos siguen siendo `auditoria-local/primeras-hojas.pdf` y el posterior `clinical-audit/audit-cases.json`. No se fabricaron resultados.

### Archivos de este cambio

`mediweb-downloader/src/temporaryAttachments.js`, `encryptedOutput.js`, `windowsProtection.js`, `managedFiles.js`, `service.js`, `runner.js`, `manifest.js`, `processingFlow.js`, `deliveryService.js`, `http/routes.js`; `scripts/packaging.js` y sus pruebas; `test/temporary-attachments.test.js`; versión de package/lock/release local y prueba de versión; `src/services/mediwebService.js`, `src/components/PdfWorkersPreview.jsx`, `DeliveryInbox.jsx`; `scripts/home-attachments-check.js`, ajuste de `scripts/phase06-functional-check.js` y `prepare-distribution-candidate.js`, `vite.config.js`, este informe y la guía. No se alteraron dependencias del lock, secretos ni reglas clínicas.

## Antecedente histórico: candidata 0.6.0-rc.1, anterior al cambio Home

Lo siguiente conserva el diagnóstico y resultados anteriores. Sus requisitos EFS, hashes y dictamen corresponden a ese artefacto anterior; el dictamen vigente es el apartado Windows Home de arriba.

18 de octubre de 2026, America/Lima. Informe único de este encargo, posterior a Fase 06. Se conservaron los cambios locales. Sin commit, push, deploy, publicación, cambio de secretos, envío real ni consumo de créditos reales. No se creó otra fase ni se rediseñó la aplicación.

## Dictamen

**Candidata local preparada para revisión técnica, pendiente de aceptación institucional y bloqueada para distribución externa/producción.** Existen fuentes, build web y staging Windows identificables; no existe un Setup nuevo compilado ni firmado. Los bloqueos que dependen de Windows compatible, herramientas/certificados, infraestructura e insumos institucionales no se presentan como resueltos.

| Requisito | Estado | Resultado |
| --- | --- | --- |
| Diagnóstico de EFS | **APROBADO** | Se aisló falta de soporte de la edición Home; no es un simple fallo de escritura de la carpeta. |
| EFS operativo en esta máquina | **FALLIDO** | Win32 `EncryptFile`: error 50; no se habilitó una exportación alternativa. |
| Explorer con archivos EFS reales | **PENDIENTE** | Requiere máquina compatible y aceptación real; no se sustituyó por simulación. |
| Autorización de backend | **APROBADO en pruebas** | Node y FastAPI rechazan accesos sin credenciales de servidor; sin configuración quedan cerrados. |
| Identidad/roles de operador y gateway institucional real | **PENDIENTE** | La credencial de pasarela no identifica por sí sola a una persona. No se inventó SSO ni se configuraron secretos. |
| Controles de consumo por proceso | **APROBADO en pruebas** | Límites de texto, cuerpo, concurrencia, solicitudes y caracteres; voz restringida y fallos contados. |
| Presupuesto global/cuenta y múltiples réplicas | **PENDIENTE** | Contadores locales no son cuotas durables de cuenta. Exige política y controles en infraestructura/proveedor. |
| Versión candidata y recurso Windows | **APROBADO** | SemVer `0.6.0-rc.1`, recurso numérico `0.6.0.0`, lock y staging coincidentes. |
| Construcción de staging y recuperación | **APROBADO** | Runtime incluido, reinicio real de proceso y recuperación AES-GCM/DPAPI. No equivale a instalación. |
| Compilación del instalador | **FALLIDO** | Inno Setup/ISCC no está disponible en PATH, rutas habituales o configuración detectada. El comando termina con error. |
| Firma válida | **FALLIDO** | Host `NotSigned`; no existen insumos de firma configurados en el entorno de construcción. No se afirmó que estuviera firmado. |
| Instalación/actualización/desinstalación real | **PENDIENTE** | No se ejecutó Setup ni se modificó la instalación en uso. Usar VM/PC de prueba separada. |
| Actualización, integridad y reversión | **APROBADO en revisión/pruebas locales; aceptación real PENDIENTE** | HTTPS/hosts/SHA-256 y bloqueo de descarga activa conservados; publicación y aceptación del firmante pendientes. |
| MediWeb y Vercel institucionales | **PENDIENTE** | Se probaron recorridos locales con servicios ficticios, no autenticación institucional ni dominio desplegado. |
| Aceptación clínica | **PENDIENTE** | Faltan los dos insumos indicados abajo; no se fabricaron casos. |

## EFS: evidencia y causa

Comprobaciones reales y de solo lectura, más un archivo ficticio temporal creado y retirado dentro del build del repositorio:

| Dimensión | Evidencia |
| --- | --- |
| Edición | Registro: `EditionID=CoreSingleLanguage`; `ProductName=Windows 10 Home Single Language`, build `26200`. Se conserva el valor del registro sin inferir la marca comercial desde él. |
| Sistema de archivos | `NTFS`; `GetVolumeInformation` declara capacidad de cifrado del volumen. Esa bandera no acredita disponibilidad de EFS en la edición de Windows. |
| Permisos | Escritura/lectura del marcador ficticio correctas. ACL y DPAPI reales ya comprobados; la denegación no se reproduce como falta de acceso al archivo de prueba. |
| Configuración consultada | `NtfsDisableEncryption=0`; servicio EFS `Running`, inicio `Manual`. No se modificó registro, servicio ni política. No se afirma haber auditado todas las GPO institucionales. |
| Usuario | Cero certificados EFS visibles en `CurrentUser\My`. No se generaron/importaron certificados ni se alteró su configuración. No se atribuye el error 50 a esa ausencia. |
| API nativa | `EncryptFile` devuelve `false`, `GetLastWin32Error=50`; atributo Encrypted permanece falso. |
| .NET | `IOException`, HRESULT `-2147024846` (`0x80070032`), «Solicitud no compatible». |
| Restricciones de diagnóstico | WMI/CIM para SKU/volumen devolvió acceso denegado bajo el sandbox; se usaron registro y API Win32 para obtener evidencia independiente. No se elevaron cambios de Windows. |

El error 50 corresponde a solicitud no compatible y Microsoft documenta que el cifrado de archivos no está disponible en Home. La combinación observada explica el bloqueo; iniciar el servicio o cambiar ACL no aporta soporte de la edición. Fuentes: [cifrado de archivos de Microsoft](https://support.microsoft.com/en-us/windows/security/encryption/how-to-encrypt-a-file-or-folder), [códigos Win32](https://learn.microsoft.com/windows/win32/debug/system-error-codes--0-499-).

**Decisión institucional pendiente:** usar un equipo/edición compatible con EFS y validar certificado, clave privada, respaldo y directorio real. No se cambió la licencia ni se desactivó el requisito EFS. Explorer sigue bloqueado para archivos cuya protección no pueda comprobarse.

### Alternativa de cifrado: diseño, sin implementación

Si la institución decide no usar EFS, una alternativa requeriría un volumen cifrado administrado y verificado, ACL por usuario, protección/recuperación de claves y exportaciones limitadas a ese volumen. Debe verificarse protección al crear cada archivo, impedir rutas fuera del volumen, controlar su montaje/desmontaje, residuos, respaldos y acceso de otras cuentas, y aceptar el modelo de amenaza mientras la sesión está desbloqueada. El cifrado completo de dispositivo no se considera automáticamente equivalente a EFS por archivo: [Microsoft distingue Device Encryption y BitLocker](https://support.microsoft.com/en-us/windows/security/encryption/device-encryption-in-windows).

Hace falta aprobación formal de Seguridad/Privacidad, prueba de recuperación y aceptación de integración con Explorer/WhatsApp antes de modificar `ensureProtectedFile`. **No se implementó esa alternativa ni se agregó un bypass de EFS.**

## Defectos técnicos resueltos

1. **Acceso público a operaciones sensibles:** Node/Vercel y los plugins Vite exigen `INSTITUTIONAL_PROXY_TOKEN` para TTS externo y Sheets. FastAPI exige una credencial distinta, `TTS_SERVICE_ACCESS_TOKEN`. Comparaciones constantes, configuración ausente/inválida denegada y ningún token en React. `/health` de FastAPI permanece público sin contenido clínico; configuración, voces, documentación y síntesis quedan protegidas. No se modificaron archivos `.env` ni credenciales reales.
2. **Petición ilimitada/voz incorrecta:** cuerpos JSON acotados a 64 KiB y textos limitados, sin truncarlos. FastAPI impide cambiar a una voz distinta de la configurada, evitando discrepancias con la huella de configuración del MP3.
3. **Consumo backend sin límites:** admisión FastAPI por proceso, antes del proveedor, con concurrencia y ventanas de solicitudes/caracteres. Un fallo después de admitir no devuelve automáticamente presupuesto. No hay retries automáticos ni coste inventado. Las barreras de Fases 00–05 siguen activas y no se duplicó el motor clínico.
4. **Transporte del secreto:** Node solo envía la credencial de servicio a HTTPS o loopback local; no sigue redirects con ella. Se acotaron los tiempos de configuración/síntesis. Producción sin servicio configurado no ofrece un mock que aparente ser voz real.
5. **Firma silenciosamente ausente:** `sign-windows.js` devuelve error cuando faltan insumos y verifica Authenticode después de firmar. El staging de desarrollo puede existir sin firma, pero no se etiqueta como distribuible.
6. **Versión histórica ambigua:** candidata `0.6.0-rc.1` y mínima compatible local del mismo conjunto. Windows usa recurso numérico válido sin perder la etiqueta RC en ProductVersion. El manifiesto público histórico no se tocó y su hash no se reutiliza para esta candidata.
7. **Reemplazo de chat:** se reutiliza el WindowProxy vivo; al reemplazarlo se espera cierre y se rechazan aperturas simultáneas. Si Edge deniega el cierre, no se abre otra ventana ni se habilita la declaración de comprobación: el operador recibe instrucciones para cerrar la anterior y reabrir. Los consumidores esperan el resultado asíncrono. La preparación individual se reinicia al cambiar evaluación/identidad, incluso con teléfono compartido.
8. **Herramientas recorriendo artefactos:** lint excluye únicamente build/dist generados; las pruebas del Connector apuntan explícitamente a todos sus archivos `test/*.test.js`, sin recorrer dependencias aisladas. Ninguna prueba fuente fue deshabilitada.

### Configuración institucional necesaria, sin valores secretos

| Ajuste | Requisito |
| --- | --- |
| `INSTITUTIONAL_PROXY_TOKEN` | Secreto aleatorio de servidor, al menos 32 caracteres; compartido solo por gateway y backend Node. No navegador, Vite ni repositorio. |
| `TTS_SERVICE_ACCESS_TOKEN` | Secreto distinto de servidor, al menos 32 caracteres; backend Node y FastAPI. |
| Gateway | Autenticar identidad/roles reales, retirar cabeceras de autorización aportadas por el cliente e inyectar la credencial privada solo tras autorizar. Proteger frontend y evitar acceso a rutas sensibles eludiendo la pasarela. Aceptar CSRF/sesión y límites agregados con Seguridad. |
| `TTS_SERVICE_URL` | HTTPS al servicio protegido; loopback HTTP se permite únicamente para desarrollo local. |
| `TTS_MAX_CHARACTERS` | Por defecto 5000; configurable 1–20000 en ambos backends. Rechazo, nunca recorte o modificación de la narrativa. |
| `TTS_MAX_CONCURRENT_REQUESTS` | FastAPI: 1 por defecto, rango 1–3. |
| `TTS_MAX_REQUESTS_PER_MINUTE` | FastAPI: 10 por defecto, rango 1–120. |
| `TTS_MAX_CHARACTERS_PER_MINUTE` | FastAPI: 20000 por defecto, rango 1–200000. |

Son límites técnicos, **no tarifas ni créditos**. Los contadores están en memoria por proceso y se reinician con él; no representan cuota global, mensual, por operador ni de todas las réplicas. Antes de voz real, la institución debe fijar presupuesto agregado/durable y permisos de cuenta/API key, verificar escalado y timeouts, y probar el gateway real. No se configuró ese gateway ni se inventó la identidad de un operador. Las pruebas con credenciales ficticias demuestran los controles de código, no aceptación de infraestructura real.

## Candidata, integridad y distribución

- Connector/source: `0.6.0-rc.1`; ProductVersion `0.6.0-rc.1`, FileVersion `0.6.0.0`. Staging real de 195,1 MB, runtime Node `v24.21.0` x64.
- Host de staging: **NotSigned**, SHA-256 `DA02313D562D9DA066B0C99D462A09A5660F6E929955089DC14A205568EC7AC7` en esta construcción. No equivale a hash de Setup ni a firma de editor.
- Inventario privado de revisión: `mediweb-downloader/dist-windows/CANDIDATE-0.6.0-rc.1.json`, producido por `node scripts/prepare-distribution-candidate.js`. Incluye hashes de build web, staging y fuentes de backend; indica aceptación pendiente y ausencia de Setup. Está fuera de `public` y no publica nada. La escritura no sobrescribe otra candidata del mismo nombre.
- Comprobación posterior del inventario: 2262 archivos, cero discrepancias SHA-256. SHA-256 del propio inventario: `A9E72D2844D05FC23C88C60546F6DDD287C5210F4BC27F858C6F533570113232`. Los cambios posteriores de artefactos requieren un inventario nuevo y otra validación; este hash no constituye una firma digital.
- `public/connector-release.json` conserva su artefacto histórico 0.5.0. No apunta a esta candidata. No se ejecutó `release:prepare`, que modificaría el manifiesto público.
- El lock raíz no cambia. El lock del Connector cambia **solo dos campos de versión del paquete raíz**; no cambian dependencias ni integridades. Nuevo SHA-256: `DFC6DF4CB7894CD4285EF3A39B461D9BD155A9E0E74814C9E18206ED1C9B66FC`.

Inno Setup no se encontró en PATH, `ISCC_PATH` o rutas habituales. No se instaló globalmente ni se ejecutó Setup. La firma sigue pendiente de un certificado institucional y cadena de confianza válidos. No se usó un certificado autofirmado para aparentar aceptación.

Para construir en un entorno autorizado con Inno: ejecutar `build:windows:staging`, `sign:windows:host`, `smoke:windows:staging`, `build:windows:installer`, `sign:windows:setup`; comprobar firma válida y editor esperado de ambos ejecutables y calcular SHA-256 **después** de firmar. Aceptar instalación/actualización/desinstalación en una VM/PC sin la instalación utilizada actualmente. El actualizador conserva HTTPS, allowlist y SHA-256; la aceptación real de editor/cadena y del procedimiento de actualización sigue pendiente. No se publica un instalador solo porque su hash coincide.

## Regresión y evidencia

| Comprobación | Estado | Resultado |
| --- | --- | --- |
| `npm.cmd test` | APROBADO | 230/230, cero omitidas. |
| Connector `npm.cmd test` | APROBADO | 140/140, cero omitidas. |
| `npm.cmd run lint` / `npm.cmd run build` | APROBADO | Build web local, 114 módulos. |
| Connector `npm.cmd run check` | APROBADO | 50 archivos JavaScript. |
| Python acceso/admisión + rutas FastAPI ASGI | APROBADO, proveedor ficticio | 7/7: acceso ausente/incorrecto, contrato autorizado, cuerpo/texto/voz, errores sin datos y cuota conservada tras fallo. |
| `scripts/distribution-access-check.js` | APROBADO, prueba local | Edge→Vite→proveedor loopback; sin autorización no despacha, gateway ficticio permite una respuesta sintética. No demuestra SSO real. |
| Edge Fases 00–06 | APROBADO dentro del alcance ficticio | PDF manual, persistencia, verificación, TTS masivo, reutilización, carrera de edición, incertidumbre y bandeja con confirmaciones parciales. MediWeb/WhatsApp/TTS simulados; EFS/Explorer de fixtures no son aceptación real. |
| Staging/smoke | APROBADO en repetición aislada | Reinicio real del proceso incluido y recuperación cifrada con datos ficticios. Un intento concurrente agotó el límite de 12 s; la repetición aislada completó el recorrido. No se presume una causa única sin medición adicional. |
| Scan `public`/`dist` | APROBADO en su alcance | Sin artefactos médicos ni patrones de claves privadas conocidos; no equivale a pentest. |
| Auditorías clínica/narrativa | PENDIENTE; comandos fallan por insumos ausentes | Rutas exactas abajo. No se fabricaron resultados. |

Se instalaron FastAPI 0.115.6/httpx 0.28.1 y dependencias únicamente en `mediweb-downloader/build-windows/python-validation` para probar ASGI, fuera del staging y del Python global. La instalación/lectura inicial estaba restringida por el sandbox; se ejecutó con aprobación automática en ese destino aislado. Las pruebas inyectan configuración/proveedor ficticios antes de importar la aplicación: no cargan `.env`, SDK ni API keys reales. Python de pruebas 3.14 no sustituye aceptación de la imagen Python 3.11 de producción.

Se corrigieron también fixtures: codificación UTF-8 del chat ficticio y espera de navegación/cierre antes de declarar la comprobación. Se mantuvo la aserción estricta de una ventana. La prueba modela la intervención explícita del operador cuando Edge impide cerrar una conversación; no se habilitó una confirmación mediante un bypass. Se registraron los fallos previos de tres pestañas, timeout, colisión de puerto al ejecutar Vite simultáneamente y recorrido de artefactos de lint; no se presentan como ejecuciones inicialmente perfectas.

## Aceptación institucional: instrucciones y evidencia exigida

1. **IT Windows/EFS/Explorer:** en PC/VM autorizada con edición compatible y usuario definitivo, comprobar NTFS, política EFS, certificado con clave privada y respaldo. Proteger una carpeta ficticia antes de crear archivos, confirmar atributo Encrypted y lectura con el usuario correcto. Negar EFS/permisos y comprobar bloqueo. Desde Connector mostrar PDF/MP3 administrados en Explorer, cotejar hash/identidad y rechazar rutas externas, archivos cambiados o ausentes. Registrar equipo/edición, usuario mediante el procedimiento institucional y resultados, sin adjuntar secretos al repositorio.
2. **IT instalador:** compilar y firmar la RC con herramientas autorizadas; validar editor/cadena/hash. Usar VM/PC separada, porque el AppId del instalador es compartido y un directorio alternativo no garantiza aislamiento de una instalación existente. Probar Inicio, bandeja, inicio automático opcional, actualización con tarea activa, parada segura, reinicio Windows y desinstalación conservando catálogo/claves/perfil/descargas según la nueva fuente. No ejecutar el desinstalador anterior para actualizar: puede borrar LocalAppData.
3. **Seguridad/infraestructura:** configurar los dos secretos de servidor y autenticar identidad/roles en la pasarela. Desde dominio institucional real, confirmar rechazo sin sesión/credencial, ausencia de tokens en bundle/navegador/logs, autorización de configuración y síntesis, límites globales y de proceso y rechazo por rutas alternativas. Probar denegación del permiso de acceso local de Edge y recuperación autorizada; Connector permanece solo en `127.0.0.1`, con CORS exacto. No desactivar protecciones del navegador ni exponer localhost a Internet.
4. **Operador/MediWeb:** con sesión y casos de prueba institucionales autorizados, validar expiración/MFA manual, filtros guardados, paginación, exclusión por aptitud, duplicados y descargas parciales. Cotejar documento, fecha, ficha, teléfono y PDF completo; importar no debe aprobar. Recuperar tras cerrar/reiniciar sin repetir descargas inciertas. Utilizar TTS simulado y no enviar a trabajadores reales durante esta aceptación.
5. **Auditores clínicos:** suministrar `auditoria-local/primeras-hojas.pdf` autorizado y ejecutar `npm.cmd run clinical:audit`. Su salida necesaria para la narrativa es `clinical-audit/audit-cases.json`; después ejecutar `npm.cmd run narrative:audit`. Revisar correspondencia fuente/narrativa, flags, incertidumbre y bloqueos, registrar dictamen profesional. Mantener documentos/reportes privados fuera de Git. No fabricar insumos ni aprobar solo por pasar tests sintéticos.
6. **Operador de entregas:** con datos ficticios, verificar destinatarios inválidos/duplicados/sin WhatsApp, consentimiento vencido/revocado y cambio de identidad/texto/PDF/MP3. Conservar confirmaciones parciales tras recarga, cerrar manualmente un chat si Edge lo exige, conciliar respuestas inciertas y exigir reapertura motivada antes de repetir. Abrir/copiar/revelar no significa enviado; completar requiere declaraciones humanas separadas y cierre explícito.

## Actualización y reversión

Esperar guardado, pausar nuevas tareas y conciliar resultados inciertos antes de cualquier cambio. Respaldar catálogo/MP3 cifrados, claves DPAPI, perfil/configuración y descargas EFS mediante el procedimiento institucional; comprobar recuperación con el mismo usuario y preservar la recuperación EFS. Un archivo DPAPI copiado a otra máquina/usuario no garantiza descifrado.

Actualizar con Setup aprobado sin desinstalar antes y comprobar compatibilidad del conjunto frontend/Connector/TTS. Revertir únicamente a artefactos aprobados y compatibles, manteniendo cerrados los endpoints de voz mientras se verifica el acceso; no volver a código sin barreras de autorización para sortearlas. No borrar catálogo, claves o historial ni restaurar un respaldo viejo sobre operaciones nuevas sin conciliación: podría ocultar cargos/envíos ya iniciados. La corrección de conservación al desinstalar no cambia retroactivamente el desinstalador instalado actualmente.

## Cambios de este encargo

- Acceso/consumo: `server/ttsAccess.js`, `server/ttsService.js`, API TTS/configuración/Sheets y sus plugins Vite; `tts-service/app/access_control.py`, `main.py`.
- Regresión de acceso: `test/distribution-security.test.js`, ajuste de `test/phase-06-security.test.js`, `tts-service/test_access_control.py`, `test_http_access.py`, `scripts/distribution-access-check.js`.
- Cierre seguro de ventanas: `src/lib/whatsappReview.js`, consumidores `WhatsAppReviewQueue`, `PdfWorkersPreview`, `DeliveryInbox`; pruebas de popup y ajustes de fixtures de Fases 02/05. Sin nuevos envíos o pantallas.
- Candidata/build: versión de `mediweb-downloader/package.json`/lock, mínima de release local, `scripts/release-version.js`, builders host/Setup, metadatos Inno y firma estricta; `test/distribution-version.test.js`; `scripts/prepare-distribution-candidate.js`.
- Herramientas/documentación: exclusiones de artefactos en ESLint, descubrimiento explícito de pruebas fuente, actualización de la guía y este informe. Los informes históricos de Fases 00–06 se conservan.

**Resuelto en código:** barreras de acceso, límites locales efectivos, voz/configuración, transporte de credenciales, firma estricta, identificación RC y cierre seguro de conversaciones. **Pendiente institucional:** Windows con EFS, Explorer, Inno/Setup, certificado/editor, gateway/identidades/secretos reales y presupuesto agregado, Vercel/MediWeb reales y auditorías clínicas. No hay autorización de producción.
