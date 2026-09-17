import { spawn } from 'node:child_process';

/**
 * Render PDF pages to images using MuPDF (via PyMuPDF).
 *
 * WHY A SECOND RENDERER EXISTS. pdf.js is the primary engine and handles most
 * files, but it cannot draw every embedded font. One real petition embeds a
 * subset of NirmalaUI with no ToUnicode table; pdf.js rendered every glyph as a
 * tofu box, so OCR read ZERO characters from a page that is perfectly legible
 * in a browser. MuPDF renders the same page correctly - the Tamil comes out as
 * "கைபேசி எண்" and "கோயம்புத்தூர்" exactly as the document reads.
 *
 * This matters because the text layer of such a file is also wrong: the same
 * broken font map yields "ககசபசி" and "சகாயம்புத்தூர்". Rendering with MuPDF
 * and running OCR over the image is the only route that recovers the document
 * as written, because it reads the SHAPES rather than trusting the file's own
 * character mapping.
 *
 * It is a fallback, not the default. Where the text layer is sound it is both
 * faster and more accurate than any OCR, so this runs only when the layer has
 * been rejected or is missing.
 */

/** Python is optional; a deployment without it simply loses this fallback. */
let _available: boolean | null = null;

export async function isMuPdfAvailable(): Promise<boolean> {
  if (_available !== null) return _available;
  _available = await new Promise<boolean>((resolve) => {
    const py = spawn('python', ['-c', 'import fitz; print(fitz.__doc__)']);
    const timer = setTimeout(() => { py.kill(); resolve(false); }, 20_000);
    py.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
    py.on('error', () => { clearTimeout(timer); resolve(false); });
  });
  return _available;
}

/** Force re-detection, for tests and for a changed environment. */
export function resetMuPdfCache(): void { _available = null; }

/*
 * The renderer, embedded so there is no separate script file to deploy or to
 * fall out of step with this module.
 *
 * Pages are written as PNG to a temporary directory and their paths printed one
 * per line. Passing images back over stdout would mean base64-encoding tens of
 * megabytes through a pipe; the caller reads the files and deletes them.
 */
const RENDER_SCRIPT = `
import sys, os, tempfile, json

try:
    import fitz
except Exception as e:
    sys.stderr.write('pymupdf-missing: ' + str(e))
    sys.exit(2)

src = sys.argv[1]
dpi = int(sys.argv[2])
max_pages = int(sys.argv[3])

try:
    doc = fitz.open(src)
except Exception as e:
    sys.stderr.write('open-failed: ' + str(e))
    sys.exit(3)

out = []
count = min(doc.page_count, max_pages)
for i in range(count):
    try:
        page = doc.load_page(i)
        pix = page.get_pixmap(dpi=dpi)
        fd, path = tempfile.mkstemp(suffix='.png', prefix='egov_mu_')
        os.close(fd)
        pix.save(path)
        out.append(path)
    except Exception:
        # One bad page must not lose the others.
        continue

sys.stdout.write(json.dumps({'pages': out, 'total': doc.page_count}))
`;

export interface MuPdfRender {
  /** Absolute paths of the rendered PNG pages, in document order. */
  pages: string[];
  /** How many pages the document has, which may exceed `pages.length`. */
  total: number;
}

/**
 * Render up to `maxPages` pages at `dpi`.
 *
 * 300 dpi is the default because Tamil glyphs carry their meaning in small
 * marks - the pulli and the vowel signs - and OCR accuracy falls sharply below
 * roughly 200 dpi. Returns null when Python or PyMuPDF is unavailable, or when
 * the file cannot be opened, so the caller can fall back rather than fail.
 */
export async function renderPdfWithMuPdf(
  pdfPath: string,
  opts: { dpi?: number; maxPages?: number } = {},
): Promise<MuPdfRender | null> {
  if (!(await isMuPdfAvailable())) return null;

  const dpi = opts.dpi ?? 300;
  const maxPages = opts.maxPages ?? 10;

  return new Promise<MuPdfRender | null>((resolve) => {
    const py = spawn('python', ['-c', RENDER_SCRIPT, pdfPath, String(dpi), String(maxPages)]);
    let out = '';
    let err = '';
    py.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    py.stderr?.on('data', (d: Buffer) => { err += d.toString(); });

    // Rendering a long document is slow; the cap is generous but finite so a
    // stuck subprocess cannot hold an upload open indefinitely.
    const timer = setTimeout(() => { py.kill(); resolve(null); }, 180_000);

    py.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        console.warn('[mupdf] render failed:', err.slice(0, 200));
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(out.trim());
        const pages: string[] = Array.isArray(parsed?.pages) ? parsed.pages : [];
        resolve(pages.length ? { pages, total: Number(parsed.total) || pages.length } : null);
      } catch {
        resolve(null);
      }
    });
    py.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}
