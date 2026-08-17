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
| `glucosa_source_reference_classification` | Valor, unidad y `glucosa_referencia` de la misma página | Compara exclusivamente con el intervalo impreso | `LOW`, `NORMAL` o `HIGH`; describe posición respecto del rango | No crea recomendaciones | Sin referencia o referencia no resoluble permanece en REVIEW |
| `trigliceridos_source_reference_classification` | Valor, unidad y categorías impresas de triglicéridos | Evalúa literalmente cada expresión y su etiqueta fuente | Conserva `NORMAL`, `BORDERLINE_HIGH`, `HIGH` o `VERY_HIGH` cuando la fuente lo demuestra | No crea recomendaciones | Huecos y solapamientos permanecen en REVIEW |
| `colesterol_source_reference_classification` | Valor, unidad y categorías impresas de colesterol total | Evalúa literalmente cada expresión y su etiqueta fuente | Conserva `NORMAL`, `BORDERLINE_HIGH` o `HIGH` cuando la fuente lo demuestra | No crea recomendaciones | No deriva “hipercolesterolemia” desde la cifra; huecos y solapamientos permanecen en REVIEW |
| `existing_leukocytes_rule` | `leucocitos_valor` | `>10000` | “ligeramente elevados” | Ninguna automática | Ambigua sin unidad/rango; heredada, sin test específico |
| `existing_platelets_rule` | `plaquetas_valor` | `<150000` o `>450000` | “disminuidas” o “elevadas” | Ninguna automática | Ambigua sin unidad/rango; heredada, sin test específico |
| `existing_ophthalmology_rule` | `oftalmologia_resultado` | Interpretación fuente contiene ametropía, presbicia, pterigión, visión, discromatopsia o ptosis | Conserva hallazgo normalizado | Solo recomendación oftalmológica fuente | Dependiente del parser/patrón; golden |
| `existing_audiometry_rule` | `audiometria_resultado` | Fuente contiene pendiente, hipoacusia, infranormal o alteración no debida a ruido | Conserva interpretación fuente | Solo recomendación audiométrica fuente | Dependiente del parser/patrón; golden |
| `existing_spirometry_rule` | `espirometria_resultado` | Resultado no normal explícitamente presente | Conserva interpretación fuente; no crea diagnóstico | Solo recomendación fuente | Correcta y golden |
| `existing_ecg_rule` | `ecg_resultado` | Resultado no normal y existe recomendación cardiológica | Conserva interpretación fuente | Recomendación fuente | Conservadora; hallazgo sin recomendación queda omitido y marcado internamente; falta test específico |
| `existing_musculoskeletal_rule` | `musculoesqueletico_resultado` | Contiene un hallazgo anormal explícito reconocido | Conserva interpretación fuente | Recomendación fuente | Los estados normal, regular o vinculados únicamente al IMC no se narran |
| `existing_other_findings_rule` | `otros_hallazgos_resultado` | Onicomicosis, hipertrigliceridemia, hiperglicemia, hiperlipidemia mixta o texto no reconocido | Extrae patrones y conserva remanente desconocido | Solo recomendación fuente | Algunos patrones duplican laboratorio y se resuelven por prioridad; falta ampliar tests |
| `normal_exam_summary` | Resultados cualitativos | Cada área debe estar explícitamente marcada normal | Nombra únicamente las áreas comprobadas | Ninguna | Corregida en Fase 5; golden |
| `aptitude_source_only` | `aptitud_final` | Valor explícito distinto de pendiente | Conserva categoría oficial | Ninguna | Correcta; nunca inferida |
| `clinical_conflict_*` | Audiometría, oftalmología, espirometría | Términos normales y anormales coexistentes | Omite/bloquea afirmación y crea flag | Ninguna | Nueva; test de conflicto |

## Recomendaciones y prioridad

Las recomendaciones se extraen del texto fuente y se clasifican por área: metabólica, oftalmología, audiometría, dermatología, ocupacional, cardiología, medicina interna, traumatología, neumología, gastroenterología, ginecología, psicología, alergias y vascular. La normalización deduplica textos equivalentes; una regla específica prevalece sobre el hallazgo genérico. No se prescriben fármacos ni se crean derivaciones por intuición.

## Políticas validadas en Fase 5.4

### ECG

Un ECG solo se narra cuando existe exactamente una recomendación fuente de cardiología y no hay otro hallazgo cardiovascular que compita por esa recomendación. Sin cardiología, el ECG se omite deliberadamente y genera `ecg_not_narrated_no_cardiology_recommendation` con nivel automático/informativo; no constituye omisión narrativa. Si la asociación es ambigua, no se narra el ECG y se mantienen `ecg_cardiology_association_ambiguous` y `ambiguous_recommendation_mapping` para revisión. Nunca se crean gravedad, causa, pronóstico, tratamiento ni recomendación cardiológica.

### Dermatología

Los hallazgos dermatológicos reconocidos conservan el contenido y la certeza de la fuente. `DESCARTAR`, `SOSPECHA DE` y `COMPATIBLE CON` no se eliminan ni se convierten en diagnóstico confirmado. La lateralidad solo se verbaliza cuando está explícita. Una recomendación dermatológica se añade al bloque únicamente si está presente en la fuente.

### Asociación de recomendaciones

Cada grupo se clasifica como `SAFE_ASSOCIATION`, `AMBIGUOUS_ASSOCIATION`, `NO_RELATED_FINDING` o `GENERAL_RECOMMENDATION`. Solo `SAFE_ASSOCIATION` permite redacción vinculada. Las asociaciones ambiguas se redactan de forma neutral y generan revisión; las recomendaciones generales no se fuerzan contra un hallazgo. Los textos fuente y la clasificación permanecen en `trace` mediante `recommendation_structural_association_policy`.

### Otros hallazgos

En PDFs Innomedic, el parser conserva `otros_hallazgos_resultado` por compatibilidad y añade `otros_hallazgos_items`. Estos elementos se reconstruyen desde la geometría PDF.js: página ascendente, coordenada Y descendente y coordenada X ascendente. La tolerancia de una línea es el 35 % de la altura mediana de sus textItems, acotada entre 0,75 y 3 puntos; los saltos horizontales superiores al máximo entre 24 puntos y cuatro alturas medianas preservan columnas distintas. Esta reconstrucción se limita a la sección entre `Otros` y `RESTRICCIONES`, después de `Ficha Odontograma`.

Cada línea reconstruida conserva página, texto fuente, posición, índices y textItems originales. El motor procesa esas líneas por separado y solo recurre al string legacy cuando la geometría no está disponible. Las asociaciones se permiten cuando la fuente demuestra área y correspondencia: un hallazgo y una recomendación, o una numeración explícita que cubre todos los hallazgos de la misma área. La separación espacial no resuelve por sí sola asociaciones metabólicas pendientes ni elimina ambigüedades clínicas.

Los hallazgos fuente explícitos aprobados para traslado neutral son eosinofilia con la instrucción de descartar parasitosis o alergias, faringitis, leucopenia, lipomatosis en mano derecha y quemadura de tercer grado. El texto conserva incertidumbre y localización; estas reglas no crean tratamiento, diagnóstico adicional ni recomendación. Los demás patrones no soportados siguen en revisión. Los bloques que carecen de separación geométrica inequívoca mantienen `ambiguous_other_findings_structure`.

### Hemoglobina

El parser extrae valor, unidad y los intervalos rotulados para hombres y mujeres desde la misma evaluación. No existen constantes clínicas de rango. El sexo explícito selecciona el intervalo aplicable y la clasificación es exclusivamente matemática: valor menor que el mínimo = `LOW`, inclusivo entre mínimo y máximo = `NORMAL`, y mayor que el máximo = `HIGH`. Sin intervalo se genera `hemoglobin_reference_range_missing`; con variantes o sexo no reconocido, `hemoglobin_reference_range_ambiguous`. La narrativa solo describe la posición respecto al rango impreso y nunca diagnostica anemia, policitemia ni una causa.

### Glucosa, colesterol y triglicéridos

El parser conserva por analito el valor y la unidad originales, el texto de referencia, la página, la geometría y los `textItems`. El intérprete común admite intervalos con guion ASCII o Unicode, decimales con punto o coma y comparadores `<`, `<=`, `>`, `>=`, `≤` y `≥`. La inclusividad se toma literalmente de la fuente.

Glucosa usa el intervalo simple impreso en su propia página. Colesterol total y triglicéridos usan las categorías y etiquetas impresas; los límites no existen como constantes clínicas del motor. Si ninguna categoría cubre el valor, si más de una lo cubre o si la expresión no puede analizarse, el motor no completa el hueco ni elige una categoría: genera un flag específico de referencia y solicita REVIEW.

La clasificación y la recomendación son decisiones separadas. Los analitos normales se resumen en una sola frase, adaptada a los resultados disponibles, sin leer cifras ni unidades individuales. Los resultados bajos, altos, límite alto o muy alto se narran por separado con su cifra, unidad y clasificación derivada de la referencia fuente. Ninguna clasificación genera diagnóstico, especialidad, dieta, tratamiento ni seguimiento. Las recomendaciones solo proceden de la fuente y un mapeo ambiguo continúa en REVIEW. El texto fuente diagnóstico se conserva como evidencia separada; solo se suprime en display una duplicación exacta y conservadora de “hipercolesterolemia límite alto” cuando la clasificación numérica fuente ya comunica ese mismo concepto.

### Musculoesquelético y anemia

La evaluación musculoesquelética solo se incluye cuando existe un hallazgo anormal explícito reconocido. Un estado normal o regular, el IMC elevado y las recomendaciones por peso no crean por sí solos un bloque musculoesquelético.

Cuando la fuente contiene explícitamente anemia y también una recomendación de Medicina Interna, ambas se presentan en el mismo bloque, primero el hallazgo y después la recomendación. La anemia aislada no crea una derivación y una recomendación de Medicina Interna aislada no crea anemia.

## Review flags

Tipos principales: `conflicting_values`, `ambiguous_interpretation`, `unknown_value`, `empty_placeholder`, `orphan_recommendation`, `ambiguous_recommendation_mapping`, `ambiguous_other_findings_structure`, `ecg_not_narrated_no_cardiology_recommendation`, `ecg_cardiology_association_ambiguous`, `hemoglobin_reference_range_missing` y `hemoglobin_reference_range_ambiguous`. Niveles: `automatic`, `review_recommended`, `manual_only`. No se calculan porcentajes. Un conflicto clínico impide producir narrativa automática; otros flags no bloquean el lote.

## Trazabilidad y métricas locales

`trace` conserva `sourceField`, `ruleId`, `originalValue` y `normalizedValue`. `metrics` informa número de flags, campos normalizados y fragmentos generados. No hay telemetría ni contenido clínico enviado a servicios nuevos.

## Reglas pendientes de definición clínica

- Política institucional de recomendaciones para glucosa, colesterol y triglicéridos; la clasificación numérica ya usa exclusivamente la referencia impresa. Los rangos de leucocitos y plaquetas siguen pendientes. Hemoglobina usa exclusivamente el rango impreso en cada evaluación.
- Política para calcular IMC cuando no venga informado y cómo resolver discrepancias con la categoría fuente.
- Catálogo validado de sinónimos normales/anormales por especialidad.
- Recomendaciones autorizadas por hallazgo y prioridad/severidad institucional.
- Cuándo un conjunto completo permite afirmar “hemograma sin alteraciones”. Actualmente no se afirma.
- Manejo clínico de valores sin unidad y de resultados con rangos explícitos impresos en el PDF.

Hasta contar con estas definiciones, las reglas heredadas se mantienen sin ampliar y los patrones desconocidos conservan el dato para revisión.

## Fase 5.8: comparación metabólica fuente–clasificación

La clasificación numérica de glucosa, colesterol y triglicéridos continúa usando únicamente los rangos impresos extraídos del mismo informe. Los textos metabólicos explícitos del campo `Otros` se comparan con esa clasificación, sin convertirlos en diagnósticos derivados:

- `EXACT_EQUIVALENT`: se evita repetir el mismo contenido, pero se conserva la traza fuente.
- `ADDITIONAL_SOURCE_INFORMATION`: se conserva y comunica el dato adicional explícito, por ejemplo `en tratamiento` o una calificación conjunta impresa.
- `DISCREPANT`: se muestran la clasificación numérica y el texto fuente sin elegir uno, y se genera `metabolic_source_classification_conflict`.

Una recomendación metabólica solo se asocia de forma segura cuando existe una correspondencia estructural uno a uno o una numeración explícita que abarque el bloque completo. Una recomendación única para varios hallazgos sin esa señal ya no se considera segura por política legacy. Los resultados se narran primero y la recomendación fuente se presenta después con una transición neutral; no se crea causalidad entre ambos.

Los hallazgos fuente simples catalogados en esta fase pueden trasladarse literalmente mediante una formulación neutral. Esto no les asigna especialidad, recomendación, tratamiento ni interpretación nueva. Las asociaciones clínicas múltiples, los huérfanos verdaderos, la competencia cardiológica y `PVC` permanecen en REVIEW.
