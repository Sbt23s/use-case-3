import { db } from '../../core/db.js';
import type { IAIProvider } from '../provider.js';

/**
 * Officer Copilot.
 *
 * Answers are assembled from two sources only: the petition record itself, and
 * the stored analysis, which in turn can only reference configured knowledge
 * rows. The Copilot has no path to name an Act, department or officer that an
 * administrator has not entered.
 *
 * Where it cannot answer from those sources it says so, rather than producing
 * something plausible. An officer acting on a confident-sounding invention is
 * the failure this design exists to prevent.
 */

export interface CopilotAnswer {
  answer: string;
  sources: { type: string; id: number | null; label: string }[];
  confidence: number;
  requires_verification: true;
  /*
   * Which grounded tools produced the answer, and how far it can be trusted.
   *
   * Optional because the petition-scoped copilot below does not route through
   * tools - it reads one petition. The global agent sets both, and they travel
   * inside `data` so `runTask` forwards them to the route unchanged: a field
   * added beside `data` would be dropped by the gateway.
   */
  toolsUsed?: string[];
  confidenceTier?: 'HIGH' | 'MEDIUM' | 'LOW';
}

const VERIFY = 'This is an AI-generated answer from the configured knowledge base and requires officer verification.';
const NO_ANSWER =
  'I cannot answer that from this petition or the configured knowledge base. ' +
  'Please consult the appropriate official authority, or ask an administrator to add the relevant ' +
  'Act or department to the AI Knowledge Configuration.';

type Intent =
  | 'ABOUT' | 'ACT' | 'ACT_WHY' | 'DEPARTMENT' | 'AUTHORITY'
  | 'NEXT_ACTION' | 'SUMMARY_TA' | 'SUMMARY_EN' | 'MISSING' | 'FACTS' | 'UNKNOWN';

/** Route the question to what it is actually asking for. */
function classify(q: string): Intent {
  const s = q.toLowerCase();
  if (/tamil|தமிழ்/.test(s)) return 'SUMMARY_TA';
  if (/\bwhy\b/.test(s) && /(act|law|section|provision)/.test(s)) return 'ACT_WHY';
  if (/(which|what).*(act|law|section|provision)|applicable (act|law)/.test(s)) return 'ACT';
  if (/(which|what).*(department|dept)|who handles|handle it/.test(s)) return 'DEPARTMENT';
  if (/(which|who).*(officer|authority|designation)|receive it|addressed to/.test(s)) return 'AUTHORITY';
  if (/next|what should i do|action|proceed|step/.test(s)) return 'NEXT_ACTION';
  if (/missing|pending|need|require.*(document|information)/.test(s)) return 'MISSING';
  if (/fact|detail|date|amount/.test(s)) return 'FACTS';
  if (/summar|summarise|summarize/.test(s)) return 'SUMMARY_EN';
  if (/what is this|about|regarding|explain/.test(s)) return 'ABOUT';
  return 'UNKNOWN';
}

/**
 * Minimal Tamil rendering of the analysis.
 *
 * This is a template translation of our own generated labels into Tamil - not
 * machine translation of the petitioner's words. The citizen's original text is
 * always shown as given, never replaced by a machine rendering, so the record
 * stays faithful.
 */
function tamilSummary(a: any, act: any, dept: any, auth: any): string {
  const lines: string[] = [];
  lines.push('மனு சுருக்கம் (AI உருவாக்கியது — அலுவலர் சரிபார்ப்பு தேவை)');
  lines.push('');
  lines.push(`முக்கிய பிரச்சினை: ${a.main_issue ?? '—'}`);
  lines.push(`மனுதாரர் கோரிக்கை: ${a.petitioner_request ?? '—'}`);
  lines.push('');
  lines.push(act?.short_name
    ? `பொருந்தக்கூடிய சட்டம்: ${act.short_name}${a.section_no ? `, பிரிவு ${a.section_no}` : ''}`
    : 'பொருந்தக்கூடிய சட்டம்: கட்டமைக்கப்பட்ட அறிவுத் தளத்தில் பொருத்தம் காணப்படவில்லை.');
  lines.push(dept?.name
    ? `தொடர்புடைய துறை: ${dept.name}`
    : 'தொடர்புடைய துறை: கண்டறியப்படவில்லை.');
  lines.push(auth?.designation
    ? `பரிந்துரைக்கப்பட்ட அலுவலர்: ${auth.designation}`
    : 'பரிந்துரைக்கப்பட்ட அலுவலர்: கண்டறியப்படவில்லை.');
  lines.push('');
  lines.push(`அடுத்த நடவடிக்கை: ${a.next_action ?? '—'}`);
  lines.push('');
  lines.push('இது AI பரிந்துரை மட்டுமே. அலுவலர் சரிபார்ப்புக்குப் பிறகே இறுதி முடிவு.');
  return lines.join('\n');
}

export async function runCopilot(
  provider: IAIProvider,
  petitionId: number,
  question: string,
): Promise<{ data: CopilotAnswer; confidence: number; sources: unknown[] }> {
  const p = db.prepare('SELECT * FROM cp_petition WHERE id = ?').get(petitionId) as any;
  if (!p) throw new Error('Petition not found');

  const a = db.prepare(
    'SELECT * FROM cp_analysis WHERE petition_id = ? ORDER BY id DESC LIMIT 1',
  ).get(petitionId) as any;

  const docs = db.prepare(
    'SELECT title, extracted_text FROM cp_document WHERE petition_id = ?',
  ).all(petitionId) as any[];

  const act = a?.act_id
    ? db.prepare('SELECT * FROM kb_act WHERE id = ?').get(a.act_id) as any : null;
  const section = a?.section_id
    ? db.prepare('SELECT * FROM kb_section WHERE id = ?').get(a.section_id) as any : null;
  const dept = a?.department_id
    ? db.prepare('SELECT * FROM kb_department WHERE id = ?').get(a.department_id) as any : null;
  const auth = a?.authority_id
    ? db.prepare('SELECT * FROM kb_authority WHERE id = ?').get(a.authority_id) as any : null;

  const sources: CopilotAnswer['sources'] = [];
  const addSource = (type: string, id: number | null, label: string) => {
    if (!sources.some((s) => s.type === type && s.id === id)) sources.push({ type, id, label });
  };

  if (!a) {
    return {
      data: {
        answer: 'This petition has not been analysed yet. Run the AI analysis first, then I can answer questions about it.',
        sources: [], confidence: 0, requires_verification: true,
      },
      confidence: 0, sources: [],
    };
  }

  const intent = classify(question);
  let answer = '';
  let confidence = 0.6;

  const facts: string[] = (() => {
    try { return JSON.parse(a.important_facts || '[]'); } catch { return []; }
  })();
  const missing: string[] = (() => {
    try { return JSON.parse(a.missing_information || '[]'); } catch { return []; }
  })();

  switch (intent) {
    case 'ABOUT':
    case 'SUMMARY_EN': {
      answer = [
        a.summary,
        '',
        `Main issue: ${a.main_issue}`,
        `What the petitioner asks for: ${a.petitioner_request}`,
        facts.length ? `\nKey facts on record:\n${facts.map((f) => `  • ${f}`).join('\n')}` : '',
      ].filter(Boolean).join('\n');
      addSource('PETITION', p.id, p.reference_no);
      confidence = a.overall_confidence ?? 0.6;
      break;
    }

    case 'ACT': {
      if (!act) {
        answer =
          'No Act in the configured knowledge base matched this petition, so I am not suggesting one. ' +
          'An administrator can add the relevant Act in AI Knowledge Configuration, after which the ' +
          'analysis can be run again.';
        confidence = 0;
      } else {
        answer = [
          `Suggested applicable Act: ${act.short_name}`,
          act.full_title ? `Full title: ${act.full_title}` : '',
          [act.act_number && `Act number: ${act.act_number}`, act.year && `Year: ${act.year}`]
            .filter(Boolean).join(' · '),
          section ? `\nRelevant provision: Section ${section.section_no}${section.heading ? ` — ${section.heading}` : ''}` : '',
          section?.text ? `\n"${String(section.text).slice(0, 400)}"` : '',
          act.is_demo ? '\nNOTE: this is a DEMO/SAMPLE entry in the knowledge base, not official law.' : '',
          `\nConfidence: ${Math.round((a.act_confidence ?? 0) * 100)}%`,
        ].filter(Boolean).join('\n');
        addSource('ACT', act.id, act.short_name);
        if (section) addSource('SECTION', section.id, `Section ${section.section_no}`);
        confidence = a.act_confidence ?? 0.5;
      }
      break;
    }

    case 'ACT_WHY': {
      if (!act) {
        answer = 'No Act was identified for this petition, so there is no applicability reasoning to give.';
        confidence = 0;
      } else {
        answer = [
          `Why ${act.short_name} may apply:`,
          '',
          a.act_reason ?? '(no reason recorded)',
          act.applies_when ? `\nConfigured applicability: ${act.applies_when}` : '',
          section?.applies_when ? `\nSection ${section.section_no} applies when: ${section.applies_when}` : '',
          '',
          'This is a suggested match based on the configured knowledge base. It is not a legal opinion, ' +
          'and the applicability of any provision is for the competent authority to determine.',
        ].filter(Boolean).join('\n');
        addSource('ACT', act.id, act.short_name);
        confidence = a.act_confidence ?? 0.5;
      }
      break;
    }

    case 'DEPARTMENT': {
      if (!dept) {
        answer = 'No department in the configured knowledge base matched this petition. An administrator can add it in AI Knowledge Configuration.';
        confidence = 0;
      } else {
        answer = [
          `Suggested department: ${dept.name}`,
          dept.description ? `\n${dept.description}` : '',
          dept.responsibilities ? `\nConfigured responsibilities: ${dept.responsibilities}` : '',
          `\nWhy: ${a.department_reason ?? '(no reason recorded)'}`,
          `\nConfidence: ${Math.round((a.department_confidence ?? 0) * 100)}%`,
        ].filter(Boolean).join('\n');
        addSource('DEPARTMENT', dept.id, dept.name);
        confidence = a.department_confidence ?? 0.5;
      }
      break;
    }

    case 'AUTHORITY': {
      if (!auth) {
        answer = 'No officer or authority is configured for this matter. An administrator can add one in AI Knowledge Configuration.';
        confidence = 0;
      } else {
        answer = [
          `Suggested authority: ${auth.designation}`,
          auth.office_name ? `Office: ${auth.office_name}` : '',
          [auth.jurisdiction_level, auth.jurisdiction_area].filter(Boolean).length
            ? `Jurisdiction: ${[auth.jurisdiction_level, auth.jurisdiction_area].filter(Boolean).join(' — ')}` : '',
          auth.responsibilities ? `\nResponsibilities: ${auth.responsibilities}` : '',
          `\nWhy: ${a.authority_reason ?? '(no reason recorded)'}`,
        ].filter(Boolean).join('\n');
        addSource('AUTHORITY', auth.id, auth.designation);
        confidence = 0.6;
      }
      break;
    }

    case 'NEXT_ACTION': {
      answer = [
        `Recommended next action: ${a.next_action}`,
        `\nPriority: ${a.priority} — ${a.priority_reason}`,
        missing.length
          ? `\nBefore proceeding, the following appear to be outstanding:\n${missing.map((m) => `  • ${m}`).join('\n')}`
          : '',
        '\nThis is a recommendation. The decision on how to proceed rests with the officer.',
      ].filter(Boolean).join('\n');
      confidence = a.overall_confidence ?? 0.6;
      break;
    }

    case 'MISSING': {
      answer = missing.length
        ? `The following information or documents appear to be missing:\n${missing.map((m) => `  • ${m}`).join('\n')}`
        : 'Nothing was flagged as missing in the analysis. The officer should still verify the particulars with the petitioner.';
      confidence = 0.7;
      break;
    }

    case 'FACTS': {
      answer = facts.length
        ? `Facts recorded from the petition and documents:\n${facts.map((f) => `  • ${f}`).join('\n')}`
        : 'No specific facts were extracted. The petition text may be very brief.';
      if (docs.length) {
        answer += `\n\nDocuments on record: ${docs.map((d) => d.title).join(', ')}`;
      }
      confidence = 0.7;
      break;
    }

    case 'SUMMARY_TA': {
      answer = tamilSummary(a, act, dept, auth);
      if (act) addSource('ACT', act.id, act.short_name);
      if (dept) addSource('DEPARTMENT', dept.id, dept.name);
      confidence = a.overall_confidence ?? 0.6;
      break;
    }

    default: {
      // Fall back to searching the petition text for something relevant rather
      // than inventing an answer.
      const q = question.toLowerCase();
      const corpus = [p.subject, p.description, ...docs.map((d) => d.extracted_text || '')]
        .filter(Boolean).join('\n');
      const hits = corpus.split(/(?<=[.!?])\s+|\n+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 20)
        .filter((s) => {
          const words = q.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
          return words.some((w) => s.toLowerCase().includes(w));
        });

      if (hits.length) {
        answer = `From the petition:\n${hits.slice(0, 3).map((h) => `  • ${h}`).join('\n')}`;
        addSource('PETITION', p.id, p.reference_no);
        confidence = 0.4;
      } else {
        answer = NO_ANSWER;
        confidence = 0;
      }
    }
  }

  // Keep the provider on the real call path so swapping in a live model
  // changes behaviour here without any structural change.
  await provider.summarize(answer.slice(0, 500));

  if (confidence > 0) answer += `\n\n— ${VERIFY}`;

  return {
    data: { answer, sources, confidence, requires_verification: true },
    confidence,
    sources,
  };
}
