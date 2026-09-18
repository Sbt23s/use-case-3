import { useCallback, useEffect, useRef, useState } from 'react';
import '../poc-styles.css';
import { PocLogin } from './PocLogin';
import { OfficerDashboard } from './OfficerDashboard';
import { PetitionDetail } from './PetitionDetail';
import { pocApi, setPocToken, getPocToken, clearPocToken, type PocUser } from './pocApi';
import { AppFooter } from './AppFooter';
import { CopilotPanel } from './CopilotPanel';
import { CopilotAgentView } from './CopilotAgentView';
import { AiSettingsDialog } from './AiSettingsDialog';
import { useI18n, LanguageToggle } from '../lib/i18n';
import { displayName } from '../lib/translit';
import { GovernmentLogoLoader } from './GovernmentLogoLoader';

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
  const [dashboardKey, setDashboardKey] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Always reset scroll to top on navigation/view transitions
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [copilot, openId, dashboardKey]);

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
        <main className="poc-main" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <GovernmentLogoLoader size="lg" label={t('common.loading')} />
        </main>
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
  }  return (
    <div className={`poc${copilot ? ' poc-has-copilot' : ''}`}>
      <div className="poc-top-bar">
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
              className={openId === null && !copilot ? 'on' : ''}
              onClick={() => {
                setCopilot(false);
                setOpenId(null);
                setDashboardKey((k) => k + 1);
              }}
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

          {/* Global Search Box in Grey Navbar - Shown ONLY on Dashboard */}
          {openId === null && !copilot && (
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
          )}
        </nav>
      </div>

      <main className={`poc-main${copilot ? ' poc-main-copilot' : ''}`}>
        {copilot ? (
          <CopilotAgentView
            feed={feed}
            petitionId={openId}
            onClose={() => setCopilot(false)}
          />
        ) : openId === null ? (
          <OfficerDashboard
            key={dashboardKey}
            feed={feed}
            live={live}
            onOpen={setOpenId}
            searchQ={activeSearch}
            onClearSearch={handleClearSearch}
          />
        ) : (
          <PetitionDetail petitionId={openId} feed={feed} onBack={() => setOpenId(null)} />
        )}
      </main>

      {!copilot && <AppFooter />}

      {aiSettings && <AiSettingsDialog onClose={() => setAiSettings(false)} />}
    </div>
  );
}
