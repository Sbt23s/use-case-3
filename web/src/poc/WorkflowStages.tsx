import { Fragment, useCallback, useEffect, useState } from 'react';
import { pocApi, fmtTime } from './pocApi';
import { useI18n } from '../lib/i18n';

/**
 * Where the petition has reached in the office procedure.
 *
 * This is the file's PHYSICAL progress - which desk it is on - and is distinct
 * from the AI's recommended next steps, which advise what to do about this
 * particular grievance. The two sit in separate cards on purpose: one is the
 * standing procedure every case follows, the other is specific to this matter.
 *
 * NOTHING ADVANCES BY ITSELF. A stage moves only when an officer records it,
 * and every movement is written to the server with who made it. A stage shown
 * as reached means an officer said so - the interface never infers progress,
 * because an officer reading a green tick must be able to trust it.
 *
 * Both the stage names and the controls follow the console's language, from
 * the server's own bilingual stage list rather than a second copy kept here.
 */

interface Stage { code: string; en: string; ta: string; optional?: boolean }

interface HistoryRow {
  id: number;
  from_stage: string | null;
  to_stage: string;
  note: string | null;
  created_at: string;
  changed_by: string | null;
}

interface WorkflowData {
  stages: Stage[];
  current: string;
  started: boolean;
  changed_at: string | null;
  history: HistoryRow[];
}

export function WorkflowStages({ petitionId, feed }: { petitionId: number; feed: any[] }) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<WorkflowData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    pocApi.get<WorkflowData>(`/cp/petitions/${petitionId}/workflow`)
      .then(setData)
      .catch((e) => setErr(e?.message ?? String(e)));
  }, [petitionId]);

  useEffect(() => { load(); }, [load]);

  /*
   * Another officer moving the same case is reflected here without a reload -
   * two people working one file must not see different positions.
   */
  useEffect(() => {
    const hit = feed.some((f) => f?.type === 'petition:update' && f?.data?.id === petitionId);
    if (hit) load();
  }, [feed.length, petitionId, load]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <div className="poc-note err">{err}</div>;
  if (!data) return null;

  const currentIndex = data.stages.findIndex((s) => s.code === data.current);
  const name = (s: Stage) => (lang === 'ta' ? s.ta : s.en);

  async function moveTo(code: string) {
    setBusy(true);
    setErr('');
    try {
      await pocApi.patch(`/cp/petitions/${petitionId}/workflow`, { stage: code });
      load();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="poc-card wfs-card">
      <header>
        <h3>{t('wfs.title')}</h3>
        <span className="poc-chip">
          {data.started ? `${currentIndex + 1} / ${data.stages.length}` : `0 / ${data.stages.length}`}
        </span>
      </header>

      <div className="body">
        <ol className="wfs-track">
          {data.stages.map((s, i) => {
            /*
             * Before the first movement is recorded NOTHING is complete: the
             * case is at the first desk, not past it.
             */
            const state = !data.started
              ? (i === 0 ? 'now' : 'next')
              : i < currentIndex ? 'done' : i === currentIndex ? 'now' : 'next';

            const arrowActive = data.started && i <= currentIndex;

            return (
              <Fragment key={s.code}>
                {i > 0 && (
                  <li className={`wfs-arrow-item ${arrowActive ? 'done' : ''}`} aria-hidden="true">
                    <svg
                      className="wfs-arrow-icon"
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="4" y1="12" x2="20" y2="12" />
                      <polyline points="13 5 20 12 13 19" />
                    </svg>
                  </li>
                )}
                <li
                  className={`wfs-step ${state}${s.optional ? ' optional' : ''}`}
                  aria-current={state === 'now' ? 'step' : undefined}
                  style={{ cursor: busy ? 'wait' : 'pointer' }}
                  onClick={() => !busy && moveTo(s.code)}
                  title={`${t('wfs.setStage')}: ${name(s)}`}
                >
                  <span className="wfs-dot" aria-hidden="true">
                    {state === 'done' ? '✓' : i + 1}
                  </span>
                  <span className="wfs-name">{name(s)}</span>
                  {s.optional && <span className="wfs-opt">{t('wfs.optional')}</span>}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
