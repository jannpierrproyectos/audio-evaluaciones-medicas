# Corrección de la versión publicada

Se corrigió la dirección oficial `https://audio-evaluaciones-medicas.vercel.app`
con autorización del operador para resolver la publicación del diseño anterior.

## Causa comprobada

- La dirección oficial y la Preview `ptu5ficma` estaban construidas desde `main`,
  commit `9d90e4e5a95cb92177bcf785aa4d4cf47ccdb479`.
- Los redeploys repetían ese código. El rediseño ya estaba en la rama
  `ux/flujo-operativo-simplificado`, commit
  `7052ceb791469897c56d09862dd19c6244189bc5`.
- Los cambios de Google permanecían locales, sin commit, y se excluyeron de esta
  publicación. El acceso real con Google sigue pendiente de validar en Preview.

## Publicación realizada

Se generó una copia limpia mediante `git archive 7052ceb`, sin los archivos
modificados del espacio de trabajo. Se verificó la lista de subida: 263 archivos,
sin `.gitignore`, archivos de entorno, JSON de credenciales, archivos clínicos ni
la integración Google pendiente.

Se creó un despliegue de producción con `--skip-domain`, se comprobó y después se
promovió mediante la CLI oficial autenticada por el propio operador:

- Proyecto: `prj_y7Wwp5Vl2SJXUOXjPWx7D9jqZDp3`.
- Equipo: `jannpierrproyectos-projects`.
- Anterior: `dpl_6oftBvQekgGqPWsvkvjGXc96fS35`.
- Publicado: `dpl_DbmvGqZniMhBsomda33ReRh3aw6G`.
- URL de la revisión: `https://audio-evaluaciones-medicas-qdvehc2pb.vercel.app`.
- JavaScript oficial verificado: `/assets/index-CquKUHJw.js`.

## Verificación

- Compilación en Vercel y 11 pruebas de seguridad correctas.
- Dominio oficial resuelve al despliegue publicado y al commit del rediseño.
- Navegación nueva presente; casilla redundante ausente.
- `/api/tts/configuration`: ElevenLabs, `eleven_flash_v2_5`, MP3.
- `/api/tts/session`: acceso configurado, solicitud anónima sin autenticar.
- Solicitud anónima con texto vacío rechazada con 401. No se solicitó voz real.
- Edge real: escritorio y móvil, cero errores de página. Se bloqueó todo acceso
  al Connector instalado y se inspeccionaron las capturas resultantes.
- Consulta limitada a respuestas 5xx del despliegue, ventana de diez minutos:
  cero registros devueltos. No se imprimieron contenidos de solicitudes.
- Evidencia: `artifacts/production-restored/`.

No se modificaron los lotes clínicos, el Connector instalado, Hugging Face o las
claves de ElevenLabs. Las variables de producción se reutilizaron sin editarlas.

## Riesgo de volver a publicar la revisión anterior

`main` sigue sin contener el rediseño. No hacer Redeploy del commit `9d90e4e` ni
volver a promover sus despliegues: sustituiría nuevamente la versión corregida.
Integrar el rediseño en `main` será un cambio de repositorio separado. La rama de
producción y sus automatismos no se cambiaron para evitar que una futura subida
de Google a la rama de trabajo lo publique sin validación.
