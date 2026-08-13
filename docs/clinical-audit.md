# Auditoría clínica local

La auditoría usa el mismo `analyzePdfBatch` de la aplicación y después ejecuta el motor clínico central. No llama MediWeb, Connector, ElevenLabs ni servicios externos, y no genera audio.

## Comandos

```cmd
npm run clinical:audit -- "C:\ruta\primeras-hojas.pdf"
npm run clinical:audit -- --latest
npm run clinical:audit -- --all
npm run clinical:audit -- --all --sanitized
```

- Una ruta explícita tiene prioridad sobre otros modos.
- `--latest` busca únicamente en `%USERPROFILE%\Documents\AudioEvaluaciones\Descargas\*\audioevaluaciones\primeras-hojas.pdf` y selecciona por `mtime`, con desempate determinista por ruta.
- `--all` busca únicamente `primeras-hojas.pdf` y `primeras-hojas (N).pdf` dentro de `auditoria-local`.

## Archivos locales

Se generan bajo `clinical-audit/`:

- `audit-summary.json`: cifras globales, por archivo, por categoría y top de inconsistencias.
- `audit-cases.json`: raw/normalizado/narrativa/TTS/trazabilidad por caso.
- `audit-report-private.md`: reporte detallado con identidad para revisión local.
- `audit-report-sanitized.md`: opcional; reemplaza nombre, documento y empresa.

`auditoria-local/` y `clinical-audit/` están excluidos de Git. Los reportes privados pueden contener datos reales y no deben compartirse fuera del flujo autorizado.
