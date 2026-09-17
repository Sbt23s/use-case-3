import { useCallback, useEffect, useRef, useState } from 'react';
import '../poc-styles.css';
import { PocLogin } from './PocLogin';
import { OfficerDashboard } from './OfficerDashboard';
import { PetitionDetail } from './PetitionDetail';
import { pocApi, setPocToken, getPocToken, clearPocToken, type PocUser } from './pocApi';
import { AppFooter } from './AppFooter';
import { CopilotPanel } from './CopilotPanel';
import { AiSettingsDialog } from './AiSettingsDialog';
import { useI18n, LanguageToggle } from '../lib/i18n';
import { displayName } from '../lib/translit';

/**
 * Grievance Management POC — Officer Console.
 *
 * The Citizen role has been removed. The Grievance Officer now handles the
 * full workflow: receiving petitions, uploading letters on behalf of citizens,
 * triggering AI analysis, and actioning the results.
 */
export function PocApp() {
  const { t, lang } = useI18n();
  const [user, setUser] = useState<PocUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [copilot, setCopilot] = useState(false);
  const [aiSettings, setAiSettings] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const [feed, setFeed] = useState<any[]>([]);
  const esRef = useRef<EventSource | null>(null);

  // ---------------- session ----------------
  useEffect(() => {
    if (!getPocToken()) { setLoading(false); return; }
    pocApi.get<{ user: PocUser }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => { clearPocToken(); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  // ---------------- real-time stream ----------------
  useEffect(() => {
    if (!user) return;
    const token = getPocToken();
    if (!token) return;

    const es = new EventSource(`/api/cp/stream?token=${encodeURIComponent(token)}`);
    esRef.current = es;

    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);

    const push = (kind: string, data: any) =>
      setFeed((f) => [{ kind, data, at: new Date() }, ...f].slice(0, 40));

    es.addEventListener('petition:new', (e) => push('petition:new', JSON.parse((e as MessageEvent).data)));
    es.addEventListener('petition:update', (e) => push('petition:update', JSON.parse((e as MessageEvent).data)));
    es.addEventListener('document:ocr', (e) => push('document:ocr', JSON.parse((e as MessageEvent).data)));
    // e-Gov Copilot document analysis progress.
    es.addEventListener('copilot:progress', (e) => push('copilot:progress', JSON.parse((e as MessageEvent).data)));

    return () => { es.close(); esRef.current = null; setLive(false); };
  }, [user]);

  const logout = useCallback(() => {
    esRef.current?.close();
    clearPocToken();
    setUser(null);
    setOpenId(null);
    setFeed([]);
  }, []);

  if (loading) {
    // The footer belongs on every screen, including this one.
    return (
      <div className="poc">
        <main className="poc-main"><div className="empty"><span className="spin" /></div></main>
        <AppFooter />
      </div>
    );
  }

  if (!user) {
    return (
      <PocLogin onLogin={async (token, userObj) => {
        setPocToken(token);
        if (userObj) {
          setUser(userObj);
        } else {
          try {
            const r = await pocApi.get<{ user: PocUser }>('/auth/me');
            setUser(r.user);
          } catch {
            // fallback
          }
        }
      }} />
    );
  }

  return (
    <div className="poc">
      <header className="poc-header">
        <div className="mark">⚖</div>
        <div>
          <div className="title">{t('app.title')}</div>
          <div className="sub">{t('app.subtitle')}</div>
        </div>
        <div className="grow" />
        {/* Language toggle: switches the whole console in place, no reload. */}
        <LanguageToggle />
        {/*
          * Which model answers. Reachable from the console itself, not only
          * from inside the Copilot, because it also governs the analysis that
          * runs on upload.
          */}
        <button
          className="ai-btn"
          onClick={() => setAiSettings(true)}
          title={t('aim.settings')}
        >
          ⚙ {t('aim.title')}
        </button>
        <div className="who">
          <b>{displayName(user.fullName.replace(/,\s*(Grievance Officer|குறைதீர்ப்பு அலுவலர்)/i, '').trim(), lang)}</b>
          {t('app.role')}
        </div>
        <button onClick={logout}>{t('common.signOut')}</button>
      </header>

      <nav className="poc-nav">
        <button
          className={openId === null ? 'on' : ''}
          onClick={() => setOpenId(null)}
        >
          {t('nav.petitions')}
        </button>
        {/*
          * e-Gov Copilot sits where AI Knowledge Configuration used to.
          *
          * Knowledge Configuration is hidden from the console but remains
          * FULLY functional on the server: /api/kb/* is unchanged, and the
          * analyser still reads every Act, Department and Authority from it.
          * Only the navigation entry is gone.
          */}
        {/*
          * The Copilot opens OVER the console rather than replacing it, so the
          * list or case an officer was reading is still there behind the panel
          * and is still there when they close it.
          */}
        <button
          className={copilot ? 'on' : ''}
          onClick={() => setCopilot((v) => !v)}
          aria-expanded={copilot}
        >
          🤖 {t('nav.copilot')}
        </button>
        <div className="live">
          <span className={`dot${live ? ' on' : ''}`} />
          {live ? t('common.live') : t('common.reconnecting')}
        </div>
      </nav>

      <main className="poc-main">
        {openId === null
          ? <OfficerDashboard feed={feed} live={live} onOpen={setOpenId} />
          : <PetitionDetail petitionId={openId} feed={feed} onBack={() => setOpenId(null)} />}
      </main>

      <AppFooter />

      {/*
        * Mounted alongside the console, not in place of it. `feed` is shared so
        * the panel follows a document it uploads on the same live stream the
        * rest of the console is already listening to.
        */}
      {copilot && <CopilotPanel feed={feed} onClose={() => setCopilot(false)} />}
      {aiSettings && <AiSettingsDialog onClose={() => setAiSettings(false)} />}
    </div>
  );
}
