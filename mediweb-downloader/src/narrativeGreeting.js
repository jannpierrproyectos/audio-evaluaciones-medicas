export const NARRATIVE_GREETINGS = [
  "Buenos días",
  "Buenas tardes",
  "Buenas noches",
];

export const DEFAULT_NARRATIVE_GREETING = NARRATIVE_GREETINGS[0];

const INITIAL_GREETING_PATTERN =
  /^(?:\s*(?:Buenos días|Buenas tardes|Buenas noches)\s*([,.!])?\s*)+/i;

export function applyNarrativeGreeting(text, greeting = DEFAULT_NARRATIVE_GREETING) {
  const normalizedText = String(text || "").trimStart();
  const safeGreeting = NARRATIVE_GREETINGS.includes(greeting)
    ? greeting
    : DEFAULT_NARRATIVE_GREETING;

  if (!normalizedText) return "";

  const greetingMatch = normalizedText.match(INITIAL_GREETING_PATTERN);

  if (!greetingMatch) {
    return `${safeGreeting}. ${normalizedText}`;
  }

  const punctuation = greetingMatch[1] || ",";
  return `${safeGreeting}${punctuation} ${normalizedText.slice(greetingMatch[0].length)}`;
}
