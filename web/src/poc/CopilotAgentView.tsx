import { useCallback, useEffect, useRef, useState } from 'react';
import { pocApi, pct } from './pocApi';
import { useI18n } from '../lib/i18n';
import { speak, stopSpeaking, ttsSupport, type SpeakHandle } from '../lib/tts';
import { speechSupport, startDictation, type Dictation } from '../lib/speech';
import { AiSettingsDialog } from './AiSettingsDialog';
import { GovernmentLogoLoader } from './GovernmentLogoLoader';

const ACCEPT = [
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/jpg', 'image/png', 'text/plain',
].join(',');

const MAX_BYTES = 15 * 1024 * 1024;

export interface WebSource {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

interface Msg {
  id: number;
  role: 'USER' | 'ASSISTANT';
  content: string;
  confidence?: number | null;
  confidenceTier?: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  sources?: any[];
  webSources?: WebSource[];
  toolsUsed?: string[];
  file?: { name: string; size: number };
  error?: boolean;
  analysis?: any;
}

export interface ConversationSession {
  id: string;
  title: string;
  messages: Msg[];
  createdAt: number;
  updatedAt: number;
  docId?: number | null;
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const STAGE_KEY: Record<string, string> = {
  UPLOADING: 'agent.stageUpload',
  EXTRACTING: 'agent.stageRead',
  EXTRACTED: 'agent.stageUnderstand',
  ANALYSING: 'agent.stageClassify',
  COMPLETED: 'agent.stageWorkflow',
};

function cleanAssistantText(text: string): string {
  if (!text) return '';
  let cleaned = text;
  // Strip trailing AI disclaimers
  cleaned = cleaned.replace(/—\s*(?:This is an AI-generated answer|இது AI உருவாக்கிய பதில்|Idhu AI generate panna bathil).*$/gim, '');
  // Clean up excess blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

function isMixed(text: string): boolean {
  const ta = (text.match(/[஀-௿]/g) || []).length;
  const en = (text.match(/[A-Za-z]/g) || []).length;
  const total = ta + en;
  if (!total) return false;
  return ta / total > 0.1 && en / total > 0.1;
}

function sourceIcon(type: string): string {
  if (type === 'PETITION') return '📋';
  if (type === 'ACT' || type === 'SECTION') return '⚖️';
  if (type === 'DEPARTMENT') return '🏛️';
  if (type === 'AUTHORITY') return '👤';
  if (type === 'WEB') return '🌐';
  return '📄';
}

function toolIcon(toolName: string): string {
  if (toolName === 'search_petition') return '📋';
  if (toolName === 'query_knowledge_base') return '📚';
  if (toolName === 'search_official_sources') return '🌐';
  if (toolName === 'get_statistics') return '📊';
  if (toolName === 'universal_reasoning') return '🧠';
  return '🔧';
}

function toolLabel(toolName: string, lang: string): string {
  const labels: Record<string, { en: string; ta: string }> = {
    search_petition: { en: 'Petition Context', ta: 'மனு சூழல்' },
    query_knowledge_base: { en: 'Knowledge Base', ta: 'அறிவுத் தளம்' },
    search_official_sources: { en: 'Official Sources', ta: 'அரசு ஆதாரங்கள்' },
    get_statistics: { en: 'Statistics', ta: 'புள்ளிவிவரம்' },
    universal_reasoning: { en: 'Universal AI Agent', ta: 'பொது அறிவு முகவர்' },
  };
  const entry = labels[toolName];
  if (!entry) return toolName;
  return lang === 'ta' ? entry.ta : entry.en;
}

/**
 * Code block with copy action.
 */
function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard fallback
    }
  };

  return (
    <div className="agent-code-block">
      <div className="agent-code-header">
        <span className="agent-code-lang">{lang || 'code'}</span>
        <button type="button" onClick={copyCode} className="agent-code-copy-btn">
          {copied ? '✓ Copied' : '⧉ Copy Code'}
        </button>
      </div>
      <pre className="agent-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Rich formatting renderer for AI assistant answers:
 * - Code blocks (```lang ... ```)
 * - Headings (###, ##)
 * - Bullet points (•, -, *, 1.)
 * - **bold** emphasis
 */
function renderMarkdownContent(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = text.split('\n');
  let key = 0;
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block delimiters
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // End of code block
        nodes.push(
          <CodeBlock
            key={key++}
            code={codeBuffer.join('\n')}
            lang={codeLang}
          />
        );
        inCodeBlock = false;
        codeBuffer = [];
        codeLang = '';
      } else {
        // Start of code block
        inCodeBlock = true;
        codeLang = line.trim().replace(/^```/, '').trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    if (!line.trim()) {
      nodes.push(<div key={key++} className="agent-spacer" />);
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      nodes.push(
        <h3 key={key++} className="agent-heading-3">
          {renderInlineText(line.replace('### ', ''))}
        </h3>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      nodes.push(
        <h2 key={key++} className="agent-heading-2">
          {renderInlineText(line.replace('## ', ''))}
        </h2>
      );
      continue;
    }

    // Bullet points
    const bulletMatch = line.match(/^[\s]*[•\-\*]\s+(.+)$/) || line.match(/^[\s]*\d+\.\s+(.+)$/);
    if (bulletMatch) {
      nodes.push(
        <div key={key++} className="agent-bullet-row">
          <span className="agent-bullet-dot">•</span>
          <div className="agent-bullet-body">{renderInlineText(bulletMatch[1])}</div>
        </div>
      );
      continue;
    }

    // Normal paragraph
    nodes.push(
      <p key={key++} className="agent-paragraph">
        {renderInlineText(line)}
      </p>
    );
  }

  // Close dangling code block if needed
  if (inCodeBlock && codeBuffer.length > 0) {
    nodes.push(
      <CodeBlock
        key={key++}
        code={codeBuffer.join('\n')}
        lang={codeLang}
      />
    );
  }

  return nodes;
}

function renderInlineText(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="copilot-citation-link"
          style={{
            color: 'var(--copilot-accent, #2563eb)',
            textDecoration: 'underline',
            textUnderlineOffset: '3px',
            fontWeight: 500,
          }}
        >
          {linkMatch[1]} ↗
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function isTanglishText(text: string): boolean {
  if (!text) return false;
  if (/[\u0B80-\u0BFF]/.test(text)) return false;
  return /\b(pathi|paththi|enna|eppadi|solla|sollu|irukku|iruku|illai|venum|kudunga|pannunga|panna|yaar|yaaru|enge|enga|epadi|edhuku|aagum|mudiyuma|kooduma|thonga|thanga|kodunga|vendum|theriyuma|kettu|kekura|romba|konjam|ippo|eppo|inga|anga|unakku|enakku|ungala|ungalaala|theriyum|panrathu|pannanum|maari|marri)\b/i.test(text);
}

function summariseDocAnalysis(r: any, lang: string, t: (k: string) => string): string {
  const a = r?.analysis || r;
  if (!a || (!a.summary && !a.main_issue)) return t('agent.errUnreadable');

  const isTa = lang === 'ta';
  const isTanglish = lang === 'tanglish';

  const v = (b: any) => {
    if (!b) return '—';
    if (typeof b === 'object') {
      return (isTa ? (b.ta || b.en) : (b.en || b.ta)) || '—';
    }
    return String(b);
  };

  const lines: string[] = [];

  // Header Title
  if (isTa) {
    lines.push('### 📋 ஆவண ஆய்வு & சட்ட நிர்வாக பகுப்பாய்வு அறிக்கை');
  } else if (isTanglish) {
    lines.push('### 📋 Document AI Analysis Mudivu (Statutory & Departmental Report)');
  } else {
    lines.push('### 📋 Document AI Statutory & Administrative Analysis Report');
  }
  lines.push('');

  // Overview / Summary
  if (a.summary) {
    lines.push(v(a.summary));
    lines.push('');
  }

  // Grievance Details & Petitioner Particulars
  const doc = r?.document;
  const ext = doc?.extracted_details;
  const petitionerName = ext?.name || (a.entities?.people && a.entities.people.length > 0 ? a.entities.people[0] : null);
  const petitionerPhone = ext?.phone || null;
  const petitionerPlace = ext?.district || ext?.taluk || (a.entities?.places && a.entities.places.length > 0 ? a.entities.places[0] : null);
  const docDate = ext?.date || (a.entities?.dates && a.entities.dates.length > 0 ? a.entities.dates[0] : null);

  if (petitionerName || petitionerPhone || petitionerPlace || docDate) {
    if (isTa) {
      lines.push('**மனுதாரர் & ஆவண விவரங்கள்:**');
      if (petitionerName) lines.push(`• **பெயர்:** ${petitionerName}`);
      if (petitionerPhone) lines.push(`• **தொடர்பு எண்:** ${petitionerPhone}`);
      if (petitionerPlace) lines.push(`• **மாவட்டம் / இடம்:** ${petitionerPlace}`);
      if (docDate) lines.push(`• **ஆவண தேதி:** ${docDate}`);
    } else if (isTanglish) {
      lines.push('**Petitioner & Aavana Vivaram:**');
      if (petitionerName) lines.push(`• **Petitioner Peyar:** ${petitionerName}`);
      if (petitionerPhone) lines.push(`• **Phone Number:** ${petitionerPhone}`);
      if (petitionerPlace) lines.push(`• **District / Idam:** ${petitionerPlace}`);
      if (docDate) lines.push(`• **Aavana Thethi (Date):** ${docDate}`);
    } else {
      lines.push('**Petitioner & Document Particulars:**');
      if (petitionerName) lines.push(`• **Petitioner Name:** ${petitionerName}`);
      if (petitionerPhone) lines.push(`• **Contact No:** ${petitionerPhone}`);
      if (petitionerPlace) lines.push(`• **Location / District:** ${petitionerPlace}`);
      if (docDate) lines.push(`• **Document Date:** ${docDate}`);
    }
    lines.push('');
  }

  // Core Grievance Issue & Request
  if (a.main_issue || a.petitioner_request) {
    if (isTa) {
      lines.push('**பிரச்சனை & கோரிக்கை சுருக்கம்:**');
      if (a.main_issue) lines.push(`• **முக்கிய பிரச்சனை:** ${v(a.main_issue)}`);
      if (a.petitioner_request) lines.push(`• **மனுதாரர் கோரிக்கை:** ${v(a.petitioner_request)}`);
    } else if (isTanglish) {
      lines.push('**Mukkiya Issue & Kuraidheerppu Koorikkai:**');
      if (a.main_issue) lines.push(`• **Mukkiya Issue:** ${v(a.main_issue)}`);
      if (a.petitioner_request) lines.push(`• **Petitioner-oda Request:** ${v(a.petitioner_request)}`);
    } else {
      lines.push('**Core Issue & Relief Requested:**');
      if (a.main_issue) lines.push(`• **Main Grievance:** ${v(a.main_issue)}`);
      if (a.petitioner_request) lines.push(`• **Petitioner's Prayer:** ${v(a.petitioner_request)}`);
    }
    lines.push('');
  }

  // Applicable Statutory Provisions (Act & Section)
  if (isTa) {
    lines.push('**பொருந்தக்கூடிய சட்டம் & சட்டப்பிரிவு (Applicable Statutory Framework):**');
  } else if (isTanglish) {
    lines.push('**Porundhum Sattam & Pirivu (Applicable Act & Section):**');
  } else {
    lines.push('**Applicable Statutory Framework (Act & Section):**');
  }

  const actName = a.act?.id ? v(a.act.short_name) : (isTa ? 'அடையாளம் காணப்படவில்லை' : isTanglish ? 'Act kandupidikkapadavillai' : 'Not identified');
  const actYear = a.act?.year ? ` (${a.act.year})` : '';
  const sectionInfo = a.act?.section_no ? `${a.act.section_no}${a.act.section_heading ? ` – ${v(a.act.section_heading)}` : ''}` : (isTa ? 'சரிபார்ப்பு தேவை' : isTanglish ? 'Verification thevai' : 'Needs Verification');

  lines.push(`• **${isTa ? 'சட்டம்' : isTanglish ? 'Sattam (Act)' : 'Act'}:** ${actName}${actYear}`);
  lines.push(`• **${isTa ? 'பிரிவு' : isTanglish ? 'Pirivu (Section)' : 'Section'}:** ${sectionInfo}`);

  if (a.act?.reason) {
    const actReasonLabel = isTa ? 'சட்ட ரீதியான காரணம்' : isTanglish ? 'Satta Kaaranam (Act Rationale)' : 'Statutory Rationale';
    lines.push(`• **${actReasonLabel}:** ${v(a.act.reason)}`);
  }
  lines.push('');

  // Competent Department & Authority
  if (isTa) {
    lines.push('**தொடர்புடைய அரசுத்துறை & அதிகார வரம்பு (Department & Authority):**');
  } else if (isTanglish) {
    lines.push('**Poruppaana Thurai & Adhigaari (Competent Department & Authority):**');
  } else {
    lines.push('**Competent Administrative Department & Authority:**');
  }

  const deptName = a.department?.id ? v(a.department.name) : (isTa ? 'அடையாளம் காணப்படவில்லை' : isTanglish ? 'Thurai theriyavillai' : 'Unknown');
  const deptCode = a.department?.code ? ` [${a.department.code}]` : '';
  const authName = a.authority?.id ? `${v(a.authority.designation)}${a.authority.office_name ? ` (${v(a.authority.office_name)})` : ''}` : (isTa ? 'அடையாளம் காணப்படவில்லை' : isTanglish ? 'Kandupidikkapadavillai' : 'Not identified');

  lines.push(`• **${isTa ? 'அரசுத்துறை' : isTanglish ? 'Arasu Thurai (Department)' : 'Department'}:** ${deptName}${deptCode}`);
  lines.push(`• **${isTa ? 'தகுதிவாய்ந்த அதிகாரி' : isTanglish ? 'Adhigaari (Authority)' : 'Competent Authority'}:** ${authName}`);

  if (a.department?.reason) {
    const deptReasonLabel = isTa ? 'துறை அதிகார எல்லை விளக்கம்' : isTanglish ? 'Thurai Kaaranam (Department Rationale)' : 'Departmental Rationale';
    lines.push(`• **${deptReasonLabel}:** ${v(a.department.reason)}`);
  }
  lines.push('');

  // Required Documents
  if (Array.isArray(a.required_documents) && a.required_documents.length > 0) {
    if (isTa) {
      lines.push('**தேவைப்படும் ஆதார ஆவணங்கள் (Required Documents):**');
    } else if (isTanglish) {
      lines.push('**Thevaipadum Aavanangal (Mandatory Required Documents):**');
    } else {
      lines.push('**Mandatory Required Documents:**');
    }
    for (const docItem of a.required_documents) {
      lines.push(`• ${v(docItem)}`);
    }
    lines.push('');
  }

  // Redressal Workflow
  if (Array.isArray(a.workflow) && a.workflow.length > 0) {
    if (isTa) {
      lines.push('**சட்டரீதியான தீர்வு நடைமுறை (Statutory Redressal Workflow):**');
    } else if (isTanglish) {
      lines.push('**Sattareedhiyaana Nadavadikkai Varisai (Workflow Steps):**');
    } else {
      lines.push('**Statutory Redressal Workflow:**');
    }
    a.workflow.forEach((wf: any, idx: number) => {
      lines.push(`${idx + 1}. ${v(wf)}`);
    });
    lines.push('');
  }

  // Priority & Action
  if (isTa) {
    lines.push('**முன்னுரிமை & உடனடி நடவடிக்கை:**');
    lines.push(`• **முன்னுரிமை நிலை:** ${a.priority || 'NORMAL'}${a.priority_reason ? ` (${v(a.priority_reason)})` : ''}`);
    lines.push(`• **அடுத்த கட்ட நடவடிக்கை:** ${v(a.next_action)}`);
  } else if (isTanglish) {
    lines.push('**Priority & Udanadi Nadavadikkai (Action Required):**');
    lines.push(`• **Priority Nilai:** ${a.priority || 'NORMAL'}${a.priority_reason ? ` (${v(a.priority_reason)})` : ''}`);
    lines.push(`• **Adutha Kattam (Immediate Action):** ${v(a.next_action)}`);
  } else {
    lines.push('**Priority & Immediate Action:**');
    lines.push(`• **Priority Level:** ${a.priority || 'NORMAL'}${a.priority_reason ? ` (${v(a.priority_reason)})` : ''}`);
    lines.push(`• **Immediate Officer Action:** ${v(a.next_action)}`);
  }

  return lines.join('\n');
}

export function CopilotAgentView({
  feed,
  onClose,
  petitionId,
}: {
  feed: any[];
  onClose: () => void;
  petitionId?: number | null;
}) {
  const { t, lang, setLang } = useI18n();

  const STORAGE_KEY = 'egov_copilot_conversations_v4';

  const [conversations, setConversations] = useState<ConversationSession[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* ignore */ }
    const initialId = 'conv_' + Date.now();
    return [{
      id: initialId,
      title: lang === 'ta' ? 'புதிய உரையாடல்' : 'New Chat',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];
  });

  const [activeConvId, setActiveConvId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed[0]?.id) return parsed[0].id;
      }
    } catch { /* ignore */ }
    return 'conv_' + Date.now();
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    } catch { /* quota */ }
  }, [conversations]);

  const activeConv = conversations.find((c) => c.id === activeConvId) || conversations[0] || {
    id: 'conv_' + Date.now(),
    title: lang === 'ta' ? 'புதிய உரையாடல்' : 'New Chat',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const messages = activeConv.messages;

  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [docId, setDocId] = useState<number | null>(petitionId ?? null);
  const [loaded, setLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('egov_copilot_theme') as 'light' | 'dark') || 'light';
  });

  const [copilotLang, setCopilotLang] = useState<'ta' | 'en'>(() => {
    const saved = localStorage.getItem('egov_copilot_lang');
    if (saved === 'ta' || saved === 'en') return saved;
    return lang === 'ta' ? 'ta' : 'en';
  });

  const handleLangChange = (l: 'en' | 'ta') => {
    setCopilotLang(l);
    setLang(l);
    try {
      localStorage.setItem('egov_copilot_lang', l);
    } catch { /* quota */ }
  };

  const [isListening, setIsListening] = useState(false);
  const dictationRef = useRef<Dictation | null>(null);

  const toggleListening = () => {
    if (isListening) {
      dictationRef.current?.stop();
      dictationRef.current = null;
      setIsListening(false);
      return;
    }
    const sup = speechSupport();
    if (!sup.supported) {
      alert(sup.reason || 'Speech recognition is not supported in this browser.');
      return;
    }

    const recLang = copilotLang === 'ta' ? 'ta-IN' : 'en-IN';

    setIsListening(true);
    dictationRef.current = startDictation(recLang, {
      onFinal: (text) => {
        setInput((prev) => (prev ? `${prev} ${text}` : text));
        taRef.current?.focus();
      },
      onInterim: (_text) => {},
      onError: (err) => {
        console.warn('Speech recognition error:', err);
        setIsListening(false);
        dictationRef.current = null;
      },
      onEnd: () => {
        setIsListening(false);
        dictationRef.current = null;
      },
    });
  };

  useEffect(() => {
    return () => {
      dictationRef.current?.stop();
      dictationRef.current = null;
    };
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('egov_copilot_theme', next);
      return next;
    });
  };

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    return window.innerWidth > 960;
  });

  const fileRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const speakRef = useRef<SpeakHandle | null>(null);
  const tts = ttsSupport();

  const push = (m: Omit<Msg, 'id'>) => {
    const newMsg: Msg = { ...m, id: Date.now() + Math.random() };
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeConv.id) return c;
        const newMsgs = [...c.messages, newMsg];
        const updatedTitle =
          (c.title === 'New Chat' || c.title === 'புதிய உரையாடல்' || !c.title) && newMsg.role === 'USER'
            ? newMsg.content.slice(0, 36)
            : c.title;
        return {
          ...c,
          title: updatedTitle,
          messages: newMsgs,
          updatedAt: Date.now(),
        };
      })
    );
  };

  // Load backend chat history if available and active thread is empty
  useEffect(() => {
    pocApi.get<{ messages: any[] }>('/cp/e-gov-chat')
      .then((r) => {
        const backendMsgs: Msg[] = (r.messages ?? []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          confidence: m.confidence,
          confidenceTier: m.confidenceTier ?? m.confidence_tier ?? null,
          toolsUsed: Array.isArray(m.toolsUsed) ? m.toolsUsed : (Array.isArray(m.tools_used) ? m.tools_used : []),
          sources: Array.isArray(m.sources) ? m.sources : [],
          webSources: Array.isArray(m.webSources) ? m.webSources : [],
        }));
        if (backendMsgs.length > 0) {
          setConversations((prev) => {
            if (prev.length === 1 && prev[0].messages.length === 0) {
              const firstUser = backendMsgs.find((m) => m.role === 'USER');
              return [{
                ...prev[0],
                title: firstUser ? firstUser.content.slice(0, 36) : prev[0].title,
                messages: backendMsgs,
              }];
            }
            return prev;
          });
        }
      })
      .catch(() => { /* thread empty */ })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages.length, stage]);

  useEffect(() => () => {
    stopSpeaking();
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, []);

  // Keyboard shortcut Esc to return to petitions
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const loadResult = useCallback(async (id: number) => {
    try { return await pocApi.get<any>(`/cp/copilot/result/${id}`); } catch { return null; }
  }, []);

  // Listen for live OCR and Copilot stage progress events
  useEffect(() => {
    if (!docId || !busy) return;
    const mine = feed.filter((f) => f.kind === 'copilot:progress' && f.data?.petitionId === docId);
    if (!mine.length) return;
    const latest = mine[0].data;

    if (latest.stage === 'FAILED') {
      setBusy(false);
      setStage(null);
      push({ role: 'ASSISTANT', content: latest.message || t('agent.errUnreadable'), error: true });
      return;
    }
    setStage(latest.stage);

    if (latest.stage === 'COMPLETED') {
      void (async () => {
        const r = await loadResult(docId);
        setBusy(false);
        setStage(null);
        const effectiveDocLang = copilotLang;
        push({
          role: 'ASSISTANT',
          content: summariseDocAnalysis(r, effectiveDocLang, t),
          confidence: r?.analysis?.overall_confidence,
          analysis: r,
        });
      })();
    }
  }, [feed, docId, busy, loadResult, lang, t, copilotLang, input]);

  const pickFile = (f: File | null) => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      push({ role: 'ASSISTANT', content: `${t('agent.tooLarge')} (${humanSize(f.size)})`, error: true });
      return;
    }
    setFile(f);
    taRef.current?.focus();
  };

  const switchToConversation = (id: string) => {
    stopSpeaking();
    setSpeakingId(null);
    setActiveConvId(id);
    const target = conversations.find((c) => c.id === id);
    if (target?.docId) setDocId(target.docId);
    else setDocId(null);
  };

  const createNewConversation = () => {
    stopSpeaking();
    setSpeakingId(null);
    const newId = 'conv_' + Date.now();
    const newSession: ConversationSession = {
      id: newId,
      title: lang === 'ta' ? 'புதிய உரையாடல்' : 'New Chat',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations((prev) => [newSession, ...prev]);
    setActiveConvId(newId);
    setDocId(null);
    setFile(null);
    setInput('');
    taRef.current?.focus();
  };

  const deleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    stopSpeaking();
    setSpeakingId(null);
    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      if (filtered.length === 0) {
        const freshId = 'conv_' + Date.now();
        return [{
          id: freshId,
          title: lang === 'ta' ? 'புதிய உரையாடல்' : 'New Chat',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }];
      }
      return filtered;
    });
    if (activeConvId === id) {
      const remaining = conversations.filter((c) => c.id !== id);
      if (remaining.length > 0) {
        setActiveConvId(remaining[0].id);
      }
    }
  };

  const send = async () => {
    if (busy) return;
    const question = input.trim();

    // Document upload mode
    if (file) {
      push({
        role: 'USER',
        content: question || (lang === 'ta' ? 'இந்த ஆவணத்தை ஆய்வு செய்து சட்டப் பிரிவுகள் மற்றும் துறையை அடையாளம் காணவும்.' : 'Please analyze this attached document and extract applicable statutory provisions.'),
        file: { name: file.name, size: file.size },
      });
      setInput('');
      setBusy(true);
      setStage('UPLOADING');

      try {
        const form = new FormData();
        form.append('file', file);
        form.append('title', file.name);
        const r = await pocApi.upload<any>('/cp/copilot/analyse-document', form);
        setDocId(r.petitionId);
        setStage(r.stage ?? 'EXTRACTING');
        setFile(null);
        if (fileRef.current) fileRef.current.value = '';
      } catch (e: any) {
        setBusy(false);
        setStage(null);
        push({ role: 'ASSISTANT', content: e.message ?? t('agent.errUpload'), error: true });
      }
      return;
    }

    if (!question) return;
    if (isListening) {
      dictationRef.current?.stop();
      dictationRef.current = null;
      setIsListening(false);
    }
    push({ role: 'USER', content: question });
    setInput('');
    setBusy(true);

    try {
      const chatLang = copilotLang;

      const r = await pocApi.post<any>('/cp/e-gov-chat', {
        question,
        lang: chatLang,
        conversationId: activeConv.id,
        ...(docId ? { petitionId: docId } : {}),
      });
      push({
        role: 'ASSISTANT',
        content: cleanAssistantText(r.answer),
        confidence: r.confidence,
        confidenceTier: r.confidenceTier ?? null,
        sources: r.sources,
        webSources: r.webSources || [],
        toolsUsed: r.toolsUsed ?? [],
      });
    } catch (e: any) {
      push({ role: 'ASSISTANT', content: e.message ?? t('agent.errAnswer'), error: true });
    } finally {
      setBusy(false);
    }
  };

  const clearThread = async () => {
    try { await pocApi.del(`/cp/e-gov-chat?conversationId=${activeConv.id}`); } catch { /* clears anyway */ }
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConv.id ? { ...c, messages: [], title: lang === 'ta' ? 'புதிய உரையாடல்' : 'New Chat' } : c))
    );
    setDocId(null);
    setFile(null);
    stopSpeaking();
    setSpeakingId(null);
  };

  const copy = async (m: Msg) => {
    try {
      await navigator.clipboard.writeText(m.content);
      setCopiedId(m.id);
      setTimeout(() => setCopiedId((c) => (c === m.id ? null : c)), 1600);
    } catch { /* ignored */ }
  };

  const listen = async (m: Msg) => {
    if (speakingId === m.id) {
      speakRef.current?.stop();
      speakRef.current = null;
      setSpeakingId(null);
      return;
    }
    stopSpeaking();
    setSpeakingId(m.id);
    speakRef.current = await speak(m.content, {
      lang,
      onEnd: () => setSpeakingId(null),
      onError: () => setSpeakingId(null),
    });
  };

  const downloadReport = async () => {
    const { buildConversationReport } = await import('../lib/report');
    const pdf = await buildConversationReport({
      title: lang === 'ta' ? 'தமிழ்நாடு மின்-ஆளுமை துணை — உரையாடல் அறிக்கை' : 'TN e-Gov Copilot — Universal AI Agent Session',
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      lang,
    });
    pdf.save('e-gov-copilot-session.pdf');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const canSend = !busy && (!!file || !!input.trim());
  const started = messages.length > 0;

  // Curated prompts for officers
  const STARTER_PROMPTS = [
    {
      icon: '📝',
      title: lang === 'ta' ? 'கள ஆய்வு உத்தரவு வரைவு' : 'Draft Field Inspection Memo',
      desc: lang === 'ta' ? 'ஆக்கிரமிப்பு அல்லது பொது குறைதீர்ப்பு மனுவுக்கான அதிகாரப்பூர்வ உத்தரவு வரைவு' : 'Draft official proceedings ordering a field inquiry and spot inspection',
      query: lang === 'ta' ? 'பொதுமக்கள் மனு மீது கள ஆய்வு மேற்கொண்டு 7 நாட்களில் அறிக்கை சமர்ப்பிக்க உத்தரவிடும் அதிகாரப்பூர்வ மெமோ வரைவை உருவாக்கவும்.' : 'Draft an official proceedings memo directing a field inspection regarding a citizen grievance, with a 7-day reporting deadline.',
    },
    {
      icon: '⚖️',
      title: lang === 'ta' ? 'குடிநீர் & மாநகராட்சி சட்டம்' : 'Drinking Water & Municipal Act',
      desc: lang === 'ta' ? 'மாநகராட்சி பகுதிகளில் குடிநீர் விநியோக குறைபாடுகளைக் கையாளும் சட்டம்' : 'Applicable Acts, sections, and authorities for civic amenities in corporations',
      query: lang === 'ta' ? 'மாநகராட்சி பகுதியில் குடிநீர் விநியோக குறைபாடுகள் மற்றும் சாலை பராமரிப்புக்கு எந்த சட்டம் மற்றும் துறை பொருந்தும்?' : 'Which Act and department govern drinking water supply and civic amenities in Municipal Corporations in Tamil Nadu?',
    },
    {
      icon: '💻',
      title: lang === 'ta' ? 'குறைதீர்ப்பு புள்ளிவிவர SQL' : 'Grievance Analytics SQL',
      desc: lang === 'ta' ? 'துறைவாரியான மனுக்கள் தீர்வு விகிதத்தைக் கணக்கிடும் தரவுத்தள வினவல்' : 'SQL query to summarize monthly resolution rates and pending counts by department',
      query: lang === 'ta' ? 'துறைவாரியாக நிலுவையில் உள்ள மனுக்கள் மற்றும் சராசரி தீர்வு நாட்களை கணக்கிடும் SQL வினவலை எழுதவும்.' : 'Write a SQL query to calculate average resolution turnaround days and pending caseload by department.',
    },
    {
      icon: '📄',
      title: lang === 'ta' ? 'ஆவண OCR & சட்ட ஆய்வு' : 'Document OCR & Legal Analysis',
      desc: lang === 'ta' ? 'மனு கடிதம் அல்லது உத்தரவை பதிவேற்றி நிகழ்நேர OCR மூலம் ஆய்வு செய்யவும்' : 'Upload any scanned petition, deed, or G.O. for real-time extraction & advice',
      action: () => fileRef.current?.click(),
    },
  ];

  return (
    <div className={`copilot-agent-view theme-${theme}`}>
      {/* Top Header Bar */}
      <header className="copilot-agent-header">
        <div className="copilot-agent-header-left">
          <button
            type="button"
            className="copilot-sidebar-toggle-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? (lang === 'ta' ? 'பக்கப்பட்டையை மூடுக' : 'Close Sidebar') : (lang === 'ta' ? 'பக்கப்பட்டையைத் திறக்க' : 'Open Sidebar')}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
          <button
            type="button"
            className="copilot-back-nav-btn"
            onClick={onClose}
            title={lang === 'ta' ? 'மனுக்கள் பட்டியலுக்குத் திரும்பு' : 'Return to Petitions List'}
          >
            ← {lang === 'ta' ? 'மனுக்கள்' : 'Petitions'}
          </button>
          <div className="copilot-agent-brand">
            <span className="copilot-agent-logo-gem">🤖</span>
            <div>
              <div className="copilot-agent-brand-title">
                E-Gov Copilot <span className="copilot-agent-badge">AI Agent</span>
              </div>
              <div className="copilot-agent-brand-sub">
                {lang === 'ta' ? 'தமிழ்நாடு அரசு மின்-ஆளுமை வழிகாட்டி' : 'Government of Tamil Nadu · Universal Officer Assistant'}
              </div>
            </div>
          </div>
        </div>

        <div className="copilot-agent-header-right">
          {/* Tamil / English Toggle in Marked Area */}
          <div className="copilot-lang-toggle" role="group" aria-label="Language Toggle">
            <button
              type="button"
              className={`copilot-lang-toggle-btn ${copilotLang === 'en' ? 'active' : ''}`}
              onClick={() => handleLangChange('en')}
              aria-pressed={copilotLang === 'en'}
              title="Switch to English"
            >
              English
            </button>
            <button
              type="button"
              className={`copilot-lang-toggle-btn ${copilotLang === 'ta' ? 'active' : ''}`}
              onClick={() => handleLangChange('ta')}
              aria-pressed={copilotLang === 'ta'}
              title="தமிழுக்கு மாறுக"
            >
              தமிழ்
            </button>
          </div>

          <button
            type="button"
            className="copilot-theme-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? (lang === 'ta' ? 'வெளிச்ச முறைக்கு மாறுக' : 'Switch to Light Theme') : (lang === 'ta' ? 'இருண்ட முறைக்கு மாறுக' : 'Switch to Dark Theme')}
          >
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
          {started && (
            <button
              type="button"
              className="copilot-dark-action-btn"
              onClick={createNewConversation}
              title={lang === 'ta' ? 'புதிய உரையாடல்' : 'New Chat'}
            >
              + {lang === 'ta' ? 'புதிய உரையாடல்' : 'New Chat'}
            </button>
          )}
          <button
            type="button"
            className="copilot-dark-action-btn close"
            onClick={onClose}
            title={lang === 'ta' ? 'மூடுக' : 'Close'}
          >
            ✕
          </button>
        </div>
      </header>

      {showSettings && <AiSettingsDialog onClose={() => setShowSettings(false)} />}

      {/* Body Layout: Real ChatGPT Left Sidebar + Wide Centered Conversation */}
      <div className="copilot-agent-body-layout">
        {sidebarOpen && (
          <aside className="copilot-chatgpt-sidebar">
            <div className="copilot-sidebar-top">
              <button
                type="button"
                className="copilot-sidebar-new-btn"
                onClick={createNewConversation}
              >
                <span className="plus-icon">+</span>
                <span>{lang === 'ta' ? 'புதிய உரையாடல்' : 'New Chat'}</span>
              </button>
            </div>

            <div className="copilot-sidebar-history-section">
              <div className="copilot-sidebar-label">
                {lang === 'ta' ? 'சமீபத்திய உரையாடல்கள்' : 'Recent Conversations'}
              </div>
              <div className="copilot-sidebar-list">
                {conversations.map((c) => (
                  <div
                    key={c.id}
                    className={`copilot-sidebar-item ${c.id === activeConv.id ? 'active' : ''}`}
                    title={c.title}
                    onClick={() => switchToConversation(c.id)}
                  >
                    <span className="chat-icon">💬</span>
                    <span className="chat-title">{c.title || (lang === 'ta' ? 'புதிய உரையாடல்' : 'New Chat')}</span>
                    {conversations.length > 1 && (
                      <button
                        type="button"
                        className="copilot-sidebar-delete-btn"
                        title={lang === 'ta' ? 'நீக்குக' : 'Delete conversation'}
                        onClick={(e) => deleteConversation(c.id, e)}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Tools in Sidebar */}
            <div className="copilot-sidebar-tools-section">
              <div className="copilot-sidebar-label">
                {lang === 'ta' ? 'அலுவலர் கருவிகள்' : 'Officer Tools'}
              </div>
              <button
                type="button"
                className="copilot-sidebar-tool-btn"
                onClick={() => fileRef.current?.click()}
              >
                📄 {lang === 'ta' ? 'ஆவண OCR ஆய்வு' : 'Upload Document OCR'}
              </button>
              <button
                type="button"
                className="copilot-sidebar-tool-btn"
                onClick={() => {
                  setInput(lang === 'ta' ? 'கள ஆய்வு உத்தரவு வரைவு தயார் செய்யவும்' : 'Draft official inspection memo');
                  taRef.current?.focus();
                }}
              >
                📝 {lang === 'ta' ? 'உத்தரவு வரைவு' : 'Draft Inspection Memo'}
              </button>
              <button
                type="button"
                className="copilot-sidebar-tool-btn"
                onClick={() => {
                  setInput('Write a python script for citizen grievance priority categorization');
                  taRef.current?.focus();
                }}
              >
                💻 {lang === 'ta' ? 'நிரல் / குறியீடு' : 'Code & Analytics'}
              </button>
            </div>

            <div className="copilot-sidebar-footer">
              <button
                type="button"
                className="copilot-sidebar-clear-btn"
                onClick={clearThread}
                title={lang === 'ta' ? 'அரட்டையை அழிக்க' : 'Clear Chat Thread'}
              >
                🗑 {lang === 'ta' ? 'அரட்டையை அழிக்க' : 'Clear History'}
              </button>
            </div>
          </aside>
        )}

        <div className="copilot-agent-main-content">
          {/* Centered Scrollable Conversation Area */}
          <div className="copilot-agent-scroll-area">
        <div className="copilot-agent-centered-column">
          {!loaded && (
            <div className="copilot-loading-screen" style={{ minHeight: '40vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <GovernmentLogoLoader
                size="md"
                label={lang === 'ta' ? 'உரையாடல் ஏற்றப்படுகிறது...' : 'Initializing Universal AI Agent...'}
              />
            </div>
          )}

          {loaded && !started && (
            <div className="copilot-agent-welcome-card">
              <div className="copilot-hero-avatar">
                <span className="copilot-hero-icon">⚖️</span>
              </div>
              <h1 className="copilot-hero-title">
                {lang === 'ta' ? 'வணக்கம், அலுவலரே!' : 'Welcome, Grievance Redressal Officer'}
              </h1>
              <p className="copilot-hero-subtitle">
                {lang === 'ta'
                  ? 'தமிழ்நாடு மின்-ஆளுமை துணை முகவர்: அரசு உத்தரவுகள் வரைவு, சட்ட வழிகாட்டுதல், திட்டங்கள், நிரலாக்க வினவல்கள் அல்லது ஆவணங்களை ஆய்வு செய்யலாம்.'
                  : 'Universal AI Agent for Government Operations: Draft official memos, consult statutory Acts & schemes, generate technical scripts, or analyze uploaded grievance letters with OCR.'}
              </p>

              {/* 2x2 Interactive Quick Prompt Cards */}
              <div className="copilot-starter-grid">
                {STARTER_PROMPTS.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="copilot-starter-card"
                    onClick={() => {
                      if (item.action) {
                        item.action();
                      } else if (item.query) {
                        setInput(item.query);
                        taRef.current?.focus();
                      }
                    }}
                  >
                    <div className="copilot-starter-icon">{item.icon}</div>
                    <div className="copilot-starter-info">
                      <div className="copilot-starter-title">{item.title}</div>
                      <div className="copilot-starter-desc">{item.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages Stream */}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`copilot-chat-row ${m.role === 'USER' ? 'user-row' : 'agent-row'}`}
            >
              {m.role === 'ASSISTANT' && (
                <div className="copilot-message-avatar">
                  <span>🤖</span>
                </div>
              )}

              <div className={`copilot-bubble ${m.role === 'USER' ? 'user-bubble' : 'agent-bubble'}${m.error ? ' error-bubble' : ''}`}>
                {/* Attached file card in user message */}
                {m.file && (
                  <div className="copilot-file-tag">
                    <span className="copilot-file-icon">📄</span>
                    <span className="copilot-file-name">{m.file.name}</span>
                    <span className="copilot-file-size">({humanSize(m.file.size)})</span>
                  </div>
                )}

                {/* Mixed language badge */}
                {m.role === 'USER' && isMixed(m.content) && (
                  <div className="copilot-mixed-badge" title={t('cop.mixedHint')}>
                    🔤 {lang === 'ta' ? 'தமிழ் + English' : 'Tamil + English Query'}
                  </div>
                )}

                {/* Main Message Content */}
                <div className="copilot-message-text">
                  {m.role === 'ASSISTANT' && !m.error
                    ? renderMarkdownContent(
                        m.analysis
                          ? summariseDocAnalysis(
                              m.analysis,
                              copilotLang,
                              t,
                            )
                          : cleanAssistantText(m.content),
                      )
                    : m.content.split('\n').map((line, i) =>
                        line.trim() ? <p key={i}>{line}</p> : <div key={i} className="agent-spacer" />
                      )}
                </div>

                {/* Grounding Source Chips - shown when inspecting an analyzed document / petition */}
                {m.role === 'ASSISTANT' && !m.error && m.analysis && m.sources && m.sources.filter((s: any) => s.type !== 'WEB').length > 0 && (
                  <div className="copilot-sources-strip">
                    <span className="copilot-sources-heading">
                      {lang === 'ta' ? 'ஆதாரங்கள்:' : 'Sources:'}
                    </span>
                    {m.sources
                      .filter((src: any) => src.type !== 'WEB')
                      .map((src: any, i: number) => (
                        <span
                          key={i}
                          className={`copilot-src-pill src-${(src.type || 'PETITION').toLowerCase()}`}
                          title={src.label}
                        >
                          {sourceIcon(src.type)} {src.label}
                        </span>
                      ))}
                  </div>
                )}

                {/* Grounding Web Source Badges from Real-Time Search */}
                {m.role === 'ASSISTANT' && !m.error && m.webSources && m.webSources.length > 0 && (
                  <div className="copilot-sources-strip" style={{ marginTop: '0.4rem' }}>
                    <span className="copilot-sources-heading">
                      {lang === 'ta' ? '🌐 சரிபார்க்கப்பட்ட இணையதளங்கள்:' : '🌐 Verified Sources:'}
                    </span>
                    {m.webSources.slice(0, 4).map((src: any, i: number) => (
                      <a
                        key={i}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="copilot-src-pill src-web"
                        title={`${src.title}\n${src.url}`}
                        style={{ textDecoration: 'none', cursor: 'pointer' }}
                      >
                        🌐 {src.source || 'Official Source'} ↗
                      </a>
                    ))}
                  </div>
                )}

                {/* Assistant Footer: Confidence + Actions */}
                {m.role === 'ASSISTANT' && !m.error && (
                  <div className="copilot-message-footer">
                    {m.confidence != null && (
                      <span
                        className={`copilot-conf-pill tier-${(m.confidenceTier || 'HIGH').toLowerCase()}`}
                      >
                        {pct(m.confidence)}
                        {m.confidenceTier && <span> · {m.confidenceTier}</span>}
                      </span>
                    )}

                    <div className="copilot-spacer" />

                    <button
                      type="button"
                      className="copilot-msg-action-btn"
                      onClick={() => copy(m)}
                      title={t('cop.copy')}
                    >
                      {copiedId === m.id ? '✓ Copied' : '⧉ Copy'}
                    </button>

                    {tts.supported && (
                      <button
                        type="button"
                        className="copilot-msg-action-btn"
                        onClick={() => void listen(m)}
                        title={speakingId === m.id ? 'Stop audio' : t('cop.listen')}
                      >
                        {speakingId === m.id ? '■ Stop' : '🔊 Listen'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Thinking / Real-Time Search / OCR Processing Indicator */}
          {busy && (
            <div className="copilot-chat-row agent-row">
              <div className="copilot-bubble agent-bubble thinking-bubble" style={{ padding: '0.65rem 1.15rem' }}>
                <GovernmentLogoLoader
                  size="xs"
                  inline
                  label={stage ? t(STAGE_KEY[stage] ?? 'agent.stageUpload') : (lang === 'ta' ? 'மின்-ஆளுமை துணை சிந்திக்கிறது & ஆதாரங்களைச் சரிபார்க்கிறது...' : 'E-Gov Copilot is analyzing & cross-verifying verified sources...')}
                />
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>
      </div>

      {/* Floating Bottom Input Capsule (Centered max-width: 860px) */}
      <div className="copilot-docked-input-wrapper">
        <div className="copilot-centered-input-box">
          {/* Active file preview if attached */}
          {file && (
            <div className="copilot-staged-file-chip">
              <span className="file-sym">📄</span>
              <span className="file-name">{file.name}</span>
              <span className="file-size">({humanSize(file.size)})</span>
              <button
                type="button"
                className="file-remove-btn"
                onClick={() => {
                  setFile(null);
                  if (fileRef.current) fileRef.current.value = '';
                }}
                title="Remove attachment"
              >
                ✕
              </button>
            </div>
          )}

          {/* Open Petition Context Indicator */}
          {docId && !file && (
            <div className="copilot-context-banner">
              <span>📎 {lang === 'ta' ? `இணைக்கப்பட்ட மனு #${docId}` : `Grounded to Petition Context #${docId}`}</span>
              <button
                type="button"
                onClick={() => setDocId(null)}
                className="context-detach-btn"
                title={lang === 'ta' ? 'தொடர்பை நீக்கு' : 'Detach petition context'}
              >
                ✕
              </button>
            </div>
          )}

          <div className="copilot-capsule-row">
            {/* Attachment Button */}
            <button
              type="button"
              className="copilot-attachment-btn"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              title={lang === 'ta' ? 'ஆவணத்தை இணைக்க (PDF / Word / படம்)' : 'Attach document (PDF, DOCX, Images up to 15MB)'}
            >
              +
            </button>

            {/* Input Textarea */}
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              placeholder={
                file
                  ? (lang === 'ta' ? 'இணைக்கப்பட்ட ஆவணம் குறித்த வழிமுறைகளை உள்ளிடவும்...' : 'Add instructions for attached document (e.g. summarize, find Act)...')
                  : (lang === 'ta' ? 'எதையும் கேளுங்கள்... (உத்தரவு வரைவு, சட்டம், நிரல் அல்லது ஆவணம்)' : 'Message E-Gov Copilot... (e.g. draft memo, search Act, write code, or upload document)')
              }
              disabled={busy}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
              }}
              onKeyDown={onKeyDown}
            />

            {/* Voice Dictation (Microphone) Button */}
            {speechSupport().supported && (
              <button
                type="button"
                className={`copilot-mic-btn ${isListening ? 'listening' : ''}`}
                onClick={toggleListening}
                disabled={busy}
                title={
                  isListening
                    ? (lang === 'ta' ? 'கேட்பதை நிறுத்துக' : 'Listening... click to stop')
                    : (lang === 'ta' ? 'குரல் உள்ளீடு (தமிழ் / ஆங்கிலம் / Tanglish பேசலாம்)' : 'Voice input (Speak in Tamil, English, or Tanglish)')
                }
              >
                {isListening ? '🎙️…' : '🎙️'}
              </button>
            )}

            {/* Send Button */}
            <button
              type="button"
              className={`copilot-send-circle-btn ${canSend ? 'active' : ''}`}
              disabled={!canSend}
              onClick={() => void send()}
              title={t('agent.send')}
            >
              ↑
            </button>
          </div>

          <div className="copilot-legal-disclaimer">
            {lang === 'ta'
              ? 'மின்-ஆளுமை துணை AI வழிகாட்டல் மட்டுமே. இறுதி உத்தரவுகளுக்கு அதிகாரப்பூர்வ அரசிதழை சரிபார்க்கவும்.'
              : 'E-Gov Copilot provides AI decision support. Verify statutory citations against official government gazettes.'}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            style={{ display: 'none' }}
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>
        </div>
      </div>
    </div>
  );
}
