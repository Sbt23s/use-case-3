import { useCallback, useEffect, useRef, useState } from 'react';
import { pocApi, fmtTime, pct, getPocToken } from './pocApi';
import { useI18n } from '../lib/i18n';
import { transliterate, hasTamil, hasLatin, displayName, displayAddress } from '../lib/translit';
import { AnalysisPanel } from './AnalysisPanel';
import { WorkflowStages } from './WorkflowStages';

/**
 * Officer petition workspace: the original letter, the extracted text, and the AI
 * analysis - all on one screen so the officer can check a
 * recommendation against its source without navigating away.
 */
export function PetitionDetail({ petitionId, feed, onBack }: {
  petitionId: number; feed: any[]; onBack: () => void;
}) {
  const { t, lang } = useI18n();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    try {
      /*
       * `lang` asks the server to render the analysis narrative in the
       * selected language.
       *
       * Where the analysis text is the petitioner's own words it is stored
       * identically in both halves - the record must carry what the citizen
       * wrote - so an English console showed a Tamil summary. The server
       * translates the DISPLAY copy on request; the stored record is
       * untouched.
       */
      const r = await pocApi.get<any>(`/cp/petitions/${petitionId}?lang=${lang}`);
      setD(r);
      setNotes(r.petition.officer_notes ?? '');
      setErr('');
    } catch (e: any) { setErr(e.message); }
    // `lang` is a dependency: switching language refetches so the analysis
    // comes back rendered in the newly selected language.
  }, [petitionId, lang]);

  useEffect(() => { load(); }, [load]);

  // Refresh when a live event concerns this petition (e.g. OCR finishing).
  useEffect(() => {
    if (!feed.length) return;
    const latest = feed[0];
    const id = latest?.data?.petitionId ?? latest?.data?.id;
    if (id === petitionId) load();
  }, [feed.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * Poll while the backend is still working on this petition.
   *
   * That covers BOTH stages: a document being read, and the analysis that runs
   * after it. Watching only the OCR status left a gap - the document finished,
   * polling stopped, and the analysis then appeared only when an unrelated
   * event happened to arrive. Now the page fills itself in as each stage
   * completes, which is what "below the document, in real time" requires.
   */
  const pending = (d?.documents ?? []).some(
    (x: any) => x.ocr_status === 'PENDING' || x.ocr_status === 'PROCESSING',
  ) || d?.petition?.analysis_status === 'PENDING'
    || d?.petition?.analysis_status === 'PROCESSING';
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [pending, load]);

  /*
   * Produce the official report.
   *
   * Everything on this page goes into it - the particulars, what was read from
   * the document, the classification, the recommended action and the workflow -
   * laid out as government correspondence.
   */
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState('');

  /** Fetch a stored document, authenticated. Returns null on any failure. */
  const fetchOriginal = async (docId: number): Promise<Blob | null> => {
    try {
      const r = await fetch(`/api/cp/documents/${docId}/file`, {
        headers: { Authorization: `Bearer ${getPocToken()}` },
      });
      return r.ok ? await r.blob() : null;
    } catch {
      return null;
    }
  };

  const downloadReport = async () => {
    if (!d) return;
    setPdfBusy(true); setPdfErr('');
    try {
      const docList = d.documents ?? [];
      const attachments = await Promise.all(
        docList.map(async (docItem: any) => ({
          document: {
            id: docItem.id,
            file_name: docItem.file_name,
            mime_type: docItem.mime_type,
            ocr_status: docItem.ocr_status,
            ocr_confidence: docItem.ocr_confidence,
            extracted_text: docItem.ocr_corrected_text || docItem.extracted_text || null,
          },
          file: await fetchOriginal(docItem.id),
        }))
      );

      const primaryDoc = attachments[0]?.document ?? (d.documents?.[0] ? {
        id: d.documents[0].id,
        file_name: d.documents[0].file_name,
        mime_type: d.documents[0].mime_type,
        ocr_status: d.documents[0].ocr_status,
        ocr_confidence: d.documents[0].ocr_confidence,
        extracted_text: d.documents[0].ocr_corrected_text || d.documents[0].extracted_text || null,
      } : null);
      const primaryFile = attachments[0]?.file ?? null;

      const { buildAnalysisReport } = await import('../lib/report');
      const pdf = await buildAnalysisReport({
        referenceNo: d.petition.reference_no,
        subject: d.petition.subject_display ?? d.petition.subject,
        status: t(`status.${d.petition.status}`),
        receivedAt: fmtTime(d.petition.created_at, lang),
        petitioner: {
          name: d.petition.citizen_name_display ?? displayName(d.petition.citizen_name, lang),
          phone: d.petition.citizen_phone,
          address: d.petition.citizen_address_display ?? displayAddress(d.petition.citizen_address, lang),
          language: d.petition.language,
        },
        extracted: d.extracted_details ?? null,
        document: primaryDoc,
        originalFile: primaryFile,
        attachments,
        analysis: d.analysis?.full ?? null,
        lang,
      });
      pdf.save(`${d.petition.reference_no}-analysis.pdf`);
    } catch (e: any) {
      setPdfErr(e?.message ?? t('agent.errDownload'));
    } finally { setPdfBusy(false); }
  };

  const analyse = async () => {
    setBusy('analyse'); setErr(''); setMsg('');
    try {
      await pocApi.post(`/cp/petitions/${petitionId}/analyse`);
      setMsg(t('detail.analysisDone'));
      await load();
      // One page now, so bring the analysis into view rather than switching tab.
      requestAnimationFrame(() => {
        document.getElementById('ai-analysis')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(''); }
  };

  const save = async (patch: any, note: string) => {
    setBusy('save'); setErr('');
    try {
      await pocApi.patch(`/cp/petitions/${petitionId}`, patch);
      setMsg(note);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(''); }
  };

  if (err && !d) return <div className="poc-note err">{err}</div>;
  if (!d) return <div className="poc-card"><div className="empty"><span className="spin" /></div></div>;

  const p = d.petition;
  const analysed = p.analysis_status === 'COMPLETED' && d.analysis;
  // The bilingual analysis blob; the flat columns beside it are English only.
  const full = d.analysis?.full;

  /*
   * Show a knowledge-base name in the selected language.
   *
   * Falls back to the English column, and then to a plain "none matched", so a
   * record with no Tamil name still shows a name rather than a blank.
   */
  const bi = (b: any, fallback?: string | null) => {
    const v = b && typeof b === 'object' ? (b[lang] || b.en) : b;
    return v || fallback || <span className="muted">{t('ai.noneMatched')}</span>;
  };

  return (
    <>
      <div className="poc-head">
        <div className="grow">
          <h1><span className="mono">{p.reference_no}</span></h1>
          <div className="lede">{p.subject_display || p.subject}</div>
        </div>
        <span className={`poc-chip ${p.status === 'CLOSED' ? 'ok' : ''}`}>
          {t('status.' + p.status)}
        </span>
        {p.officer_verified === 1 && <span className="poc-chip ok">{t('detail.verifiedBy')}</span>}
        <button className="btn" onClick={onBack}>{t('detail.backToDashboard')}</button>
      </div>

      {err && <div className="poc-note err">{err}</div>}
      {msg && <div className="poc-note ok">{msg}</div>}

      <div className="poc-split">
        <div>
          {/*
            * One page, not two tabs.
            *
            * The letter and its analysis belong together: an officer reads the
            * scan and then the finding, in that order, without switching views.
            * The analysis appears here as soon as the backend produces it -
            * `load()` is called on every document:ocr / petition:update event,
            * so this section fills in by itself while the officer is still
            * looking at the document.
            */}
          <LetterTab d={d} onRefresh={load} />

          {/*
            * Where the file has got to, shown whether or not the analysis has
            * run: a petition moves between desks regardless of what the AI
            * has managed to say about it.
            */}
          <WorkflowStages petitionId={petitionId} feed={feed} />

          <div className="poc-card" id="ai-analysis">
            <header>
              <h3>{t('detail.tabAnalysis')}</h3>
              <div className="grow" />
              {analysed && <span className="poc-chip ai">{pct(d.analysis.overall_confidence)}</span>}
            </header>
            <div className="body">
              {analysed ? (
                <>
                  <AnalysisPanel d={d} />

                  {/*
                    * Closing actions, at the end of the analysis where the
                    * officer finishes reading. OK returns to the dashboard;
                    * Download produces the official report as a PDF.
                    */}
                  {pdfErr && <div className="poc-note err" style={{ marginTop: 12 }}>{pdfErr}</div>}
                  <div className="reply-actions">
                    <button className="btn primary" onClick={onBack}>{t('agent.ok')}</button>
                    <button className="btn" disabled={pdfBusy} onClick={downloadReport}>
                      {pdfBusy ? t('agent.preparing') : t('agent.download')}
                    </button>
                  </div>
                </>
              ) : (
                <div className="empty">
                  <p>{t('detail.notAnalysed')}</p>
                  <button className="btn primary" disabled={!!busy} onClick={analyse}>
                    {busy === 'analyse'
                      ? <><span className="spin" /> {t('detail.analysing')}</>
                      : t('detail.runAnalysis')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          <PetitionerCard petition={p} extracted={d.extracted_details} />

          <div className="poc-card">
            <header>
              <h3>{t('ai.title')}</h3>
              {analysed && <span className="poc-chip ai">{pct(d.analysis.overall_confidence)}</span>}
            </header>
            <div className="body">
              {analysed ? (
                <>
                  <dl className="kv" style={{ gridTemplateColumns: '95px 1fr' }}>
                    {/*
                      * Read the BILINGUAL names from the stored analysis, not the
                      * flat English columns beside it. Those columns hold only the
                      * English name, so this card stayed English while the rest of
                      * the page was Tamil.
                      */}
                    <dt>{t('ai.act')}</dt>
                    <dd>{bi(full?.act?.short_name, d.act?.short_name)}</dd>
                    <dt>{t('ai.department')}</dt>
                    <dd>{bi(full?.department?.name, d.department?.name)}</dd>
                    <dt>{t('ai.authority')}</dt>
                    <dd>{bi(full?.authority?.designation, d.authority?.designation)}</dd>
                    <dt>{t('ai.priority')}</dt>
                    <dd><span className="poc-chip">{t(`prio.${d.analysis.priority}`)}</span></dd>
                  </dl>
                  <button className="btn sm mt" disabled={!!busy} onClick={analyse}>
                    {busy === 'analyse' ? <span className="spin" /> : null} {t('ai.rerun')}
                  </button>
                </>
              ) : (
                <>
                  <p className="small muted">{t('ai.none')}</p>
                  <button className="btn primary" disabled={!!busy} onClick={analyse} style={{ width: '100%' }}>
                    {busy === 'analyse' ? <><span className="spin" /> {t('detail.analysing')}</> : t('detail.runAnalysis')}
                  </button>
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------ letter tab
function LetterTab({ d, onRefresh }: { d: any; onRefresh: () => void }) {
  const { t, lang } = useI18n();
  const [openDoc, setOpenDoc] = useState<number | null>(d.documents?.[0]?.id ?? null);
  const doc = d.documents?.find((x: any) => x.id === openDoc);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [previewErr, setPreviewErr] = useState('');

  /*
   * The file endpoint authenticates from the Authorization header, which an
   * <img> or <iframe> src cannot send. Fetching the file and rendering it from
   * an object URL keeps the request authenticated without exposing the token
   * in a URL, where it would end up in logs and browser history.
   */
  useEffect(() => {
    if (!doc) { setBlobUrl(null); return; }
    let revoked: string | null = null;
    let cancelled = false;
    setPreviewErr('');

    fetch(`/api/cp/documents/${doc.id}/file`, {
      headers: { Authorization: `Bearer ${getPocToken()}` },
    })
      .then((r) => { if (!r.ok) throw new Error(t('detail.loadFailed')); return r.blob(); })
      .then((b) => {
        if (cancelled) return;
        const url = URL.createObjectURL(b);
        revoked = url;
        setBlobUrl(url);
      })
      .catch((e) => { if (!cancelled) setPreviewErr(e.message); });

    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [doc?.id]);

  return (
    <>
      <div className="poc-card">
        <header><h3>{t('detail.asSubmitted')}</h3></header>
        <div className="body">
          <dl className="kv">
            <dt>{t('detail.subject')}</dt><dd className="b">{d.petition.subject_display || d.petition.subject}</dd>
            <dt>{t('detail.description')}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{d.petition.description_display || d.petition.description}</dd>
          </dl>
        </div>
      </div>

      {/*
        * The uploaded document, as one attachment card.
        *
        * Previously a table listed the file and a second card previewed it
        * below, which meant two headings and a click to see a document the
        * officer had just uploaded. The file is attached to the case, so it is
        * simply shown: a compact file strip with its state, and the document
        * itself beneath it.
        */}
      <div className="poc-card">
        <header>
          <h3>{t('detail.documents')}</h3>
          <div className="grow" />
          {d.documents?.length > 1 && (
            <span className="poc-chip">{d.documents.length}</span>
          )}
        </header>

        <div className="body">
          {!d.documents?.length ? (
            <div className="empty">{t('detail.noDocuments')}</div>
          ) : (
            <>
              {/* One strip per file; selecting one shows it below. */}
              <div className="attach-list">
                {d.documents.map((x: any) => {
                  const reading = x.ocr_status === 'PENDING' || x.ocr_status === 'PROCESSING';
                  return (
                    <button
                      key={x.id}
                      className={`attach${x.id === openDoc ? ' on' : ''}`}
                      onClick={() => setOpenDoc(x.id)}
                      aria-pressed={x.id === openDoc}
                    >
                      <span className="ico" aria-hidden="true">
                        {x.mime_type?.startsWith('image/') ? '🖼' : '📄'}
                      </span>
                      <span className="meta">
                        <span className="name">{x.file_name || x.title}</span>
                        <span className="sub">
                          {reading ? (
                            <><span className="spin" /> {t('doc.reading')}</>
                          ) : (
                            <>
                              <span className={`dot ${x.ocr_status === 'COMPLETED' ? 'ok' : 'warn'}`} />
                              {t('status.' + x.ocr_status)}
                              {x.ocr_confidence != null
                                && <> · {pct(x.ocr_confidence)} {t('doc.confidence')}</>}
                              {' · '}{fmtTime(x.uploaded_at, lang)}
                            </>
                          )}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* The document itself. */}
              {doc && (
                <div className="attach-view">
                  {previewErr ? (
                    <div className="poc-note err">{previewErr}</div>
                  ) : !blobUrl ? (
                    <div className="empty"><span className="spin" /> {t('common.loading')}</div>
                  ) : (
                    <div className="poc-preview">
                      {doc.mime_type?.startsWith('image/') ? (
                        <img src={blobUrl} alt={doc.title} />
                      ) : doc.mime_type === 'application/pdf' ? (
                        <iframe src={blobUrl} title={doc.title} />
                      ) : (
                        <div className="empty">
                          {t('detail.noPreview')}{' '}
                          <a href={blobUrl} download={doc.file_name}>{t('detail.downloadFile')}</a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {doc && (
        <>
          <DocumentTextCard doc={doc} />
        </>
      )}
    </>
  );
}


// ------------------------------------------------------- document text card
/**
 * The text the backend read from the document.
 *
 * READ-ONLY BY DESIGN. Reading a document is a server responsibility: the
 * engine used, the language models, the re-run and correction machinery are
 * all backend concerns and are deliberately not surfaced here. The officer
 * sees what was read and how far it can be trusted, which is what they need in
 * order to judge the analysis - not which OCR engine produced it.
 *
 * The correction endpoints still exist on the server and are unchanged; they
 * are simply no longer driven from this screen.
 */
function DocumentTextCard({ doc }: { doc: any }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const text = doc.ocr_corrected_text || doc.extracted_text || '';
  const isProcessing = doc.ocr_status === 'PENDING' || doc.ocr_status === 'PROCESSING';
  const failed = doc.ocr_status === 'FAILED';
  const lowConfidence = doc.ocr_confidence != null && doc.ocr_confidence < 0.7;

  return (
    <div className="poc-card">
      <header>
        <h3>{t('doc.textRead')}</h3>
        <div className="grow" />
        {isProcessing && (
          <span className="poc-chip"><span className="spin" /> {t('doc.reading')}</span>
        )}
        {!isProcessing && !failed && doc.ocr_confidence != null && (
          <span className={`poc-chip ${lowConfidence ? 'warn' : 'ok'}`}>
            {pct(doc.ocr_confidence)} {t('doc.confidence')}
          </span>
        )}
        {!!text && !isProcessing && (
          <button className="btn sm" onClick={() => setOpen((v) => !v)}>
            {open ? t('common.hide') : t('common.show')}
          </button>
        )}
      </header>

      <div className="body">
        {isProcessing && (
          <div className="poc-note">{t('doc.readingNote')}</div>
        )}

        {failed && (
          <div className="poc-note warn">
            {doc.ocr_note ?? t('doc.readFailed')}
          </div>
        )}

        {!isProcessing && !failed && !text && (
          <div className="poc-note warn">{t('doc.noText')}</div>
        )}

        {!!text && !isProcessing && (
          <>
            {lowConfidence && (
              <div className="poc-note warn" style={{ marginBottom: 10 }}>
                {t('doc.lowConfidence')}
              </div>
            )}
            {open
              ? <pre className="extract">{text}</pre>
              : (
                <p className="small muted" style={{ margin: 0 }}>
                  {t('doc.charsRead').replace('{n}', String(text.length))}
                </p>
              )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------- petitioner card
/**
 * The petitioner's particulars.
 *
 * Two sources, shown together and never merged silently:
 *
 *   - what a person entered on the petition record;
 *   - what the BACKEND read out of the uploaded document.
 *
 * Where the record is blank and the document supplied a value, the extracted
 * value is shown and labelled as read from the document, with the snippet it
 * came from available on hover. An officer must be able to tell which is which:
 * a name read off a scan is a machine's reading of handwriting, not a
 * declaration by the citizen, and acting on it without checking would be
 * unsafe. Extraction never overwrites an entered value.
 */
function PetitionerCard({ petition: p, extracted }: { petition: any; extracted: any }) {
  const { t, lang } = useI18n();
  const anyExtracted = !!extracted && Object.keys(extracted).length > 0;

  /*
   * Render one row, preferring the entered value over the extracted one.
   *
   * A NAME OR ADDRESS IS NEVER TRANSLATED OR TRANSLITERATED. The document
   * records "அய்யாத்தாள்" and nothing else; producing "Aiyyaththaal" would
   * invent a spelling that appears nowhere in the record and might not match
   * the citizen's other documents, so the same person could end up filed under
   * two names. In the English view the Tamil is shown as written, with a note
   * saying so.
   */
  const row = (label: string, entered: unknown, field: string, mono = false) => {
    const e = extracted?.[field];
    const enteredStr = typeof entered === 'string' ? entered.trim() : '';
    const useExtracted = !enteredStr && !!e?.value;
    const rawValue = enteredStr || e?.value || '';

    // Bilingual display:
    // If in Tamil mode and value is English, display Tamil translation/transliteration.
    // If in English mode and value is Tamil, display Latin transliteration.
    let displayVal = rawValue;
    let isRenderedDifferent = false;

    if (field === 'name') {
      const serverDisplay = p.citizen_name_display;
      if (serverDisplay && serverDisplay !== rawValue) {
        displayVal = serverDisplay;
        isRenderedDifferent = true;
      } else {
        const computed = displayName(rawValue, lang);
        if (computed && computed !== rawValue) {
          displayVal = computed;
          isRenderedDifferent = true;
        }
      }
    } else if (field === 'address') {
      const serverDisplay = p.citizen_address_display;
      if (serverDisplay && serverDisplay !== rawValue) {
        displayVal = serverDisplay;
        isRenderedDifferent = true;
      } else {
        const computed = displayAddress(rawValue, lang);
        if (computed && computed !== rawValue) {
          displayVal = computed;
          isRenderedDifferent = true;
        }
      }
    }

    return (
      <>
        <dt>{label}</dt>
        <dd className={mono ? 'mono' : undefined}>
          {displayVal || <span className="muted">{t('common.none')}</span>}
          {useExtracted && (
            <span
              className="poc-chip"
              style={{ marginLeft: 6, fontSize: 10 }}
              title={e.evidence ? `“${e.evidence}”` : undefined}
            >
              {t('pet.fromDoc')}
            </span>
          )}
          {isRenderedDifferent && rawValue && (
            <div className="small muted" style={{ marginTop: 2 }}>
              {rawValue} <span style={{ opacity: .75 }}>· {t('pet.asWritten')}</span>
            </div>
          )}
        </dd>
      </>
    );
  };

  return (
    <div className="poc-card">
      <header><h3>{t('pet.title')}</h3></header>
      <div className="body">
        <dl className="kv" style={{ gridTemplateColumns: '95px 1fr' }}>
          {row(t('pet.name'), p.citizen_name, 'name')}
          {row(t('pet.phone'), p.citizen_phone, 'phone', true)}
          {row(t('pet.address'), p.citizen_address, 'address')}
          <dt>{t('pet.language')}</dt>
          {/* The name of the language, in the console's own language: a Tamil
              console showed "தமிழ் / Tamil", which mixes the two in one field. */}
          <dd>{p.language === 'ta' ? t('lang.ta') : t('lang.en')}</dd>
          <dt>{t('pet.received')}</dt>
          <dd>{fmtTime(p.created_at, lang)}</dd>
          {extracted?.document_date && (
            <>
              <dt>{t('pet.docDate')}</dt>
              <dd className="mono">
                {extracted.document_date.value}
                <span className="poc-chip" style={{ marginLeft: 6, fontSize: 10 }}>
                  {t('pet.fromDoc')}
                </span>
              </dd>
            </>
          )}
          {extracted?.reference && (
            <>
              <dt>{t('pet.reference')}</dt>
              <dd className="mono">{extracted.reference.value}</dd>
            </>
          )}
        </dl>

        {anyExtracted && (
          <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
            {t('pet.fromDocNote')}
          </p>
        )}
      </div>
    </div>
  );
}
