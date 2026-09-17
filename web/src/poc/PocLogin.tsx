import { useState } from 'react';
import { pocApi } from './pocApi';
import { AppFooter } from './AppFooter';
import { useI18n } from '../lib/i18n';

export function PocLogin({ onLogin }: { onLogin: (token: string) => Promise<void> }) {
  const { t } = useI18n();
  const [username, setUsername] = useState('gro');
  const [password, setPassword] = useState('Officer@123');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await pocApi.post<{ token: string }>('/auth/login', { username, password });
      await onLogin(r.token);
    } catch (e: any) {
      setErr(e.message ?? t('login.failed'));
      setBusy(false);
    }
  };

  return (
    <div className="poc">
      <div className="poc-login">
        <div className="box">
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
              <div className="u">A. Kavitha · gro / Officer@123</div>
            </button>
          </div>
        </div>
      </div>
      <AppFooter />
    </div>
  );
}
