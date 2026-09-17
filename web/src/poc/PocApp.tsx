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
  const [searchQ, setSearchQ] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const esRef = useRef<EventSource | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Real-time search debounced by 200ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setActiveSearch(searchQ.trim());
      if (searchQ.trim() && openId !== null) {
        setOpenId(null);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQ, openId]);

  const handleNavSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setOpenId(null);
    setActiveSearch(searchQ.trim());
  };

  const handleClearSearch = useCallback(() => {
    setSearchQ('');
    setActiveSearch('');
    searchInputRef.current?.focus();
  }, []);

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
    setSearchQ('');
    setActiveSearch('');
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
        <div className="who">
          <b>{displayName(user.fullName.replace(/,\s*(Grievance Officer|குறைதீர்ப்பு அலுவலர்)/i, '').trim(), lang)}</b>
          {t('app.role')}
        </div>
        <button onClick={logout}>{t('common.signOut')}</button>
      </header>

      <nav className="poc-nav">
        <div className="poc-nav-left">
          <button
            className={openId === null ? 'on' : ''}
            onClick={() => setOpenId(null)}
          >
            {t('nav.petitions')}
          </button>
          <button
            className={`nav-copilot-btn ${copilot ? 'on' : ''}`}
            onClick={() => setCopilot((v) => !v)}
            aria-expanded={copilot}
          >
            🤖 {t('nav.copilot')}
          </button>
        </div>

        {/* Global Search Box in Grey Navbar */}
        <form className="nav-search-form" onSubmit={handleNavSearch} role="search">
          <div className="nav-search-box">
            <input
              ref={searchInputRef}
              type="text"
              className="nav-search-input"
              value={searchQ}
              onChange={(e) => {
                setSearchQ(e.target.value);
                if (e.target.value === '') {
                  setActiveSearch('');
                }
              }}
              placeholder={t('dash.searchPlaceholder') || 'Reference number, subject or citizen name...'}
              aria-label={t('common.search')}
            />
            {searchQ ? (
              <button
                type="button"
                className="nav-search-clear"
                onClick={handleClearSearch}
                title="Clear search"
                aria-label="Clear search"
              >
                <svg viewBox="0 0 14 14" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M3 3l8 8M11 3l-8 8" />
                </svg>
              </button>
            ) : (
              <kbd className="nav-search-kbd">Ctrl K</kbd>
            )}
          </div>
          <button type="submit" className="nav-search-btn" id="btn-nav-search">
            <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="5.5" />
              <path d="M12.5 12.5L17 17" />
            </svg>
            <span>{t('common.search')}</span>
          </button>
        </form>
      </nav>

      <main className="poc-main">
        {openId === null
          ? <OfficerDashboard feed={feed} live={live} onOpen={setOpenId} searchQ={activeSearch} onClearSearch={handleClearSearch} />
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
