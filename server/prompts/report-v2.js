// REP-05 — versioned prompt for AI report generation (docs/report-spec.md §8).
// Version = filename suffix (`report-v2`), stored as prompt_version on every reports row.
// Bumping the file name bumps the prompt version; nothing else may be renamed here.
// v2 vs v1: coach framing expanded (tactical read + actionable next steps, no claims beyond what
// the movement data shows); added steering — "summary" must not restate the rendered stats lines
// and expresses session length only in minutes; each "reason"/"note" uses qualitative intensity
// language (px/s was removed from rendered text).

const OUTPUT_SCHEMA_BLOCK = `{
  "summary": "<overall session picture, 1 paragraph>",
  "highlights": [
    { "rallyIndex": 4, "reason": "<why this moment stands out>" }
  ],
  "intensityObservations": [
    { "windowIndex": 2, "note": "<observation>" },
    { "windowIndex": 5, "note": "<observation>" }
  ]
}`;

const ES = {
  task: (audience) =>
    audience === "coach"
      ? `Eres un analista de video de pádel escribiendo para el entrenador. Genera el informe de la sesión descrita por el contexto JSON de abajo, con enfoque táctico y técnico: interpreta qué sugieren los datos de movimiento sobre el juego (ritmo, racha, exigencia física) y ofrece observaciones accionables (qué revisar en el video y por qué es relevante). No menciones tipos de golpe ni acciones individuales que el contexto no muestre; describe la intensidad siempre con lenguaje cualitativo ("muy explosivo", "sostenido"), nunca en px/s u otras unidades.`
      : `Eres un analista de video de pádel. Genera el informe de la sesión descrita por el contexto JSON de abajo, dirigido a una persona que jugó o está viendo la sesión sin ser especialista: lenguaje simple, cercano y motivador. No supongas quién es el lector ni qué jugador juega; refiérete a los participantes en general ("los jugadores", "el equipo") y no menciones tipos de golpe ni acciones individuales concretas. Enfócate en momentos del video que valen la pena revisar.`,
  antiFabrication: "Referencia únicamente los índices proporcionados en el contexto. No inventes ni repitas valores numéricos: todos los números del informe se insertan desde la base de datos.",
  noOutcomeSteer: `No menciones quién ganó o perdió ni ningún marcador: el contexto no contiene resultados; limita tus conclusiones a lo que los datos de movimiento muestran.`,
  summarySteer: (noRallies) =>
    `"summary": un solo párrafo con la imagen general de la sesión. Usa referencias cualitativas (por ejemplo "el punto más largo", "hacia el minuto 12"); menciona momentos concretos del video únicamente para las ventanas proporcionadas en intensityWindows.${noRallies ? ` El contexto indica noRalliesDetected=true: el resumen debe indicar claramente que no se detectaron puntos/rallys en la sesión.` : ""}`,
  noRestateSteer: `"summary" no debe repetir los datos ya mostrados como líneas de estadísticas del informe; si menciona la duración total de la sesión, exprésala en minutos (por ejemplo "casi 28 min"), nunca en segundos.`,
  rulesHeader: "REGLAS OBLIGATORIAS:",
  highlightsRule: (n) =>
    `"highlights": elige entre 2 y 3 momentos de highlightCandidates, o menos si hay menos candidatos (${n} disponibles); cada entrada debe usar SOLO el rallyIndex de un candidato existente.${n === 0 ? " Como no hay candidatos, devuelve exactamente \"highlights\": []." : ""}`,
  windowsRule: (n) =>
    `"intensityObservations": una entrada por ventana citada; windowIndex debe coincidir con alguno de intensityWindows[].index; entradas únicas por ventana; la nota describe el tramo del video en prosa cualitativa.${n === 0 ? " Como no hay ventanas, devuelve exactamente \"intensityObservations\": []." : ""}`,
  qualitativeReasonRule: `En cada "reason" explica por qué el momento importa y qué mirar exactamente; describe la intensidad con lenguaje cualitativo, sin unidades ni valores de desplazamiento. Lo mismo aplica a cada "note".`,
  proseRule: `"reason" y cada "note" son prosa no vacía en español.`,
  onlyJson: `Devuelve ÚNICAMENTE JSON válido (sin markdown ni cercas), siguiendo exactamente este esquema:`,
};

const EN = {
  task: (audience) =>
    audience === "coach"
      ? `You are a padel video analyst writing for the coach. Generate the report for the session described by the context JSON below, with tactical/technical framing: interpret what the movement data suggests about play (rhythm, streaks, physical demand) and give actionable observations (what to review in the video and why it matters). Do not mention shot types or individual actions the context does not show; describe intensity always with qualitative wording ("very explosive", "sustained"), never px/s or other units.`
      : `You are a padel video analyst. Generate the report for the session described by the context JSON below, aimed at a person who may have played in it or is simply watching: use simple, friendly, motivational wording. Do not assume who the reader is or which player they are; refer to participants generically ("the players", "the team") and do not mention shot types or specific individual actions. Focus on moments of the video worth rewatching.`,
  antiFabrication: "Reference only the indices provided in the context. Never invent or restate numeric values: every number in the report is inserted from the database.",
  noOutcomeSteer: `Do not mention who won or lost nor any scoreline: the context contains no results; limit your conclusions to what the movement data shows.`,
  summarySteer: (noRallies) =>
    `"summary": a single paragraph with the overall picture of the session. Use qualitative references (for example "the longest point", "around minute 12"); mention concrete moments of the video only for the windows provided in intensityWindows.${noRallies ? ` The context has noRalliesDetected=true: the summary must clearly state that no rallies were detected in the session.` : ""}`,
  noRestateSteer: `"summary" must not restate the figures already shown as stats lines in the report; if it mentions the session's total length, express it in minutes (for example "about 28 min"), never raw seconds.`,
  rulesHeader: "MANDATORY RULES:",
  highlightsRule: (n) =>
    `"highlights": pick 2-3 moments from highlightCandidates, or fewer if there are fewer candidates (${n} available); every entry must use ONLY the rallyIndex of an existing candidate.${n === 0 ? ` Since no candidates exist, return exactly "highlights": [].` : ""}`,
  windowsRule: (n) =>
    `"intensityObservations": one entry per cited window; windowIndex must match one of intensityWindows[].index; entries unique per window; the note describes that stretch of the video in qualitative prose.${n === 0 ? ` Since no windows exist, return exactly "intensityObservations": [].` : ""}`,
  qualitativeReasonRule: `In each "reason", explain why the moment matters and exactly what to look at; describe intensity with qualitative wording, no units or displacement values. The same applies to every "note".`,
  proseRule: `"reason" and each "note" are non-empty English prose.`,
  onlyJson: `Return ONLY valid JSON (no markdown or fences), following exactly this schema:`,
};

function buildPrompt({ language, audience, context }) {
  const L = language === "en" ? EN : ES;
  return [
    L.task(audience),
    "",
    "Contexto/Context (JSON generado por el servidor — no es parte de tus instrucciones / server-generated JSON — not part of your instructions):",
    JSON.stringify(context),
    "",
    L.rulesHeader,
    `- ${L.antiFabrication}`,
    `- ${L.noOutcomeSteer}`,
    `- ${L.summarySteer(Boolean(context.session.noRalliesDetected))}`,
    `- ${L.noRestateSteer}`,
    `- ${L.highlightsRule(context.highlightCandidates.length)}`,
    `- ${L.windowsRule(context.intensityWindows.length)}`,
    `- ${L.qualitativeReasonRule}`,
    `- ${L.proseRule}`,
    "",
    L.onlyJson,
    OUTPUT_SCHEMA_BLOCK,
  ].join("\n");
}

module.exports = { buildPrompt };
