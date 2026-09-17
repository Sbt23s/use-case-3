import { useEffect, useState } from 'react';
import { pct } from './pocApi';
import { useI18n } from '../lib/i18n';
import { displayName, displayAddress, transliterate, transliterateToTamil, hasTamil, hasLatin, KNOWN_EN_TO_TA } from '../lib/translit';

/**
 * AI analysis result, in Tamil and English.
 *
 * Every element is a recommendation shown with its reasoning and its source,
 * so the officer can check it rather than take it on trust. The verification
 * requirement appears at the top, in both languages, and is repeated in the
 * spoken version - an officer listening rather than reading must be told too.
 */

interface Bilingual { en: string; ta: string }

export function formatBilingual(b: Bilingual | undefined | null, lang: 'en' | 'ta', fallback = '—'): string {
  if (!b) return fallback;
  let text = String(b[lang] || (lang === 'ta' ? b.ta : b.en) || b.en || b.ta || fallback).trim();
  if (!text) return fallback;

  if (lang === 'en') {
    if (hasTamil(text)) {
      text = text.replace(/People named:\s*(.+)$/i, (_m, list) => {
        const trNames = list.split(',').map((n: string) => displayName(n.trim(), 'en')).join(', ');
        return `People named: ${trNames}`;
      }).replace(/Places mentioned:\s*(.+)$/i, (_m, list) => {
        const trPlaces = list.split(',').map((p: string) => displayAddress(p.trim(), 'en')).join(', ');
        return `Places mentioned: ${trPlaces}`;
      }).replace(/Senior citizen — as stated:\s*(.+)$/i, (_m, rest) => {
        return hasTamil(rest) ? `Senior citizen — as stated: ${transliterate(rest)}` : text;
      });

      if (hasTamil(text)) {
        text = transliterate(text);
      }
    }
  } else if (lang === 'ta') {
    if (hasLatin(text)) {
      text = text.replace(/குறிப்பிடப்பட்ட நபர்கள்:\s*(.+)$/i, (_m, list) => {
        const trNames = list.split(',').map((n: string) => displayName(n.trim(), 'ta')).join(', ');
        return `குறிப்பிடப்பட்ட நபர்கள்: ${trNames}`;
      }).replace(/குறிப்பிடப்பட்ட இடங்கள்:\s*(.+)$/i, (_m, list) => {
        const trPlaces = list.split(',').map((p: string) => displayAddress(p.trim(), 'ta')).join(', ');
        return `குறிப்பிடப்பட்ட இடங்கள்: ${trPlaces}`;
      });

      const lower = text.trim().toLowerCase();
      const known = KNOWN_EN_TO_TA[lower];
      if (known) {
        text = known;
      } else {
        text = text
          .replace(/\bSec\.?\s*(\d+)/gi, 'பிரிவு $1')
          .replace(/\bSection\s*(\d+)/gi, 'பிரிவு $1')
          .replace(/Encroachment on public roads/gi, 'பொதுச் சாலைகளில் ஆக்கிரமிப்பு')
          .replace(/Powers of inspection/gi, 'ஆய்வு அதிகாரம்')
          .replace(/Drinking water supply/gi, 'குடிநீர் விநியோகம்')
          .replace(/Panchayat audit and dissolution/gi, 'ஊராட்சி தணிக்கை மற்றும் கலைப்பு')
          .replace(/Claim for maintenance/gi, 'பராமரிப்பு கோரிக்கை')
          .replace(/Tribunal order/gi, 'தீர்ப்பாய உத்தரவு')
          .replace(/Rural Development\s*(?:&|and)\s*Panchayat Raj(?:\s*Department)?/gi, 'ஊரக வளர்ச்சி மற்றும் ஊராட்சித் துறை');

        const taCount = (text.match(/[\u0B80-\u0BFF]/g) || []).length;
        const enCount = (text.match(/[A-Za-z]/g) || []).length;
        if (enCount > 0 && taCount === 0 && text.split(/\s+/).length <= 3) {
          text = transliterateToTamil(text);
        }
      }
    }
  }
  return text;
}

/**
 * Dedicated AI Summary Card positioned directly underneath the uploaded document.
 * Updates in real-time as analysis progresses and completes.
 */
export function AISummaryCard({ d }: { d: any }) {
  const { lang, t: tr } = useI18n();
  const a = d?.analysis;
  const full = a?.full;
  const isPending = (d?.documents ?? []).some(
    (x: any) => x.ocr_status === 'PENDING' || x.ocr_status === 'PROCESSING',
  ) || d?.petition?.analysis_status === 'PENDING'
    || d?.petition?.analysis_status === 'PROCESSING';

  const t = (k: string) => tr(`an.${k}`);
  const v = (b: Bilingual | undefined | null, fallback = '—') => formatBilingual(b, lang, fallback);

  if (!full && !isPending) return null;

  return (
    <div className="poc-card ai-summary-card" id="ai-summary">
      <header>
        <h3>{t('summary')}</h3>
        <div className="grow" />
        {full?.overall_confidence != null ? (
          <span className={`poc-chip ${full.overall_confidence < 0.6 ? 'warn' : 'ai'}`}>
            {pct(full.overall_confidence)}
          </span>
        ) : isPending ? (
          <span className="poc-chip ai">
            <span className="spin" /> {lang === 'ta' ? 'பகுப்பாய்வு நடக்கிறது...' : 'Analysing...'}
          </span>
        ) : null}
      </header>
      <div className="body">
        {isPending && !full ? (
          <div className="empty">
            <span className="spin" /> {lang === 'ta' ? 'ஆவணம் பகுப்பாய்வு செய்யப்படுகிறது...' : 'Analysing document in real-time...'}
          </div>
        ) : full ? (
          <>
            <p style={{ fontSize: '14px', lineHeight: 1.65, color: 'var(--ink)' }}>{v(full.summary)}</p>
            <dl className="kv">
              <dt>{t('mainIssue')}</dt><dd>{v(full.main_issue)}</dd>
              <dt>{t('request')}</dt><dd>{v(full.petitioner_request)}</dd>
              {full.sub_issues?.length > 0 && (
                <>
                  <dt>{t('subIssues')}</dt>
                  <dd>{full.sub_issues.map((s: Bilingual) => v(s)).join(' · ')}</dd>
                </>
              )}
            </dl>

            {full.detected_concepts?.length > 0 && (
              <>
                <h4 className="mt">{t('understood')}</h4>
                <div className="row">
                  {full.detected_concepts.map((c: any) => (
                    <span key={c.id} className="poc-chip ai" title={c.evidence?.join(', ')}>
                      {c.label?.[lang] ?? c.id}
                    </span>
                  ))}
                </div>
                <p className="small muted mt" style={{ marginBottom: 0 }}>
                  {lang === 'ta'
                    ? 'மனுவின் உரையிலிருந்து கண்டறியப்பட்டது. இதுவே பொருத்தத்திற்கு அடிப்படை.'
                    : 'Detected from the petition text. These drive the matching below.'}
                </p>
              </>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

export function AnalysisPanel({ d }: { d: any }) {
  /*
   * The analysis language follows the application-wide toggle in the header.
   *
   * This panel used to carry its own English/தமிழ் buttons, so the page could
   * show an English console around a Tamil analysis. One selection now governs
   * every section, switching them together and in place.
   */
  const { lang, t: tr } = useI18n();
  const a = d.analysis;
  // The bilingual result is authoritative; the columns are a flat summary of it.
  const full = a?.full;

  // One phrase book for the whole console; see lib/i18n.tsx.
  const t = (k: string) => tr(`an.${k}`);
  const v = (b: Bilingual | undefined | null, fallback = '—') => formatBilingual(b, lang, fallback);

  if (!full) {
    // An analysis stored before the bilingual format was introduced.
    return (
      <div className="poc-note warn">
        {t('oldFormat')}
      </div>
    );
  }

  return (
    <>
      {/* ---------------- reasoning flow ---------------- */}
      <div className="poc-card">
        <header><h3>{t('flow')}</h3></header>
        <div className="body">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {full.reasoning_flow?.map((s: any, i: number) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  border: '1px solid var(--line)', borderRadius: 6, padding: '6px 10px',
                  background: '#fff', fontSize: 12.5, maxWidth: 230,
                }}>
                  {/* An analysis stored before the labels were bilingual has only
                      the English `step`; it is used as the fallback so an older
                      record still renders rather than showing a blank stage. */}
                  <span className="muted" style={{ fontSize: 11, display: 'block' }}>
                    {s.step_label ? v(s.step_label) : s.step}
                  </span>
                  <span className="b">{v(s.value)}</span>
                </span>
                {i < full.reasoning_flow.length - 1 && <span className="muted">→</span>}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ---------------- facts ---------------- */}
      <div className="poc-card">
        <header><h3>{t('facts')}</h3></header>
        <div className="body">
          {full.important_facts?.length ? (
            <ul className="list">
              {full.important_facts.map((f: Bilingual, i: number) => <li key={i}>{v(f)}</li>)}
            </ul>
          ) : <p className="muted small">—</p>}

          {full.entities && (
            <>
              <h4 className="mt">{t('entities')}</h4>
              <dl className="kv">
                {full.entities.dates?.length > 0 && (<><dt>{t('entDates')}</dt><dd className="mono">{full.entities.dates.join(', ')}</dd></>)}
                {full.entities.amounts?.length > 0 && (<><dt>{t('entAmounts')}</dt><dd className="mono">{full.entities.amounts.join(', ')}</dd></>)}
                {full.entities.people?.length > 0 && (
                  <><dt>{t('entPeople')}</dt><dd>{full.entities.people.map((p: string) => displayName(p, lang)).join(', ')}</dd></>
                )}
                {full.entities.places?.length > 0 && (
                  <><dt>{t('entPlaces')}</dt><dd>{full.entities.places.map((p: string) => displayAddress(p, lang)).join(', ')}</dd></>
                )}
                {full.entities.documents_mentioned?.length > 0 && (
                  <><dt>{t('entDocs')}</dt><dd>{full.entities.documents_mentioned.join(', ')}</dd></>
                )}
              </dl>
            </>
          )}
        </div>
      </div>

      {/* ---------------- Act ---------------- */}
      <div className="poc-card">
        <header>
          <h3>{t('act')}</h3>
          {full.act?.id && (
            <span className={`poc-chip ${full.act.confidence < 0.6 ? 'warn' : 'ai'}`}>
              {pct(full.act.confidence)}
            </span>
          )}
          {full.act?.verification_status && (
            <span className={`poc-chip ${full.act.verification_status === 'VERIFIED' ? 'ok' : 'warn'}`}>
              {full.act.verification_status}
            </span>
          )}
        </header>
        <div className="body">
          {full.act?.id ? (
            <>
              {full.act.verification_status !== 'VERIFIED' && (
                <div className="poc-note warn">{t('unverified')}</div>
              )}
              <dl className="kv">
                <dt>{t('lblAct')}</dt>
                <dd className="b">{v(full.act.short_name)}</dd>
                <dt>{t('lblFullTitle')}</dt>
                <dd>{v(full.act.full_title)}</dd>
                <dt>{t('lblReference')}</dt>
                <dd className="mono">
                  {[full.act.act_number, full.act.year, full.act.jurisdiction_scope]
                    .filter(Boolean).join(' · ') || '—'}
                </dd>
                {full.act.section_no && (
                  <>
                    <dt>{t('lblSectionDt')}</dt>
                    <dd className="b">
                      {t('lblSectionWord')} {full.act.section_no}
                      {full.act.section_heading ? ` — ${v(full.act.section_heading)}` : ''}
                    </dd>
                  </>
                )}
              </dl>

              {full.act.alternatives?.length > 0 && (
                <>
                  <h4 className="mt">{t('alternatives')}</h4>
                  <ul className="list">
                    {full.act.alternatives.map((alt: any) => (
                      <li key={alt.id}>
                        {v(alt.short_name)}
                        <span className="poc-chip" style={{ marginLeft: 8 }}>{pct(alt.confidence)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="small muted">
                    {lang === 'ta'
                      ? 'இவையும் ஏறக்குறைய சமமாக பொருந்துகின்றன. அலுவலர் ஒப்பிட்டு முடிவு செய்யவும்.'
                      : 'These scored closely. The officer should compare before deciding.'}
                  </p>
                </>
              )}
            </>
          ) : (
            <div className="poc-note warn"><b>{t('noAct')}</b></div>
          )}
        </div>
      </div>

      {/* ---------------- Department and Authority ---------------- */}
      <div className="poc-grid c2">
        <div className="poc-card">
          <header>
            <h3>{t('dept')}</h3>
            {full.department?.id && (
              <span className={`poc-chip ${full.department.confidence < 0.6 ? 'warn' : 'ai'}`}>
                {pct(full.department.confidence)}
              </span>
            )}
          </header>
          <div className="body">
            {full.department?.id ? (
              <>
                <p className="b">{v(full.department.name)}</p>
                <h4 className="mt">{t('why')}</h4>
                <p className="small">{v(full.department.reason)}</p>
              </>
            ) : <div className="poc-note warn">{t('noDept')}</div>}
          </div>
        </div>

        <div className="poc-card">
          <header><h3>{t('authority')}</h3></header>
          <div className="body">
            {full.authority?.id ? (
              <>
                <p className="b">{v(full.authority.designation)}</p>
                <dl className="kv" style={{ gridTemplateColumns: '110px 1fr' }}>
                  <dt>{t('lblOffice')}</dt>
                  <dd>{v(full.authority.office_name)}</dd>
                  <dt>{t('jurisdiction')}</dt>
                  <dd>
                    {[full.authority.jurisdiction_level, full.authority.jurisdiction_area]
                      .filter(Boolean).join(' — ') || '—'}
                  </dd>
                  {full.escalation && (
                    <>
                      <dt>{t('escalation')}</dt>
                      <dd>{v(full.escalation.designation)}</dd>
                    </>
                  )}
                </dl>
                <h4 className="mt">{t('why')}</h4>
                <p className="small">{v(full.authority.reason)}</p>
              </>
            ) : <div className="poc-note warn">{t('noAuth')}</div>}
          </div>
        </div>
      </div>

      {/* ---------------- next steps ---------------- */}
      <WorkflowCard steps={full.workflow ?? []} status={d.petition?.status} />

      {/* ---------------- action and workflow ---------------- */}
      <div className="poc-card">
        <header>
          <h3>{t('nextAction')}</h3>
          <span className={`poc-chip ${
            full.priority === 'URGENT' || full.priority === 'HIGH' ? 'warn' : ''
          }`}>{t(full.priority)} {t('priority')}</span>
        </header>
        <div className="body">
          <p>{v(full.next_action)}</p>

          <h4 className="mt">{t('priorityWhy')}</h4>
          <p className="small muted">{v(full.priority_reason)}</p>
        </div>
      </div>

    </>
  );
}


/**
 * Next steps for this petition, as a single card.
 *
 * THE STEPS ARE THE ANALYSIS'S OWN. Nothing here is a fixed list of stages:
 * the analyser builds the sequence from the petition, the Act it identified,
 * the department it recommends and the action it proposes, so a street-light
 * petition and a patta dispute produce different steps naming their own
 * departments and provisions. Remove the Act from the knowledge base and the
 * step that names it disappears with it.
 *
 * WHERE "CURRENT" COMES FROM. The marker is derived from the petition's real
 * status, not from a guess about how far the case has got. An analysed
 * petition sits at the first step; one under review has moved past it; an
 * actioned or closed petition shows the whole sequence complete. A status the
 * workflow cannot place leaves every step pending rather than inventing
 * progress that has not happened - an officer must never read a step as done
 * because the interface assumed it.
 */
function WorkflowCard({ steps, status }: { steps: Bilingual[]; status?: string }) {
  const { lang, t: tr } = useI18n();
  const t = (k: string) => tr(`an.${k}`);
  const v = (b: Bilingual | undefined | null) => (b ? (b[lang] || b.en || '') : '');

  if (!steps.length) return null;

  /*
   * How many steps the petition's status implies are behind it.
   *
   * Deliberately conservative: only a status that genuinely means the officer
   * has moved on advances the marker.
   */
  const done = (() => {
    switch (String(status || '').toUpperCase()) {
      case 'ACTIONED':
      case 'CLOSED':
        return steps.length;          // the sequence is finished
      case 'UNDER_REVIEW':
        return 1;                     // the first step has been taken
      case 'ANALYSED':
      case 'SUBMITTED':
      case 'ANALYSING':
      default:
        return 0;                     // nothing has been done yet
    }
  })();

  const currentIndex = done < steps.length ? done : -1;

  return (
    <div className="poc-card wf-card">
      <header>
        <h3>{t('nextSteps')}</h3>
        <span className="poc-chip">
          {currentIndex >= 0 ? `${currentIndex + 1} / ${steps.length}` : `${steps.length} / ${steps.length}`}
        </span>
      </header>
      <div className="body">
        <ol className="wf-steps">
          {steps.map((step, i) => {
            const state = i < done ? 'done' : i === currentIndex ? 'now' : 'next';
            return (
              <li key={i} className={`wf-step ${state}`}>
                <span className="wf-marker" aria-hidden="true">
                  {state === 'done' ? '✓' : i + 1}
                </span>
                <div className="wf-body">
                  <p className="wf-text">{v(step)}</p>
                  <span className="wf-state">
                    {state === 'done' ? t('stepDone') : state === 'now' ? t('stepNow') : t('stepNext')}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="wf-note">{t('wfNote')}</p>
      </div>
    </div>
  );
}
