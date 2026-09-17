import React from 'react';
import { createRoot } from 'react-dom/client';
import { PocApp } from './poc/PocApp';
import { I18nProvider } from './lib/i18n';

/**
 * Citizen Petition POC.
 *
 * Two roles only: a Citizen who submits petitions, and a Government Grievance
 * Officer who reviews them with AI assistance and manages the AI Knowledge
 * Configuration.
 */
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* One provider at the root: every screen reads its language from here. */}
      <I18nProvider>
        <PocApp />
      </I18nProvider>
  </React.StrictMode>,
);
