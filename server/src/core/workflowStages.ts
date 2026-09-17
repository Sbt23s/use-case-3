/**
 * The grievance workflow: the stages a petition passes through in the office.
 *
 * This is the PROCEDURAL lifecycle - what the file does as it moves between
 * desks - and it is deliberately separate from `cp_petition.status`, which
 * records the AI pipeline's state (SUBMITTED / ANALYSING / ANALYSED). The two
 * answer different questions: status says whether the analysis has run, stage
 * says where the case has got to. Merging them would have meant a petition
 * could not be "analysed" and "awaiting hearing" at the same time, which is the
 * normal condition of a real case.
 *
 * WHY THIS LIST IS FIXED. Unlike the Act, the department or the recommended
 * next action - all of which come from the knowledge base and change per
 * petition - this sequence is the office's own standing procedure. It is the
 * same for a street-light complaint and a patta dispute, so it belongs in the
 * code as a declared constant rather than being inferred per case. The
 * AI-generated next steps remain separate and remain per-petition: this tracks
 * WHERE THE FILE IS, the analysis advises WHAT TO DO.
 *
 * NOTHING HERE MOVES ON ITS OWN. A stage changes only when an officer records
 * that it has, through the stage route, and every change is written to the
 * history table with who did it and when. The interface must never show a
 * stage as reached because the software assumed it.
 */

export interface StageDef {
  /** Stored value. Stable: it is written to the database and the audit trail. */
  code: string;
  en: string;
  ta: string;
  /**
   * Stages that do not occur in every case.
   *
   * A matter settled without a hearing skips the hearing stages entirely, so
   * they are marked optional and an officer may move past them. They are still
   * shown, greyed, so the full procedure remains visible.
   */
  optional?: boolean;
}

export const WORKFLOW_STAGES: StageDef[] = [
  { code: 'FORWARDING',             en: 'Forwarding',             ta: 'அனுப்புதல்' },
  { code: 'PREPARED',               en: 'Prepared',               ta: 'தயாரிக்கப்பட்டது' },
  { code: 'DEPARTMENT_TRANSFERRED', en: 'Department transferred', ta: 'துறைக்கு மாற்றப்பட்டது' },
  { code: 'DEPARTMENT_REVIEW',      en: 'Department review',      ta: 'துறை பரிசீலனை' },
  { code: 'HEARING_REQUIRED',       en: 'Hearing required',       ta: 'விசாரணை தேவை',        optional: true },
  { code: 'CALL_LETTER_ISSUED',     en: 'Call letter issued',     ta: 'அழைப்புக் கடிதம் வழங்கப்பட்டது', optional: true },
  { code: 'HEARING_SCHEDULED',      en: 'Hearing scheduled',      ta: 'விசாரணை திட்டமிடப்பட்டது', optional: true },
  { code: 'HEARING_COMPLETED',      en: 'Hearing completed',      ta: 'விசாரணை முடிந்தது',    optional: true },
  { code: 'PROCEEDINGS_PREPARED',   en: 'Proceedings prepared',   ta: 'நடவடிக்கைகள் தயாரிக்கப்பட்டன' },
  { code: 'AO_REPORT_PREPARED',     en: 'AO report prepared',     ta: 'ஆய்வு அலுவலர் அறிக்கை தயாரிக்கப்பட்டது' },
  { code: 'COLLECTOR_REVIEW',       en: 'Collector review',       ta: 'ஆட்சியர் பரிசீலனை' },
  { code: 'DECISION_PENDING',       en: 'Decision pending',       ta: 'முடிவு நிலுவையில்' },
  { code: 'ORDER_PREPARED',         en: 'Order prepared',         ta: 'ஆணை தயாரிக்கப்பட்டது' },
  { code: 'ORDER_APPROVED',         en: 'Order approved',         ta: 'ஆணை அங்கீகரிக்கப்பட்டது' },
  { code: 'CITIZEN_COMMUNICATION',  en: 'Citizen communication',  ta: 'குடிமகனுக்குத் தெரிவிப்பு' },
  { code: 'CLOSURE',                en: 'Closure',                ta: 'முடிவுற்றது' },
];

/** The stage a petition sits at before any officer action is recorded. */
export const FIRST_STAGE = WORKFLOW_STAGES[0].code;

const BY_CODE = new Map(WORKFLOW_STAGES.map((s) => [s.code, s]));

export function isStage(code: unknown): boolean {
  return typeof code === 'string' && BY_CODE.has(code);
}

/** Position in the sequence, or -1 for an unknown code. */
export function stageIndex(code: unknown): number {
  return WORKFLOW_STAGES.findIndex((s) => s.code === code);
}

export function stageDef(code: unknown): StageDef | null {
  return (typeof code === 'string' ? BY_CODE.get(code) : undefined) ?? null;
}

/**
 * The stage a petition is at, given what is stored against it.
 *
 * A petition created before this workflow existed has no stage recorded; it is
 * reported at the first stage rather than being guessed forward, because no
 * officer has recorded any of these steps for it.
 */
export function currentStage(stored: unknown): string {
  return isStage(stored) ? String(stored) : FIRST_STAGE;
}
