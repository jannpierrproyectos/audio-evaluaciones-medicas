# MediWeb Downloader

Modulo local e independiente para convertir los reportes `Imp S.F` visibles en MediWeb a PDF. El inicio de sesion, la navegacion y la seleccion de filtros son siempre manuales. La automatizacion comienza unicamente cuando el usuario vuelve a la terminal y presiona Enter.

## Requisitos

- Windows con PowerShell.
- Node.js 20 o posterior.
- Acceso autorizado a `https://resultados.innomedic.pe`.
- Espacio local suficiente para los PDF clinicos.

## Instalacion

```powershell
cd C:\Users\USER\Documents\AudioEvaluaciones\mediweb-downloader
npm install
npx playwright install chromium
```

La instalacion de Chromium es necesaria una vez por equipo o cuando Playwright la solicite.

## Ejecucion

```powershell
npm run start
```

El programa abre Chromium de forma visible. En el navegador:

1. Selecciona el local e inicia sesion manualmente.
2. Abre **Atenciones -> Ocupacional**.
3. Configura fechas y los demas filtros.
4. Pulsa **Buscar** y comprueba que la tabla muestre `Imp S.F`.
5. Regresa a PowerShell y presiona Enter.

No se leen ni almacenan usuario, contrasena, cookies, tokens o encabezados de autenticacion. Playwright conserva su perfil local en `.auth/mediweb-profile`, carpeta ignorada por Git.

## Modos y argumentos

- `first`: crea un unico `primeras-hojas.pdf`, con la primera pagina de cada reporte correcto.
- `full`: crea un PDF completo e independiente por atencion.
- `both`: crea ambos resultados; cada reporte se carga y se convierte una sola vez.

```powershell
npm run start -- --mode first
npm run start -- --mode full --output "C:\ReportesMediWeb"
npm run start -- --mode both --limit 1
npm run start -- --limit 1
```

Opcionalmente, `--delay 1200` ajusta la pausa secuencial entre reportes en milisegundos. El valor predeterminado es 900 ms. `--output` establece la carpeta base; dentro de ella siempre se crea una subcarpeta fechada para evitar sobrescrituras.

## Filtro de aptitud

Por defecto, solo se procesan las atenciones cuyo texto normalizado de aptitud comienza con `APTO`, incluyendo `APTO CON RESTRICCION` y `APTO CON RESTRICCIONES`. Se excluyen `OBSERVADO`, `PENDIENTE`, `NO APTO`, los textos vacios y los estados desconocidos. La clasificacion usa el texto de la columna Aptitud; no depende de colores ni estilos de la tabla.

El filtro se aplica despues de detectar y eliminar enlaces duplicados. `--limit` se aplica posteriormente y cuenta solo atenciones elegibles. Sin `--limit`, se procesan todas las atenciones elegibles visibles en la pagina actual.

Prueba corta con cinco trabajadores elegibles:

```powershell
npm run start -- --mode both --limit 5
```

Procesar todos los elegibles visibles:

```powershell
npm run start -- --mode both
```

Las atenciones excluidas se registran en `manifest.json` y `resultados.csv`, pero sus reportes no se abren y no cuentan como procesados, errores ni archivos generados.

## Primera prueba recomendada

Procesa una sola atencion antes de ampliar el limite:

```powershell
npm run start -- --mode both --limit 1
```

Compara visualmente el PDF completo y la primera hoja generados con un PDF guardado manualmente desde Chrome. El modulo no presupone que ambos sean identicos; los estilos y tiempos de carga reales de MediWeb deben validarse.

## Salida

Por defecto, cada ejecucion crea:

```text
downloads\YYYY-MM-DD_HH-mm-ss\
  audioevaluaciones\primeras-hojas.pdf
  reportes-completos\001_CODIGO_PACIENTE.pdf
  control\manifest.json
  control\resultados.csv
```

Solo se crean las carpetas de PDF correspondientes al modo elegido. Los archivos de control se actualizan despues de cada atencion. Los nombres individuales son compatibles con Windows, tienen longitud limitada y nunca sobrescriben un archivo existente.

## Privacidad

La ejecucion es local y no incluye telemetria, analytics, nube, correo, WhatsApp ni llamadas a APIs externas. No se registra la URL completa del reporte ni se imprime el nombre del paciente durante el progreso. Los PDF, el perfil del navegador y los logs locales estan excluidos de Git.

## Limitaciones del MVP

**Esta version procesa solamente las atenciones elegibles visibles en la pagina actual de MediWeb.** No pulsa `Anterior` o `Siguiente`, no automatiza credenciales, menus, filtros ni `Buscar`, y procesa con concurrencia 1. No envia reportes ni se integra con AudioEvaluaciones.

La sesion puede caducar. En ese caso, el programa conserva lo generado, solicita iniciar sesion otra vez y pide regresar manualmente a la tabla. Cada atencion admite como maximo dos intentos.

## Solucion de problemas

- **No se encuentran enlaces:** verifica que la tabla tenga filas reales y una accion `Imp S.F`, no solo estadisticas o resumenes.
- **Chromium no abre:** ejecuta `npx playwright install chromium` desde esta carpeta.
- **El reporte queda en blanco:** espera a que MediWeb responda y reintenta. La herramienta espera el titulo del reporte, imagenes y una altura estable hasta 120 segundos.
- **Sesion expirada:** inicia sesion manualmente, repite la busqueda y presiona Enter cuando la tabla vuelva a estar visible.
- **PDF diferente al manual:** compara saltos de pagina, imagenes y CSS de impresion. `preferCSSPageSize` esta centralizado en `src/pdfGenerator.js` para poder ajustarlo despues de la prueba visual.
- **Interrupcion:** Ctrl+C guarda el control disponible y conserva todos los PDF validos ya creados.
