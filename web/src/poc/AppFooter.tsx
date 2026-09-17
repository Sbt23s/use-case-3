/**
 * Application footer.
 *
 * Sits at the bottom of every page, after the content, so it scrolls with the
 * page rather than covering it.
 *
 * THE LOGO. If `public/pixous-logo.png` exists it is used; otherwise the mark
 * below renders as text. A real logo file dropped into `web/public/` with that
 * name is picked up with no code change - I have not attempted to redraw the
 * artwork, because an approximation of a company's mark is worse than none.
 */
import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';

export function AppFooter() {
  const { t } = useI18n();
  const [hasLogo, setHasLogo] = useState(false);

  useEffect(() => {
    // Probe once; a missing file simply leaves the text mark in place.
    const img = new Image();
    img.onload = () => setHasLogo(true);
    img.onerror = () => setHasLogo(false);
    img.src = '/pixous-logo.png';
  }, []);

  return (
    <footer className="poc-footer">
      <span className="dev">{t('footer.developedBy')}</span>
      {hasLogo ? (
        <img src="/pixous-logo.png" alt="Pixous Technologies" className="pixous-logo" />
      ) : (
        <span className="pixous-mark">
          <span className="dots" aria-hidden="true" />
          <span className="name">
            PIXOUS<span className="tech"> TECHNOLOGIES</span>
          </span>
        </span>
      )}
    </footer>
  );
}
