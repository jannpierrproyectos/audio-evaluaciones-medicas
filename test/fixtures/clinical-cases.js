function baseWorker(overrides = {}) {
  const worker = {
    identificacion: {
      nombres: "ANA",
      apellidos: "QUISPE",
      nombre_completo_original: "ANA QUISPE",
      empresa: "EMPRESA DEMO",
      sexo: "F",
    },
    datos_generales_narrables: {},
    laboratorio_numerico: {},
    evaluaciones_cualitativas: {},
    aptitud_y_recomendaciones: {
      aptitud_final: "APTO",
      recomendaciones_generales_texto: "",
      restricciones_texto: "",
    },
    derived_states: { reviewed_by_user: true },
    validation: { warnings: [], has_errors: false },
  };

  return {
    ...worker,
    ...overrides,
    identificacion: { ...worker.identificacion, ...(overrides.identificacion || {}) },
    datos_generales_narrables: { ...worker.datos_generales_narrables, ...(overrides.datos_generales_narrables || {}) },
    laboratorio_numerico: { ...worker.laboratorio_numerico, ...(overrides.laboratorio_numerico || {}) },
    evaluaciones_cualitativas: { ...worker.evaluaciones_cualitativas, ...(overrides.evaluaciones_cualitativas || {}) },
    aptitud_y_recomendaciones: { ...worker.aptitud_y_recomendaciones, ...(overrides.aptitud_y_recomendaciones || {}) },
    derived_states: { ...worker.derived_states, ...(overrides.derived_states || {}) },
    validation: { ...worker.validation, ...(overrides.validation || {}) },
  };
}

export const clinicalCases = {
  A_NORMAL: baseWorker({
    evaluaciones_cualitativas: {
      audiometria_resultado: "AUDIOMETRIA NORMAL",
      oftalmologia_resultado: "OFTALMOLOGIA NORMAL",
      espirometria_resultado: "ESPIROMETRIA NORMAL",
    },
  }),
  B_METABOLIC: baseWorker({
    datos_generales_narrables: { peso_kg: 72, talla_cm: 165, imc: 26.4 },
    laboratorio_numerico: {
      trigliceridos_valor: 180,
      trigliceridos_valor_fuente: "180",
      trigliceridos_unidad: "mg/dL",
      trigliceridos_referencia: {
        rawText: "Normal: <150 | Limite Alto: 150-199 | Alto: 200-499 | Muy Alto: >500",
        categories: [
          { classification: "NORMAL", labelRaw: "Normal", expression: { type: "comparison", operator: "<", boundary: 150 } },
          { classification: "BORDERLINE_HIGH", labelRaw: "Limite Alto", expression: { type: "range", min: 150, max: 199, minInclusive: true, maxInclusive: true } },
          { classification: "HIGH", labelRaw: "Alto", expression: { type: "range", min: 200, max: 499, minInclusive: true, maxInclusive: true } },
          { classification: "VERY_HIGH", labelRaw: "Muy Alto", expression: { type: "comparison", operator: ">", boundary: 500 } },
        ],
      },
    },
    evaluaciones_cualitativas: { valoracion_imc_resultado: "SOBREPESO" },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "CONTROL POR NUTRICION" },
  }),
  C_OPHTHALMOLOGY: baseWorker({
    evaluaciones_cualitativas: { oftalmologia_resultado: "AMETROPIA" },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "USO DE CORRECTORES OCULARES Y CONTROL POR OFTALMOLOGIA" },
  }),
  D_AUDIOMETRY: baseWorker({
    evaluaciones_cualitativas: { audiometria_resultado: "HIPOACUSIA LEVE" },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "CONTROL POR OTORRINOLARINGOLOGIA" },
  }),
  E_SPIROMETRY: baseWorker({
    evaluaciones_cualitativas: { espirometria_resultado: "PATRON RESTRICTIVO LEVE" },
    aptitud_y_recomendaciones: { recomendaciones_generales_texto: "CONTROL POR NEUMOLOGIA" },
  }),
  F_MULTIPLE: baseWorker({
    datos_generales_narrables: { imc: 31.2, peso_kg: 82, talla_cm: 162 },
    laboratorio_numerico: {
      trigliceridos_valor: 220,
      trigliceridos_valor_fuente: "220",
      trigliceridos_unidad: "mg/dL",
      trigliceridos_referencia: {
        rawText: "Normal: <150 | Limite Alto: 150-199 | Alto: 200-499 | Muy Alto: >500",
        categories: [
          { classification: "NORMAL", labelRaw: "Normal", expression: { type: "comparison", operator: "<", boundary: 150 } },
          { classification: "BORDERLINE_HIGH", labelRaw: "Limite Alto", expression: { type: "range", min: 150, max: 199, minInclusive: true, maxInclusive: true } },
          { classification: "HIGH", labelRaw: "Alto", expression: { type: "range", min: 200, max: 499, minInclusive: true, maxInclusive: true } },
          { classification: "VERY_HIGH", labelRaw: "Muy Alto", expression: { type: "comparison", operator: ">", boundary: 500 } },
        ],
      },
    },
    evaluaciones_cualitativas: {
      valoracion_imc_resultado: "OBESIDAD TIPO I",
      oftalmologia_resultado: "AMETROPIA",
      audiometria_resultado: "HIPOACUSIA LEVE",
    },
    aptitud_y_recomendaciones: {
      recomendaciones_generales_texto: "CONTROL POR NUTRICION. USO DE CORRECTORES OCULARES Y CONTROL POR OFTALMOLOGIA. CONTROL POR OTORRINOLARINGOLOGIA",
    },
  }),
  G_INCOMPLETE: baseWorker({
    datos_generales_narrables: { imc: "N/A", peso_kg: "-", talla_cm: "SIN DATO" },
    evaluaciones_cualitativas: { audiometria_resultado: "NO REGISTRA" },
  }),
  H_ALL_CAPS: baseWorker({
    evaluaciones_cualitativas: {
      audiometria_resultado: "AUDIOMETRIA NORMAL",
      oftalmologia_resultado: "VISION CONSERVADA",
      espirometria_resultado: "ESPIROMETRIA NORMAL",
    },
  }),
  I_DUPLICATES: baseWorker({
    evaluaciones_cualitativas: { oftalmologia_resultado: "AMETROPIA; AMETROPIA" },
    aptitud_y_recomendaciones: {
      recomendaciones_generales_texto: "CONTROL POR OFTALMOLOGIA. CONTROL POR OFTALMOLOGIA",
    },
  }),
  J_CONFLICT: baseWorker({
    evaluaciones_cualitativas: { audiometria_resultado: "AUDIOMETRIA NORMAL. HIPOACUSIA LEVE" },
  }),
};

export { baseWorker };
