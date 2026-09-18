import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pocApi, fmtTime, pct, STATUS_LABEL } from './pocApi';
import { useI18n } from '../lib/i18n';
import { displayName } from '../lib/translit';
import { GovernmentLogoLoader } from './GovernmentLogoLoader';

/**
 * Government Grievance Officer dashboard.
 *
 * Officers can now:
 *   1. View all incoming petitions with real-time AI analysis status.
 *   2. Upload a petition on behalf of a citizen — the system OCRs the
 *      document and runs AI analysis automatically, no extra clicks.
 */
export function OfficerDashboard({ feed, live, onOpen, searchQ = '', onClearSearch }: {
  feed: any[]; live: boolean; onOpen: (id: number) => void;
  searchQ?: string;
  onClearSearch?: () => void;
}) {
  const { t, lang } = useI18n();

  /** A knowledge-base name in the selected language, English as fallback. */
  const kb = (en: unknown, ta: unknown): string =>
    String((lang === 'ta' ? ta || en : en) ?? '').trim();

  const [rows, setRows] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [q, setQ] = useState(searchQ);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [totalCount, setTotalCount] = useState(0);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [showUpload]);

  const reqIdRef = useRef(0);

  const load = useCallback(async (search = q, targetPage = page, targetPageSize = pageSize) => {
    const curReq = ++reqIdRef.current;
    setBusy(true);
    try {
      const [list, s] = await Promise.all([
        pocApi.get<{ rows: any[]; total: number }>(
          `/cp/petitions?lang=${lang}&page=${targetPage}&limit=${targetPageSize}${search ? `&q=${encodeURIComponent(search)}` : ''}`,
        ),
        pocApi.get<any>('/cp/stats'),
      ]);
      if (curReq === reqIdRef.current) {
        setRows(list.rows);
        setTotalCount(list.total ?? list.rows.length);
        setStats(s);
        setErr('');
      }
    } catch (e: any) {
      if (curReq === reqIdRef.current) {
        setErr(e.message);
      }
    } finally {
      if (curReq === reqIdRef.current) {
        setBusy(false);
      }
    }
  }, [lang, q, page, pageSize]);

  // Sync with real-time search from navbar
  useEffect(() => {
    setQ(searchQ);
    setPage(1);
    load(searchQ, 1, pageSize);
  }, [searchQ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refetches when language, page, or pageSize changes
  useEffect(() => {
    load(q, page, pageSize);
  }, [lang, page, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time event: refresh list with a 400ms debounce to prevent burst requests
  useEffect(() => {
    if (!feed.length) return;
    const latest = feed[0];
    if (latest?.data?.id) {
      setFresh((s) => new Set(s).add(latest.data.id));
      setTimeout(() => {
        setFresh((s) => { const n = new Set(s); n.delete(latest.data.id); return n; });
      }, 3000);
    }
    const timer = setTimeout(() => {
      load(q || undefined, page, pageSize);
    }, 400);
    return () => clearTimeout(timer);
  }, [feed.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalRows = totalCount || rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const visibleRows = rows;

  const getPageNumbers = () => {
    const pages: number[] = [];
    const maxButtons = 5;
    if (totalPages <= maxButtons) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else if (page <= 3) {
      for (let i = 1; i <= Math.min(5, totalPages); i++) pages.push(i);
    } else if (page >= totalPages - 2) {
      for (let i = Math.max(1, totalPages - 4); i <= totalPages; i++) pages.push(i);
    } else {
      for (let i = page - 2; i <= page + 2; i++) pages.push(i);
    }
    return pages;
  };

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

      {/* Petitions table */}
      <div className="poc-card">
        <header>
          <h3>
            {q ? (
              <>
                {lang === 'ta' ? 'தேடல் முடிவுகள்' : 'Search Results'} ({totalRows})
                <span style={{ fontSize: 13, fontWeight: 400, color: '#64748b', marginLeft: 8 }}>
                  for "{q}"
                </span>
              </>
            ) : (
              <>{t('dash.petitions')} ({totalRows})</>
            )}
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {q && onClearSearch && (
              <button
                type="button"
                className="btn sm"
                style={{ fontSize: 12, padding: '4px 10px', background: '#f1f5f9', border: '1px solid #cbd5e1', color: '#475569' }}
                onClick={onClearSearch}
              >
                {lang === 'ta' ? 'தேடலை அழி' : 'Clear search'}
              </button>
            )}
            {feed.length > 0 && (
              <span className="poc-chip">{feed.length} {feed.length === 1 ? t('dash.liveEvent') : t('dash.liveEvents')}</span>
            )}
          </div>
        </header>
        <div className="body flush">
          {busy && rows.length > 0 && (
            <div className="table-loading-bar" />
          )}
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '16%' }}>{t('col.reference')}</th>
                  <th style={{ width: '18%' }}>{t('col.citizen')}</th>
                  <th style={{ width: '28%' }}>{t('col.subject')}</th>
                  <th style={{ width: '13%' }}>{t('col.status')}</th>
                  <th style={{ width: '17%' }}>{t('col.suggestion')}</th>
                  <th style={{ width: '8%', textAlign: 'right' }}>{t('col.received')}</th>
                </tr>
              </thead>
              <tbody>
                {busy && rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '40px 20px' }}>
                      <GovernmentLogoLoader
                        size="md"
                        label={lang === 'ta' ? 'மனுக்கள் தேடப்படுகின்றன...' : 'Searching petitions...'}
                      />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '52px 20px' }}>
                      {q ? (
                        <div className="table-search-empty">
                          <div className="search-empty-icon">
                            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="11" cy="11" r="8" />
                              <path d="M21 21l-4.35-4.35" />
                              <path d="M8 11h6" />
                            </svg>
                          </div>
                          <div className="search-empty-title">
                            {lang === 'ta' ? `"${q}"-க்கு எந்த மனுக்களும் கிடைக்கவில்லை` : `No petitions found matching "${q}"`}
                          </div>
                          <div className="search-empty-desc">
                            {lang === 'ta'
                              ? 'மனு எண் (எ.கா. 1266), குடிமக்கள் பெயர் அல்லது தலைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.'
                              : 'Verify the reference number (e.g. 1266), citizen name, or try searching with different keywords.'}
                          </div>
                          {onClearSearch && (
                            <button
                              type="button"
                              className="search-clear-btn"
                              onClick={onClearSearch}
                            >
                              {lang === 'ta' ? 'தேடலை அழிக்கவும்' : 'Clear search'}
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="empty" style={{ margin: 0, padding: '24px 0' }}>
                          {t('dash.noPetitions')}{' '}
                          <button className="btn sm primary" onClick={() => setShowUpload(true)}>
                            {t('dash.uploadFirst')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((p) => (
                    <tr
                      key={p.id}
                      className={`tap${fresh.has(p.id) ? ' fresh' : ''}`}
                      onClick={() => onOpen(p.id)}
                    >
                      <td className="mono nw">
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>{p.reference_no}</div>
                        {fresh.has(p.id) && <span className="poc-chip ok" style={{ marginTop: 2, fontSize: 10 }}>{t('dash.newChip')}</span>}
                        {p.uploaded_by_officer === 1 && (
                          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{t('dash.officerUpload')}</div>
                        )}
                      </td>
                      <td>
                        <div className="b" style={{ fontSize: 14, color: '#0f172a' }}>{displayName(p.citizen_name_display ?? p.citizen_name, lang)}</div>
                        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{p.citizen_phone ?? '—'}</div>
                      </td>
                      <td style={{ maxWidth: 320, color: '#334155', fontSize: 13.5, lineHeight: 1.45 }}>
                        {p.subject_display ?? p.subject}
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
                        {p.officer_verified === 1 && <span className="poc-chip ok" style={{ marginLeft: 4 }}>{t('dash.verifiedChip')}</span>}
                      </td>
                      <td className="small">
                        {p.analysis_status === 'COMPLETED' ? (
                          <>
                            <div className="b" style={{ color: '#0f172a', fontSize: 13 }}>{kb(p.suggested_department, p.suggested_department_ta)}</div>
                            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                              {kb(p.suggested_act, p.suggested_act_ta) || t('dash.noActMatched')}
                            </div>

                          </>
                        ) : p.analysis_status === 'PROCESSING' ? (
                          <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <GovernmentLogoLoader size="xs" inline /> {t('dash.analysingText')}
                          </span>
                        ) : p.analysis_status === 'FAILED' ? (
                          <span className="poc-chip err">{t('dash.analysisFailed')}</span>
                        ) : (
                          <span className="muted">{t('dash.pending')}</span>
                        )}
                      </td>
                      <td className="small muted nw" style={{ textAlign: 'right' }}>{fmtTime(p.created_at, lang)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Reference-style clean pagination */}
          <div className="table-pagination">
            <div className="pagination-left">
              <span className="pagination-label">
                {lang === 'ta' ? 'வரிசைகள் / பக்கம்' : 'Rows per page'}
              </span>
              <div className="pagination-select-box">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    const newSize = Number(e.target.value);
                    setPageSize(newSize);
                    setPage(1);
                  }}
                  className="pagination-select"
                  aria-label="Rows per page"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <svg className="pagination-select-arrow" viewBox="0 0 10 6" width="9" height="5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M1 1l4 4 4-4" />
                </svg>
              </div>
            </div>

            <div className="pagination-right">
              <span className="pagination-range">
                {totalRows === 0
                  ? '0 - 0 of 0'
                  : `${((page - 1) * pageSize) + 1} - ${Math.min(page * pageSize, totalRows)} of ${totalRows}`}
              </span>

              <div className="pagination-pages">
                <button
                  type="button"
                  className="pagination-arrow-btn"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                  title="Previous page"
                >
                  <svg viewBox="0 0 6 10" width="6" height="10" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 1L1 5l4 4" />
                  </svg>
                </button>

                {getPageNumbers().map((pNum) => (
                  <button
                    key={pNum}
                    type="button"
                    className={`pagination-num-btn${page === pNum ? ' active' : ''}`}
                    onClick={() => setPage(pNum)}
                    aria-current={page === pNum ? 'page' : undefined}
                  >
                    {pNum}
                  </button>
                ))}

                <button
                  type="button"
                  className="pagination-arrow-btn"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                  title="Next page"
                >
                  <svg viewBox="0 0 6 10" width="6" height="10" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 1l4 4-4 4" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
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
            <GovernmentLogoLoader size="md" />
            <p className="b" style={{ fontSize: 16, marginTop: 8 }}>{PHASES[phase] ?? t('dash.processing')}</p>
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
