import { useEffect, useState } from 'react';
import { pocApi } from './pocApi';
import { useI18n } from '../lib/i18n';

/**
 * AI model settings.
 *
 * Chooses which vendor answers, and proves it actually works before an officer
 * relies on it.
 *
 * NO CREDENTIAL PASSES THROUGH THIS COMPONENT. There is no key field, because
 * there is nothing to type: keys live in the server's environment and the
 * browser is only ever told `configured: true/false`. That is deliberate - a
 * key entered here would end up in component state, in a network request body,
 * and very likely in localStorage, which is exactly the exposure this design
 * removes. An unconfigured vendor is therefore shown as unavailable with the
 * name of the environment variable an administrator must set on the server.
 *
 * TESTING IS A REAL REQUEST. "Has a key" and "works" are different questions: a
 * revoked key, an exhausted quota and a stopped Ollama daemon all look
 * configured. The test button sends an actual prompt and reports what came
 * back, so the answer is true rather than inferred.
 */

interface Provider {
  id: 'gemini' | 'openai' | 'grok' | 'groq' | 'nvidia' | 'ollama';
  label: string;
  configured: boolean;
  model: string;
  /** Server-side English prose. Not rendered - see `noteFor`. */
  note?: string;
  /** The environment variable an administrator must set, when unconfigured. */
  envVar?: string;
}

interface Status {
  provider: string;
  model: string;
  live: boolean;
  selected: string | null;
  note?: string;
}

type TestState =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; latencyMs?: number; model: string }
  | { state: 'fail'; error: string };

export function AiSettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [translation, setTranslation] = useState<{ configured: boolean; url: string | null; auth: string; note?: string } | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    pocApi.get<{ providers: Provider[]; current: Status; translation?: any }>('/cp/ai-providers')
      .then((r) => {
        if (!alive) return;
        setProviders(r.providers);
        setStatus(r.current);
        setTranslation(r.translation ?? null);
        const sel = r.current.selected ?? r.providers.find((p) => p.configured)?.id ?? null;
        setChosen(sel);
        setModel(r.providers.find((p) => p.id === sel)?.model ?? '');
      })
      .catch((e) => alive && setErr(e?.message ?? String(e)));
    return () => { alive = false; };
  }, []);

  // Escape closes, like every other dismissible layer in the console.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function pick(p: Provider) {
    setChosen(p.id);
    setModel(p.model);
    setSaved(false);
  }

  async function test(id: string) {
    setTests((s) => ({ ...s, [id]: { state: 'testing' } }));
    try {
      const r = await pocApi.post<{
        ok: boolean; model: string; latencyMs?: number; error?: string;
      }>('/cp/ai-providers/test', { id, model: id === chosen && model ? model : undefined });

      setTests((s) => ({
        ...s,
        [id]: r.ok
          ? { state: 'ok', latencyMs: r.latencyMs, model: r.model }
          : { state: 'fail', error: r.error ?? t('aim.testFailed') },
      }));
    } catch (e: any) {
      // A network failure is itself a test result, not a crash.
      setTests((s) => ({ ...s, [id]: { state: 'fail', error: e?.message ?? String(e) } }));
    }
  }

  async function save() {
    if (!chosen) return;
    setBusy(true);
    setErr(null);
    try {
      const next = await pocApi.post<Status>('/cp/ai-providers/select', {
        id: chosen,
        model: model.trim() || undefined,
      });
      setStatus(next);
      setSaved(true);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="copilot-scrim" onClick={onClose} />
      <div className="ai-dialog" role="dialog" aria-modal="true" aria-label={t('aim.title')}>
        <div className="ai-dialog-head">
          <div className="grow">
            <div className="ttl">{t('aim.title')}</div>
            <div className="sub">{t('aim.subtitle')}</div>
          </div>
          <button className="icon" onClick={onClose} title={t('common.close')}>✕</button>
        </div>

        <div className="ai-dialog-body">
          {status && (
            <div className="ai-current">
              <span className={`dot${status.live ? ' on' : ''}`} />
              {t('aim.inUse')}: <b>{status.provider}</b>
              <span className="mdl">{status.model}</span>
            </div>
          )}

          {providers.map((p) => {
            const tr = tests[p.id] ?? { state: 'idle' as const };
            const active = chosen === p.id;
            return (
              <div
                key={p.id}
                className={`ai-prov${active ? ' on' : ''}${p.configured ? '' : ' off'}`}
                onClick={() => p.configured && pick(p)}
              >
                <div className="row">
                  <span className="radio">{active ? '◉' : '○'}</span>
                  <b className="grow">{p.label}</b>
                  {p.configured
                    ? (
                      <button
                        className="test"
                        disabled={tr.state === 'testing'}
                        onClick={(e) => { e.stopPropagation(); test(p.id); }}
                      >
                        {tr.state === 'testing' ? t('aim.testing') : t('aim.test')}
                      </button>
                    )
                    : <span className="tag">{t('aim.notConfigured')}</span>}
                </div>

                {/*
                  * The model box belongs to the selected vendor only: a model
                  * name is meaningless against a different provider, and one
                  * box per row invited pasting a Gemini model into OpenAI.
                  */}
                {active && p.configured && (
                  <input
                    className="mdl-input"
                    value={model}
                    placeholder={p.model}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => { setModel(e.target.value); setSaved(false); }}
                    aria-label={t('aim.model')}
                  />
                )}

                {/*
                  * Rendered from the phrase book, NOT from the server's note.
                  *
                  * The server writes its notes in English. Showing them here
                  * would put English prose inside a Tamil console - the exact
                  * mixing this console must not do - so the server supplies the
                  * FACTS (which variable, which vendor) and the phrase book
                  * supplies the sentence.
                  */}
                {!p.configured && (
                  <div className="note">
                    {t('aim.setEnv').replace('{var}', p.envVar ?? '')}
                  </div>
                )}
                {p.configured && p.id === 'ollama' && (
                  <div className="note">{t('aim.ollamaNote')}</div>
                )}

                {tr.state === 'ok' && (
                  <div className="note ok">
                    ✓ {t('aim.testOk')} — {tr.model}
                    {tr.latencyMs != null ? ` · ${(tr.latencyMs / 1000).toFixed(1)}s` : ''}
                  </div>
                )}
                {tr.state === 'fail' && <div className="note bad">✕ {tr.error}</div>}
              </div>
            );
          })}

          {translation && (
            <div className={`ai-prov on${translation.configured ? '' : ' off'}`} style={{ marginTop: 12 }}>
              <div className="row">
                <span className={`dot${translation.configured ? ' on' : ''}`} />
                <b className="grow">{t('aim.translationService')}</b>
                {translation.configured ? (
                  <span className="poc-chip ok">{translation.url ?? t('aim.testOk')}</span>
                ) : (
                  <span className="tag">{t('aim.notConfigured')}</span>
                )}
              </div>
              <div className="note" style={{ marginTop: 4 }}>
                {translation.configured ? t('aim.translateApiActive') : t('aim.translateApiFallback')}
              </div>
            </div>
          )}

          <p className="ai-keys-note">{t('aim.keysNote')}</p>
          {err && <div className="note bad">{err}</div>}
        </div>

        <div className="ai-dialog-foot">
          {saved && <span className="ok-msg">✓ {t('aim.saved')}</span>}
          <div className="grow" />
          <button onClick={onClose}>{t('common.close')}</button>
          <button className="primary" disabled={!chosen || busy} onClick={save}>
            {busy ? t('aim.saving') : t('aim.use')}
          </button>
        </div>
      </div>
    </>
  );
}
