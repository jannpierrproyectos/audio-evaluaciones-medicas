# Motor clínico determinista

## Límites de seguridad

El motor no diagnostica ni completa datos ausentes. Cada fragmento se deriva de un campo fuente, una interpretación explícita o una regla heredada documentada. Los valores originales permanecen en `rawWorker`; la normalización trabaja sobre una copia. Los conflictos bloquean el borrador automático y producen `conflicting_values`.

Pipeline:

```text
raw worker
  -> normalizeWorkerClinicalData
  -> collectReviewFlags
  -> applyClinicalRules
  -> buildWorkerNarrative
  -> normalizeNarrativeForDisplay
  -> prepareTextForTts
```

## Reglas activas

| ruleId | Campo fuente | Condición | Texto/efecto | Recomendación | Auditoría |
|---|---|---|---|---|---|
| `existing_imc_rule` | `peso_kg`, `talla_cm`, `imc` | IMC numérico ya presente; clasificación heredada: `<18.5`, `<25`, `<30`, `<35`, `<40`, resto | Bajo peso, normal, sobrepeso u obesidad I–III | Solo usa recomendación metabólica presente en fuente | Correcta como regla heredada; requiere validación clínica formal de umbrales y política de cálculo futuro |
| `existing_glucose_rule` | `glucosa_valor` | `>100`; severidad desde `126` | “elevada”/“límite alto”; nunca “diabetes” | Solo recomendaciones clasificadas desde la fuente | Ambigua sin ayuno/rango del informe; heredada y pendiente de definición clínica |
| `existing_triglycerides_rule` | `trigliceridos_valor` | `>=150`; alteración desde `200` | “límite alto” o “elevados” | Solo recomendación metabólica fuente | Heredada, cubierta por golden test; falta validar rangos institucionales |
| `existing_cholesterol_rule` | `colesterol_valor` | `>=200`; alteración desde `240` | “límite alto” o “elevado” | Solo recomendación metabólica fuente | Heredada; falta golden específico y rango explícito del reporte |
| `existing_leukocytes_rule` | `leucocitos_valor` | `>10000` | “ligeramente elevados” | Ninguna automática | Ambigua sin unidad/rango; heredada, sin test específico |
| `existing_platelets_rule` | `plaquetas_valor` | `<150000` o `>450000` | “disminuidas” o “elevadas” | Ninguna automática | Ambigua sin unidad/rango; heredada, sin test específico |
| `existing_ophthalmology_rule` | `oftalmologia_resultado` | Interpretación fuente contiene ametropía, presbicia, pterigión, visión, discromatopsia o ptosis | Conserva hallazgo normalizado | Solo recomendación oftalmológica fuente | Dependiente del parser/patrón; golden |
| `existing_audiometry_rule` | `audiometria_resultado` | Fuente contiene pendiente, hipoacusia, infranormal o alteración no debida a ruido | Conserva interpretación fuente | Solo recomendación audiométrica fuente | Dependiente del parser/patrón; golden |
| `existing_spirometry_rule` | `espirometria_resultado` | Resultado no normal explícitamente presente | Conserva interpretación fuente; no crea diagnóstico | Solo recomendación fuente | Correcta y golden |
| `existing_ecg_rule` | `ecg_resultado` | Resultado no normal y existe recomendación cardiológica | Conserva interpretación fuente | Recomendación fuente | Conservadora; hallazgo sin recomendación queda omitido y marcado internamente; falta test específico |
| `existing_musculoskeletal_rule` | `musculoesqueletico_resultado` | Contiene regular, alterado, IMC o masa corporal | Conserva interpretación fuente | Recomendación fuente | Dependiente del parser; sin test específico |
| `existing_other_findings_rule` | `otros_hallazgos_resultado` | Onicomicosis, hipertrigliceridemia, hiperglicemia, hiperlipidemia mixta o texto no reconocido | Extrae patrones y conserva remanente desconocido | Solo recomendación fuente | Algunos patrones duplican laboratorio y se resuelven por prioridad; falta ampliar tests |
| `normal_exam_summary` | Resultados cualitativos | Cada área debe estar explícitamente marcada normal | Nombra únicamente las áreas comprobadas | Ninguna | Corregida en Fase 5; golden |
| `aptitude_source_only` | `aptitud_final` | Valor explícito distinto de pendiente | Conserva categoría oficial | Ninguna | Correcta; nunca inferida |
| `clinical_conflict_*` | Audiometría, oftalmología, espirometría | Términos normales y anormales coexistentes | Omite/bloquea afirmación y crea flag | Ninguna | Nueva; test de conflicto |

## Recomendaciones y prioridad

Las recomendaciones se extraen del texto fuente y se clasifican por área: metabólica, oftalmología, audiometría, dermatología, ocupacional, cardiología, medicina interna, traumatología, neumología, gastroenterología, ginecología, psicología, alergias y vascular. La normalización deduplica textos equivalentes; una regla específica prevalece sobre el hallazgo genérico. No se prescriben fármacos ni se crean derivaciones por intuición.

## Review flags

Tipos implementados: `conflicting_values`, `ambiguous_interpretation`, `unknown_value` y `empty_placeholder`. Niveles: `automatic`, `review_recommended`, `manual_only`. No se calculan porcentajes. Un conflicto clínico impide producir narrativa automática; otros flags no bloquean el lote.

## Trazabilidad y métricas locales

`trace` conserva `sourceField`, `ruleId`, `originalValue` y `normalizedValue`. `metrics` informa número de flags, campos normalizados y fragmentos generados. No hay telemetría ni contenido clínico enviado a servicios nuevos.

## Reglas pendientes de definición clínica

- Rangos institucionales por edad, sexo, ayuno, unidad y laboratorio para glucosa, colesterol, triglicéridos, hemoglobina, leucocitos y plaquetas.
- Política para calcular IMC cuando no venga informado y cómo resolver discrepancias con la categoría fuente.
- Catálogo validado de sinónimos normales/anormales por especialidad.
- Recomendaciones autorizadas por hallazgo y prioridad/severidad institucional.
- Cuándo un conjunto completo permite afirmar “hemograma sin alteraciones”. Actualmente no se afirma.
- Manejo clínico de valores sin unidad y de resultados con rangos explícitos impresos en el PDF.

Hasta contar con estas definiciones, las reglas heredadas se mantienen sin ampliar y los patrones desconocidos conservan el dato para revisión.
