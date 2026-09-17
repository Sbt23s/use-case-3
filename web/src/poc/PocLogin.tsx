import { useState } from 'react';
import { pocApi } from './pocApi';
import { AppFooter } from './AppFooter';
import { useI18n, LanguageToggle } from '../lib/i18n';

export function PocLogin({ onLogin }: { onLogin: (token: string, user?: any) => Promise<void> }) {
  const { t, lang } = useI18n();
  const [username, setUsername] = useState('gro');
  const [password, setPassword] = useState('Officer@123');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await pocApi.post<{ token: string; user?: any }>('/auth/login', { username, password });
      await onLogin(r.token, r.user);
    } catch (e: any) {
      if (e.status === 401 || e.message === 'Invalid username or password') {
        setErr(t('login.failed'));
      } else if (e.status >= 500 || e.message?.includes('500') || e.message?.includes('ECONNREFUSED')) {
        setErr(lang === 'ta' ? 'சேவையகத்தை இணைக்க முடியவில்லை. தயவுசெய்து சிறிது நேரம் கழித்து மீண்டும் முயற்சிக்கவும்.' : 'Unable to reach the server. Please try again in a moment.');
      } else {
        setErr(e.message ?? t('login.failed'));
      }
      setBusy(false);
    }
  };

  return (
    <div className="poc poc-login-page">
      <div className="poc-login">
        <div className="box">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <LanguageToggle />
          </div>
          <div className="brand">
            <div className="mark">⚖</div>
            <div>
              <h1>{t('app.title')}</h1>
              <div className="small muted">{t('app.subtitle')}</div>
            </div>
          </div>

          <div className="poc-note info" style={{ fontSize: 12 }}>
            {t('login.poc')}
          </div>

          {err && <div className="poc-note err">{err}</div>}

          <form onSubmit={submit}>
            <div className="fld">
              <label>{t('login.username')}</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </div>
            <div className="fld">
              <label>{t('login.password')}</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? <><span className="spin" /> {t('common.loading')}</> : t('login.submit')}
            </button>
          </form>

          {/* Quick-fill: officer only */}
          <div className="pick">
            <div className="small muted" style={{ marginTop: 6 }}>{t('login.demo')}</div>
            <button
              type="button"
              onClick={() => { setUsername('gro'); setPassword('Officer@123'); }}
            >
              <div className="r">{t('app.role')}</div>
              <div className="u">{lang === 'ta' ? 'ஏ. கவிதா' : 'A. Kavitha'} · gro / Officer@123</div>
            </button>
          </div>
        </div>
      </div>
      <AppFooter />
    </div>
  );
}
