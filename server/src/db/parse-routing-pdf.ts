/**
 * Read the routing tables out of the knowledge-base PDF by COORDINATE.
 *
 * The tables have four columns at fixed x positions (issue / department / Act /
 * section), and every cell wraps across two or three lines. Reading the text
 * layer as lines interleaves the columns - "Land encroachment / unauthorised
 * Revenue and Disaster Tamil Nadu Land Sec. 6 & 7" is one visual row but four
 * different cells - which is why a line-based parser recovered only a handful
 * of rows.
 *
 * Each text run carries its own x and y, so runs are bucketed into columns by x
 * and into rows by y, and the cells are reassembled exactly as they appear on
 * the page.
 */
import { readFileSync } from 'node:fs';

export interface RoutingRow {
  domain: string;
  issue: string;
  department: string;
  act: string;
  section: string;
  page: number;
}

/** Column boundaries, from the x positions the document actually uses. */
const COLS = [
  { key: 'issue', from: 55, to: 200 },
  { key: 'department', from: 200, to: 315 },
  { key: 'act', from: 315, to: 445 },
  { key: 'section', from: 445, to: 999 },
] as const;

function columnOf(x: number): (typeof COLS)[number]['key'] | null {
  for (const c of COLS) if (x >= c.from && x < c.to) return c.key;
  return null;
}

export async function parseRoutingPdf(pdfPath: string): Promise<RoutingRow[]> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(pdfPath)),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    stopAtErrors: false,
  }).promise;

  const rows: RoutingRow[] = [];
  let domain = '';

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    /*
     * Bucket every run by its y coordinate. A wrapped cell occupies several
     * consecutive y values, so lines are collected first and grouped into rows
     * afterwards.
     */
    const byY = new Map<number, { x: number; str: string }[]>();
    for (const it of content.items as any[]) {
      const str = String(it.str ?? '').trim();
      if (!str) continue;
      const y = Math.round(it.transform?.[5] ?? 0);
      const x = Math.round(it.transform?.[4] ?? 0);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push({ x, str });
    }

    const lines = [...byY.entries()]
      .sort((a, b) => b[0] - a[0])            // top of page downwards
      .map(([y, items]) => ({ y, items: items.sort((a, b) => a.x - b.x) }));

    /*
     * Walk the lines, accumulating cells until a line starts a NEW row.
     *
     * A new row is one whose issue column has text AND whose department column
     * also has text: a continuation line fills only some columns.
     */
    let cur: Record<string, string[]> | null = null;
    let lastY: number | null = null;

    const flush = () => {
      if (!cur) return;
      const issue = (cur.issue ?? []).join(' ').replace(/\s{2,}/g, ' ').trim();
      const department = (cur.department ?? []).join(' ').replace(/\s{2,}/g, ' ').trim();
      const act = (cur.act ?? []).join(' ').replace(/\s{2,}/g, ' ').trim();
      const section = (cur.section ?? []).join(' ').replace(/\s{2,}/g, ' ').trim();
      cur = null;

      if (issue.length < 5 || department.length < 5 || act.length < 5) return;
      // Skip the repeated header row.
      if (/^Petition \/ Issue Type$/i.test(issue)) return;
      rows.push({ domain, issue, department, act, section, page: p });
    };

    for (const line of lines) {
      const cells: Record<string, string[]> = {};
      for (const it of line.items) {
        const col = columnOf(it.x);
        if (!col) continue;
        (cells[col] ??= []).push(it.str);
      }

      const whole = line.items.map((i) => i.str).join(' ').trim();

      // A domain heading ("A. Land, Revenue & Property") starts a new section.
      const dm = whole.match(/^([A-K])\.\s+(.{5,70})$/);
      if (dm && line.items[0].x < 60) {
        flush();
        domain = dm[2].trim();
        continue;
      }

      // Header row, page furniture and prose lines are not table rows.
      if (/^Petition \/ Issue Type/i.test(whole)) { flush(); continue; }
      if (line.items[0].x < 58 && !cells.department) { flush(); continue; }

      /*
       * A new row starts where there is a VERTICAL GAP.
       *
       * Both the first line of a row and its continuation lines carry issue and
       * department text, so "has both columns" cannot tell them apart - it split
       * every wrapped row in two. Within a row the lines are ~11pt apart; between
       * rows the gap is larger. The gap is the reliable signal.
       */
      const gap = lastY === null ? 99 : lastY - line.y;
      lastY = line.y;
      if (gap > 14 && cur) flush();

      cur ??= {};
      for (const [k, v] of Object.entries(cells)) {
        (cur[k] ??= []).push(...v);
      }
    }
    flush();
    page.cleanup?.();
  }

  await doc.destroy?.();
  return rows;
}
