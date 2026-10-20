import { whatsappState } from "./whatsappReview.js";
import { getAudioAuthorization } from "./clinicalApproval.js";
import { applyNarrativeGreeting } from "./narrativeGreeting.js";

export function flowSummary(analysis) {
  const workers = analysis?.workers || [];
  return workers.reduce((summary, worker) => {
    const status = whatsappState(worker);
    if (status === "confirmado_por_operador" || status === "no_disponible") summary.contactsResolved++;
    const authorization = getAudioAuthorization(worker, applyNarrativeGreeting(worker.app_fields?.texto_final, analysis.greeting));
    const approved = authorization.approval === "aprobada" && authorization.validation !== "bloqueada" && authorization.extraction === "extraido";
    if (approved) summary.approved++;
    if (approved && worker.app_fields?.audio_record && !worker.app_fields.audio_stale) summary.audio++;
    if (worker.app_fields?.audio_status === "generando") summary.generating++;
    return summary;
  }, { total: workers.length, contactsResolved: 0, approved: 0, audio: 0, generating: analysis?.bulk_audio_queue?.status === "ejecutando" ? 1 : 0 });
}
export function suggestedFlowStep(analysis) {
  const summary = flowSummary(analysis);
  if (analysis?.review_ui?.flow_step === "delivery" && summary.audio) return "delivery";
  if (analysis?.review_ui?.flow_step === "review") return "review";
  return summary.contactsResolved < summary.total ? "whatsapp" : "review";
}
