import { useCallback, useEffect, useRef, useState } from 'react';
import { pocApi, fmtTime, pct, STATUS_LABEL } from './pocApi';
import { useI18n } from '../lib/i18n';

/**
 * Government Grievance Officer dashboard.
 *
 * Officers can now:
 *   1. View all incoming petitions with real-time AI analysis status.
 *   2. Upload a petition on behalf of a citizen — the system OCRs the
 *      document and runs AI analysis automatically, no extra clicks.
 */
export function OfficerDashboard({ feed, live, onOpen }: {
  feed: any[]; live: boolean; onOpen: (id: number) => void;
}) {
  const { t, lang } = useI18n();

  /** A knowledge-base name in the selected language, English as fallback. */
  const kb = (en: unknown, ta: unknown): string =>
    String((lang === 'ta' ? ta || en : en) ?? '').trim();

  const [rows, setRows] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [showUpload, setShowUpload] = useState(false);

  const load = useCallback(async (search?: string) => {
    try {
      const [list, s] = await Promise.all([
        // `lang` asks the server to render the citizen's subject in the
        // selected language; the original is untouched in the database.
        pocApi.get<{ rows: any[]; total: number }>(
          `/cp/petitions?lang=${lang}${search ? `&q=${encodeURIComponent(search)}` : ''}`,
        ),
        pocApi.get<any>('/cp/stats'),
      ]);
      setRows(list.rows); setStats(s); setErr('');
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
    // `lang` is a dependency: switching language refetches the list so the
    // subjects come back rendered in the newly selected language.
  }, [lang]);

  // Refetches on a language change, because `load` depends on `lang`.
  useEffect(() => { load(); }, [load]);

  // Real-time event: refresh list, highlight new row briefly.
  useEffect(() => {
    if (!feed.length) return;
    const latest = feed[0];
    if (latest?.data?.id) {
      setFresh((s) => new Set(s).add(latest.data.id));
      setTimeout(() => {
        setFresh((s) => { const n = new Set(s); n.delete(latest.data.id); return n; });
      }, 3000);
    }
    load(q || undefined);
  }, [feed.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (showUpload) {
    return (
      <UploadPetitionForm
        onDone={(id) => { setShowUpload(false); onOpen(id); }}
        onCancel={() => setShowUpload(false)}
      />
    );
  }

  return (
    <>
      <div className="poc-head">
        <div className="grow">
          <h1>{t('dash.title')}</h1>
          <div className="lede">{t('dash.lede')}</div>
        </div>
        {/* Primary action: upload a petition on behalf of a citizen */}
        <button
          id="btn-upload-petition"
          className="btn primary"
          style={{ fontSize: 14, padding: '8px 18px' }}
          onClick={() => setShowUpload(true)}
        >
          {t('dash.upload')}
        </button>
      </div>

      {err && <div className="poc-note err">{err}</div>}

      {stats && (
        <div className="poc-grid c4 mb">
          <Stat n={stats.total} k={t('dash.total')} />
          <Stat n={stats.awaiting_analysis} k={t('dash.awaiting')} />
          <Stat n={stats.analysed} k={t('dash.analysed')} />
          <Stat n={stats.verified} k={t('dash.verified')} />
        </div>
      )}

      {/* Search */}
      <div className="poc-card">
        <div className="body">
          <div className="cols">
            <div className="fld" style={{ marginBottom: 0 }}>
              <label>{t('common.search')}</label>
              <input
                value={q}
                placeholder={t('dash.searchPlaceholder')}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') load(q || undefined); }}
              />
            </div>
            <div style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
              <button className="btn primary" onClick={() => load(q || undefined)}>{t('common.search')}</button>
            </div>
          </div>
        </div>
      </div>

      {/* Petitions table */}
      <div className="poc-card">
        <header>
          <h3>{t('dash.petitions')} ({rows.length})</h3>
          {feed.length > 0 && (
            <span className="poc-chip ok">{feed.length} {feed.length === 1 ? t('dash.liveEvent') : t('dash.liveEvents')}</span>
          )}
        </header>
        <div className="body flush">
          {busy ? (
            <div className="empty"><span className="spin" /></div>
          ) : rows.length === 0 ? (
            <div className="empty">
              {t('dash.noPetitions')}{' '}
              <button className="btn sm primary" onClick={() => setShowUpload(true)}>
                {t('dash.uploadFirst')}
              </button>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t('col.reference')}</th><th>{t('col.citizen')}</th><th>{t('col.subject')}</th>
                  <th>{t('col.status')}</th><th>{t('col.suggestion')}</th><th>{t('col.docs')}</th><th>{t('col.received')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr
                    key={p.id}
                    className={`tap${fresh.has(p.id) ? ' fresh' : ''}`}
                    onClick={() => onOpen(p.id)}
                  >
                    <td className="mono nw">
                      {p.reference_no}
                      {fresh.has(p.id) && <> <span className="poc-chip ok">NEW</span></>}
                      {p.uploaded_by_officer === 1 && (
                        <div className="small muted" style={{ fontSize: 10 }}>{t('dash.officerUpload')}</div>
                      )}
                    </td>
                    <td>
                      <div className="b">{p.citizen_name}</div>
                      <div className="small muted">{p.citizen_phone ?? '—'}</div>
                    </td>
                    <td style={{ maxWidth: 300 }}>
                      {p.subject_display ?? p.subject}
                      {p.subject_translated && (
                        // Marked, because these are not the petitioner's own words.
                        <span className="poc-chip" style={{ marginLeft: 6, fontSize: 9.5 }}>
                          {t('dash.translated')}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`poc-chip ${
                        p.status === 'CLOSED' ? 'ok'
                          : p.status === 'ANALYSING' ? 'warn'
                          : p.analysis_status === 'COMPLETED' ? 'ok'
                          : ''
                      }`}>
                        {t('status.' + p.status)}
                      </span>
                      {p.officer_verified === 1 && <> <span className="poc-chip ok">{t('dash.verifiedChip')}</span></>}
                    </td>
                    <td className="small">
                      {p.analysis_status === 'COMPLETED' ? (
                        <>
                          {/*
                            * Prefer the Tamil name when Tamil is selected, falling
                            * back to English where the record has no Tamil name -
                            * an officer must always see WHICH department is meant.
                            */}
                          <div className="b">{kb(p.suggested_department, p.suggested_department_ta)}</div>
                          <div className="muted">
                            {kb(p.suggested_act, p.suggested_act_ta) || t('dash.noActMatched')}
                          </div>
                          {p.confidence != null && (
                            <div className={`poc-meter${p.confidence < 0.6 ? ' low' : ''}`}>
                              <i style={{ width: `${Math.round(p.confidence * 100)}%` }} />
                            </div>
                          )}
                          <div className="muted" style={{ fontSize: 11 }}>{pct(p.confidence)} {t('doc.confidence')}</div>
                        </>
                      ) : p.analysis_status === 'PROCESSING' ? (
                        <span className="muted"><span className="spin" /> analysing…</span>
                      ) : p.analysis_status === 'FAILED' ? (
                        <span className="poc-chip err">{t('dash.analysisFailed')}</span>
                      ) : (
                        <span className="muted">{t('dash.pending')}</span>
                      )}
                    </td>
                    <td className="mono">{p.document_count}</td>
                    <td className="small muted nw">{fmtTime(p.created_at, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Live activity feed */}
      {feed.length > 0 && (
        <div className="poc-card">
          <header><h3>{t('dash.liveActivity')}</h3></header>
          <div className="body flush">
            <ul className="list" style={{ padding: '0 15px' }}>
              {feed.slice(0, 8).map((f, i) => (
                <li key={i}>
                  <span className="poc-chip">{f.kind.replace(':', ' ')}</span>{' '}
                  {f.kind === 'petition:new' && `${t('feed.newPetition')} ${f.data.reference_no}`}
                  {f.kind === 'petition:update' && (
                    f.data.analysis_status === 'PROCESSING'
                      ? `#${f.data.id} — ${t('feed.petitionAnalysing')}`
                      : f.data.analysis_status === 'COMPLETED'
                        ? `#${f.data.id} — ${t('feed.petitionAnalysed')}`
                        : `#${f.data.id} — ${t('feed.petitionUpdated')}`
                  )}
                  {/* The engine is a server concern; the officer sees the outcome. */}
                  {f.kind === 'document:ocr' && `${t('feed.documentRead')} — ${t('status.' + f.data.status)}`}
                  <span className="small muted"> · {f.at.toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

// ================================================================
// Upload Petition Form
// ================================================================
/**
 * Officer uploads a physical petition on behalf of a citizen.
 *
 * Single-step form → single API call → AI analysis runs automatically.
 * The officer watches the row appear in the table and turn to "Analysed"
 * without any further action.
 */
function UploadPetitionForm({
  onDone, onCancel,
}: {
  onDone: (id: number) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [phase, setPhase] = useState<'' | 'uploading' | 'ocr' | 'analysing' | 'done'>('');
  const [created, setCreated] = useState<{ id: number; ref: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setErr(t('dash.pickFile')); return; }
    setErr(''); setBusy(true); setPhase('uploading');

    try {
      const fd = new FormData();
      fd.append('citizen_name', 'Citizen');
      fd.append('subject', file.name || 'Uploaded Petition');
      fd.append('description', 'Document uploaded by officer for AI analysis.');
      fd.append('language', 'en');
      fd.append('file', file);
      fd.append('doc_title', file.name);

      const r = await pocApi.upload<{ petitionId: number; referenceNo: string }>(
        '/cp/petitions/officer-upload', fd,
      );
      setCreated({ id: r.petitionId, ref: r.referenceNo });
      setPhase('ocr');

      // The server runs OCR + AI analysis in the background.
      // Poll petition status until analysis completes (max ~120 s).
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const detail = await pocApi.get<any>(`/cp/petitions/${r.petitionId}`);
          const status = detail.petition.analysis_status;
          if (status === 'PROCESSING') {
            setPhase('analysing');
          } else if (status === 'COMPLETED' || status === 'FAILED') {
            /*
             * Open the petition as soon as the analysis lands.
             *
             * FAILED opens it too: the officer still needs to see the document
             * and the reason it could not be read, and stranding them on a
             * progress screen would hide both.
             */
            clearInterval(poll);
            setBusy(false);
            onDone(r.petitionId);
          } else if (attempts > 60) {
            // Two minutes is long enough; open the petition and let the page
            // continue following the work on its own live updates.
            clearInterval(poll);
            setBusy(false);
            onDone(r.petitionId);
          }
        } catch { /* ignore transient errors */ }
      }, 2000);
    } catch (e: any) {
      setErr(e.message ?? t('dash.uploadFailed'));
      setBusy(false);
      setPhase('');
    }
  };

  /*
   * There is no success screen.
   *
   * A confirmation saying "uploaded and analysed" with an "Open petition"
   * button made the officer acknowledge something they had just watched
   * happen, then click again to reach the analysis they were waiting for. The
   * upload now opens the analysis itself (see the effect above), so the flow
   * is: upload -> progress -> the petition, with nothing in between.
   */

  // ---- In-progress screen ----
  if (busy && phase) {
    const PHASES: Record<string, string> = {
      uploading: t('dash.phaseUploading'),
      // The engine is a server concern; the officer is told what is happening.
      ocr: t('dash.phaseOcr'),
      analysing: t('dash.phaseAnalysing'),
    };
    return (
      <>
        <div className="poc-head">
          <div className="grow">
            <h1>{t('dash.processing')}</h1>
            <div className="lede">{t('dash.pleaseWait')}</div>
          </div>
        </div>
        <div className="poc-card">
          <div className="body" style={{ padding: 32, textAlign: 'center' }}>
            <span className="spin" style={{ width: 32, height: 32, marginBottom: 16 }} />
            <p className="b" style={{ fontSize: 16 }}>{PHASES[phase] ?? t('dash.processing')}</p>
            {created && (
              <p className="small muted">
                {t('dash.reference')}: <span className="mono">{created.ref}</span>
              </p>
            )}
            {/*
              * A plain progress bar rather than labelled stage chips.
              *
              * The chips named internal steps ("OCR", "AI Analysis") in English
              * regardless of the selected language, and told the officer nothing
              * they could act on. The bar shows how far along the work is; the
              * line above already says what is happening, in their language.
              */}
            <div className="upload-progress" aria-hidden="true">
              <span style={{ width: phase === 'uploading' ? '25%' : phase === 'ocr' ? '60%' : '90%' }} />
            </div>
          </div>
        </div>
      </>
    );
  }

  // ---- Upload form ----
  return (
    <>
      <div className="poc-head">
        <div className="grow">
          <h1>{t('dash.uploadTitle')}</h1>
          <div className="lede">{t('dash.uploadLede')}</div>
        </div>
      </div>

      {err && <div className="poc-note err">{err}</div>}

      <div className="poc-note info" style={{ marginBottom: 0 }}>
        {t('dash.formHint')}
      </div>

      <form onSubmit={submit}>
        <div 
          className="poc-card" 
          style={{ 
            marginTop: 24, 
            padding: 40, 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center',
            border: '2px dashed var(--line, #cbd5e1)',
            background: 'var(--bg, #f8fafc)',
            cursor: 'pointer',
            transition: 'border-color 0.2s',
          }}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => {
            e.preventDefault(); e.stopPropagation();
            const f = e.dataTransfer.files?.[0] ?? null;
            if (f) setFile(f);
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 16 }}>📄</div>
          <h3 style={{ marginBottom: 8 }}>{t('dash.selectDoc')}</h3>
          <p className="small muted" style={{ textAlign: 'center', maxWidth: 450, marginBottom: 24 }}>
            {t('dash.uploadHint')}
          </p>
          
          <input
            id="field-file"
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.txt"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
            }}
          />
          
          <button 
            type="button" 
            className="btn"
            onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
          >
            {t('dash.chooseFile')}
          </button>

          {file && (
            <div className="poc-note ok" style={{ marginTop: 24, marginBottom: 0, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 18 }}>✓</span>
              <div>
                <b>{file.name}</b> <span className="muted">({(file.size / 1024).toFixed(0)} KB)</span>
              </div>
            </div>
          )}
        </div>

        <div className="row" style={{ gap: 12, marginTop: 32, justifyContent: 'center' }}>
          <button
            id="btn-submit-upload"
            className="btn primary"
            type="submit"
            disabled={busy || !file}
            style={{ fontSize: 16, padding: '12px 32px' }}
          >
            {t('dash.uploadAnalyse')}
          </button>
          <button className="btn" type="button" onClick={onCancel} style={{ fontSize: 16, padding: '12px 32px' }}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </>
  );
}

function Stat({ n, k }: { n: number | string; k: string }) {
  return (
    <div className="poc-stat">
      <div className="n">{n}</div>
      <div className="k">{k}</div>
    </div>
  );
}
