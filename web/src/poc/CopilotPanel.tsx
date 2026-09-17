import { useCallback, useEffect, useRef, useState } from 'react';
import { pocApi, pct, getPocToken } from './pocApi';
import { useI18n } from '../lib/i18n';
import { speak, stopSpeaking, ttsSupport, type SpeakHandle } from '../lib/tts';
import { AiSettingsDialog } from './AiSettingsDialog';

/**
 * e-Gov Copilot — Hermes-pattern AI assistant panel.
 *
 * Upgraded with:
 *   - Source chips (📋 petition / 📚 knowledge base / 🌐 official sources)
 *   - Tool badges (which Hermes tools answered the question)
 *   - Confidence tier badges (HIGH/MEDIUM/LOW colour-coded)
 *   - Markdown-lite rendering (bullet points, bold text)
 *   - Mixed-language indicator
 *   - Anti-hallucination notice when information is unavailable
 *
 * IT IS A CONVERSATION, NOT A SEARCH BOX. The server keeps the officer's
 * recent turns so "which department?" after "which Act applies?" resolves
 * correctly. The thread survives closing the panel.
 */

const ACCEPT = [
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/jpg', 'image/png', 'text/plain',
].join(',');

const MAX_BYTES = 15 * 1024 * 1024;

interface Msg {
  id: number;
  role: 'USER' | 'ASSISTANT';
  content: string;
  confidence?: number | null;
  confidenceTier?: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  sources?: any[];
  toolsUsed?: string[];
  file?: { name: string; size: number };
  error?: boolean;
  /*
   * The ANALYSIS ITSELF, not just the sentence built from it.
   *
   * `summarise()` flattens a bilingual analysis into one string, so a reply
   * generated while English was selected stayed English for ever - switching
   * the toggle afterwards could not retranslate text that had already been
   * written. Keeping the raw result lets the reply be rebuilt on every render,
   * in whichever language is currently selected.
   */
  analysis?: any;
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Progress lines keyed to the stages the server actually publishes. */
const STAGE_KEY: Record<string, string> = {
  UPLOADING: 'agent.stageUpload',
  EXTRACTING: 'agent.stageRead',
  EXTRACTED: 'agent.stageUnderstand',
  ANALYSING: 'agent.stageClassify',
  COMPLETED: 'agent.stageWorkflow',
};

/** Detect mixed Tamil+English script in a string. */
function isMixed(text: string): boolean {
  const ta = (text.match(/[஀-௿]/g) || []).length;
  const en = (text.match(/[A-Za-z]/g) || []).length;
  const total = ta + en;
  if (!total) return false;
  return ta / total > 0.1 && en / total > 0.1;
}

/** Source icon per source type. */
function sourceIcon(type: string): string {
  if (type === 'PETITION') return '📋';
  if (type === 'ACT' || type === 'SECTION') return '⚖️';
  if (type === 'DEPARTMENT') return '🏛️';
  if (type === 'AUTHORITY') return '👤';
  if (type === 'WEB') return '🌐';
  return '📄';
}

/** Tool icon per tool name (Hermes tool definitions). */
function toolIcon(toolName: string): string {
  if (toolName === 'search_petition') return '📋';
  if (toolName === 'query_knowledge_base') return '📚';
  if (toolName === 'search_official_sources') return '🌐';
  if (toolName === 'get_statistics') return '📊';
  return '🔧';
}

/** Tool label in Tamil or English. */
function toolLabel(toolName: string, lang: string): string {
  const labels: Record<string, { en: string; ta: string }> = {
    search_petition: { en: 'Petition', ta: 'மனு' },
    query_knowledge_base: { en: 'Knowledge Base', ta: 'அறிவுத் தளம்' },
    search_official_sources: { en: 'Official Sources', ta: 'அரசு ஆதாரங்கள்' },
    get_statistics: { en: 'Statistics', ta: 'புள்ளிவிவரம்' },
  };
  const entry = labels[toolName];
  if (!entry) return toolName;
  return lang === 'ta' ? entry.ta : entry.en;
}

/**
 * Render AI answer text with markdown-lite formatting.
 *
 * Supports:
 *   • Bullet points (lines starting with •, -, *, or numbers)
 *   • **bold** text
 *   • Blank lines → paragraph breaks
 */
function renderAnswer(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = text.split('\n');
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      nodes.push(<br key={key++} />);
      continue;
    }

    // Bullet lines
    const bulletMatch = line.match(/^[\s]*[•\-\*]\s+(.+)$/)
      || line.match(/^[\s]*\d+\.\s+(.+)$/);
    if (bulletMatch) {
      nodes.push(
        <p key={key++} className="bullet-line">
          <span className="bullet-dot">•</span>
          {renderInline(bulletMatch[1])}
        </p>,
      );
      continue;
    }

    // Indented continuation lines
    nodes.push(<p key={key++}>{renderInline(line)}</p>);
  }
  return nodes;
}

/** Render **bold** within a line. */
function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

export function CopilotPanel({ feed, onClose, petitionId }: {
  feed: any[];
  onClose: () => void;
  petitionId?: number | null;
}) {
  const { t, lang } = useI18n();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [docId, setDocId] = useState<number | null>(petitionId ?? null);
  const [loaded, setLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const speakRef = useRef<SpeakHandle | null>(null);
  const tts = ttsSupport();

  const push = (m: Omit<Msg, 'id'>) =>
    setMessages((prev) => [...prev, { ...m, id: Date.now() + Math.random() }]);

  // ---- restore the thread on mount ----
  useEffect(() => {
    pocApi.get<{ messages: any[] }>('/cp/e-gov-chat')
      .then((r) => {
        setMessages((r.messages ?? []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          confidence: m.confidence,
          confidenceTier: m.confidence_tier ?? null,
          toolsUsed: (() => { try { return JSON.parse(m.tools_used ?? '[]'); } catch { return []; } })(),
          sources: (() => { try { return JSON.parse(m.sources ?? '[]'); } catch { return []; } })(),
        })));
      })
      .catch(() => { /* empty thread is fine */ })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, stage]);

  useEffect(() => () => { stopSpeaking(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const loadResult = useCallback(async (id: number) => {
    try { return await pocApi.get<any>(`/cp/copilot/result/${id}`); } catch { return null; }
  }, []);

  /* ---- follow real server stages while a document is processed ---- */
  useEffect(() => {
    if (!docId || !busy) return;
    const mine = feed.filter((f) => f.kind === 'copilot:progress' && f.data?.petitionId === docId);
    if (!mine.length) return;
    const latest = mine[0].data;

    if (latest.stage === 'FAILED') {
      setBusy(false); setStage(null);
      push({ role: 'ASSISTANT', content: latest.message || t('agent.errUnreadable'), error: true });
      return;
    }
    setStage(latest.stage);

    if (latest.stage === 'COMPLETED') {
      void (async () => {
        const r = await loadResult(docId);
        setBusy(false); setStage(null);
        push({
          role: 'ASSISTANT',
          content: summarise(r, lang, t),
          confidence: r?.analysis?.overall_confidence,
          analysis: r,
        });
      })();
    }
  }, [feed, docId, busy, loadResult, lang, t]);

  const pickFile = (f: File | null) => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      push({ role: 'ASSISTANT', content: `${t('agent.tooLarge')} (${humanSize(f.size)})`, error: true });
      return;
    }
    setFile(f);
    taRef.current?.focus();
  };

  const send = async () => {
    if (busy) return;
    const question = input.trim();

    // ---- document upload path ----
    if (file) {
      push({ role: 'USER', content: question || t('agent.analyseThis'), file: { name: file.name, size: file.size } });
      setInput(''); setBusy(true); setStage('UPLOADING');
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
        setBusy(false); setStage(null);
        push({ role: 'ASSISTANT', content: e.message ?? t('agent.errUpload'), error: true });
      }
      return;
    }

    if (!question) return;
    push({ role: 'USER', content: question });
    setInput(''); setBusy(true);
    try {
      const r = await pocApi.post<any>('/cp/e-gov-chat', {
        question,
        lang,
        ...(docId ? { petitionId: docId } : {}),
      });
      push({
        role: 'ASSISTANT',
        content: r.answer,
        confidence: r.confidence,
        confidenceTier: r.confidenceTier ?? null,
        sources: r.sources,
        toolsUsed: r.toolsUsed ?? [],
      });
    } catch (e: any) {
      push({ role: 'ASSISTANT', content: e.message ?? t('agent.errAnswer'), error: true });
    } finally {
      setBusy(false);
    }
  };

  const clearThread = async () => {
    try { await pocApi.del('/cp/e-gov-chat'); } catch { /* clears anyway */ }
    setMessages([]); setDocId(null); setFile(null); stopSpeaking(); setSpeakingId(null);
  };

  const copy = async (m: Msg) => {
    try {
      await navigator.clipboard.writeText(m.content);
      setCopiedId(m.id);
      setTimeout(() => setCopiedId((c) => (c === m.id ? null : c)), 1600);
    } catch { /* clipboard blocked */ }
  };

  const listen = async (m: Msg) => {
    if (speakingId === m.id) {
      speakRef.current?.stop(); speakRef.current = null; setSpeakingId(null);
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

  const download = async () => {
    const { buildConversationReport } = await import('../lib/report');
    const pdf = await buildConversationReport({
      title: t('cop.title'),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      lang,
    });
    pdf.save('e-gov-copilot-conversation.pdf');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  const canSend = !busy && (!!file || !!input.trim());
  const started = messages.length > 0;

  const SUGGESTED = [
    t('cop.q1'), t('cop.q2'), t('cop.q3'), t('cop.q4'),
  ];

  return (
    <>
      <div className="copilot-scrim" onClick={() => { if (!busy) onClose(); }} />
      <aside className="copilot-panel" role="dialog" aria-label={t('cop.title')}>
        <header className="copilot-head">
          <span className="mark" aria-hidden="true">🤖</span>
          <div className="grow">
            <div className="ttl">{t('cop.title')}</div>
            <div className="sub">{t('cop.subtitle')}</div>
          </div>
          {started && (
            <>
              <button className="icon" onClick={download} title={t('agent.download')}>⬇</button>
              <button className="icon" onClick={clearThread} title={t('cop.clearChat')}>🗑</button>
            </>
          )}
          <button
            className="icon"
            onClick={() => setShowSettings(true)}
            title={t('aim.settings')}
            aria-label={t('aim.settings')}
          >⚙</button>
          <button className="icon close" onClick={onClose} title={t('common.close')}>✕</button>
        </header>

        {showSettings && <AiSettingsDialog onClose={() => setShowSettings(false)} />}

        <div className="copilot-body">
          {!loaded && <div className="empty"><span className="spin" /></div>}

          {loaded && !started && (
            <div className="copilot-welcome">
              <h3>{t('cop.welcome')}</h3>
              <p className="small muted">{t('cop.welcomeSub')}</p>
              <div className="suggest">
                {SUGGESTED.map((q) => (
                  <button key={q} onClick={() => { setInput(q); taRef.current?.focus(); }}>{q}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`cmsg ${m.role === 'USER' ? 'user' : 'agent'}`}>
              <div className={`bubble${m.error ? ' err' : ''}`}>
                {/* File attachment indicator */}
                {m.file && (
                  <div className="file-line">📄 {m.file.name}
                    <span className="muted"> · {humanSize(m.file.size)}</span>
                  </div>
                )}

                {/* Mixed-language indicator for user messages */}
                {m.role === 'USER' && isMixed(m.content) && (
                  <div className="mixed-lang-badge" title={t('cop.mixedHint')}>
                    {lang === 'ta' ? '🔤 தமிழ் + English' : '🔤 Tamil + English'}
                  </div>
                )}

                {/* Message content — markdown-lite rendered for assistant */}
                <div className="msg-content">
                  {/*
                    * A document analysis is rebuilt from its stored result on
                    * every render, so it follows the language toggle live. A
                    * plain chat answer is the model's own prose and cannot be
                    * re-rendered — it stays as written, which is correct: the
                    * officer asked in that language and got that answer.
                    */}
                  {m.role === 'ASSISTANT' && !m.error
                    ? renderAnswer(m.analysis ? summarise(m.analysis, lang, t) : m.content)
                    : m.content.split('\n').map((line, i) =>
                        line.trim() ? <p key={i}>{line}</p> : <br key={i} />
                      )}
                </div>

                {/* Hermes tool badges — which tools answered this */}
                {m.role === 'ASSISTANT' && !m.error && m.toolsUsed && m.toolsUsed.length > 0 && (
                  <div className="tool-badges">
                    {m.toolsUsed.map((tool) => (
                      <span key={tool} className="tool-badge" title={tool}>
                        {toolIcon(tool)} {toolLabel(tool, lang)}
                      </span>
                    ))}
                  </div>
                )}

                {/* Source chips — what grounded this answer */}
                {m.role === 'ASSISTANT' && !m.error && m.sources && m.sources.length > 0 && (
                  <div className="source-chips">
                    <span className="sources-label">
                      {lang === 'ta' ? 'ஆதாரங்கள்:' : 'Sources:'}
                    </span>
                    {m.sources.map((src: any, i: number) => (
                      <span key={i} className={`src-chip src-${(src.type || 'WEB').toLowerCase()}`}>
                        {sourceIcon(src.type)} {src.label}
                      </span>
                    ))}
                  </div>
                )}

                {/* Confidence + action bar */}
                {m.role === 'ASSISTANT' && !m.error && (
                  <div className="cmsg-tools">
                    {m.confidence != null && (
                      <span className={`poc-chip ai conf-${(m.confidenceTier || 'LOW').toLowerCase()}`}
                        title={confidenceTip(m.confidenceTier, lang)}>
                        {pct(m.confidence)}
                        {m.confidenceTier && (
                          <span className="conf-tier"> {m.confidenceTier}</span>
                        )}
                      </span>
                    )}
                    <div className="grow" />
                    <button onClick={() => copy(m)} title={t('cop.copy')}>
                      {copiedId === m.id ? '✓' : '⧉'}
                    </button>
                    {tts.supported && (
                      <button onClick={() => void listen(m)} title={t('cop.listen')}>
                        {speakingId === m.id ? '■' : '🔊'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="cmsg agent">
              <div className="bubble thinking">
                <span className="dots"><i /><i /><i /></span>
                <span>{stage ? t(STAGE_KEY[stage] ?? 'agent.stageUpload') : t('cop.thinking')}</span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="copilot-composer">
          {file && (
            <div className="attach-chip">
              📄 {file.name}<span className="muted"> · {humanSize(file.size)}</span>
              <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>×</button>
            </div>
          )}
          {docId && !file && (
            <div className="ctx-chip" title={t('cop.contextNote')}>
              📎 {t('cop.context')}
            </div>
          )}
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            placeholder={file ? t('agent.placeholderFile') : t('cop.placeholder')}
            disabled={busy}
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
            }}
            onKeyDown={onKeyDown}
          />
          <div className="row">
            <button className="tool" disabled={busy} onClick={() => fileRef.current?.click()}
              title={t('agent.attach')}>+</button>
            <div className="grow" />
            <button className={`send${canSend ? ' on' : ''}`} disabled={!canSend}
              onClick={() => void send()} title={t('agent.send')}>↑</button>
          </div>
          <input ref={fileRef} type="file" accept={ACCEPT} style={{ display: 'none' }}
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
        </div>
      </aside>
    </>
  );
}

/** Tooltip text for confidence tier. */
function confidenceTip(tier: string | null | undefined, lang: string): string {
  if (!tier) return '';
  if (tier === 'HIGH') return lang === 'ta'
    ? 'மனு + அறிவுத் தளம் + அதிகாரப்பூர்வ ஆதாரங்கள் அனைத்தும் பயன்படுத்தப்பட்டன.'
    : 'Strong — petition, knowledge base, and official sources all grounded this answer.';
  if (tier === 'MEDIUM') return lang === 'ta'
    ? 'ஓரளவு நம்பகமான பதில். நடவடிக்கைக்கு முன் சரிபார்க்கவும்.'
    : 'Reasonable match — verify the Act and department before acting.';
  return lang === 'ta'
    ? 'பலவீனமான பொருத்தம். ஒவ்வொரு உருப்படியையும் ஆவணத்துடன் சரிபார்க்கவும்.'
    : 'Weak match — please verify every field against the source document.';
}

/**
 * Turn a finished document analysis into the agent's opening reply.
 */
function summarise(r: any, lang: string, t: (k: string) => string): string {
  const a = r?.analysis;
  if (!a) return t('agent.errUnreadable');
  const L = lang === 'ta' ? 'ta' : 'en';
  const v = (b: any) => (b && typeof b === 'object' ? (b[L] || b.en) : b) || '—';

  const lines = [
    v(a.summary),
    '',
    `${t('ai.act')}: ${a.act?.id ? v(a.act.short_name) : t('agent.notIdentified')}`,
    `${t('agent.section')}: ${a.act?.section_no ?? t('agent.needsVerification')}`,
    `${t('ai.department')}: ${a.department?.id ? v(a.department.name) : t('agent.deptUnknown')}`,
    `${t('ai.authority')}: ${a.authority?.id ? v(a.authority.designation) : t('agent.notIdentified')}`,
    `${t('ai.priority')}: ${a.priority ?? '—'}`,
    '',
    `${t('agent.secAction')}: ${v(a.next_action)}`,
  ];
  return lines.join('\n');
}
