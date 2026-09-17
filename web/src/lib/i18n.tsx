import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Application-wide internationalisation.
 *
 * One central dictionary, one provider, one `t()`. Every visible string in the
 * console resolves through here, so switching language re-renders the whole
 * tree in place - no page reload, no per-language routes, and no duplicated
 * screens.
 *
 * WHAT IS AND IS NOT TRANSLATED
 *
 * UI chrome - menus, buttons, labels, headings, table columns, notices - is
 * translated here. CONTENT is not: a petitioner's own words, an officer's
 * notes, and the names of Acts and departments come from the server, which
 * already returns them bilingually as { en, ta } from the knowledge base. This
 * separation matters: translating a citizen's words in the browser would put
 * text in a case record that nobody wrote.
 *
 * A missing key renders its English value, and falls back to the key itself if
 * there is none, so an untranslated string is visibly wrong rather than blank.
 */

export type Lang = 'en' | 'ta';

const STORAGE_KEY = 'poc.lang';

type Dict = Record<string, { en: string; ta: string }>;

/**
 * The dictionary.
 *
 * Keys are namespaced by area (nav., dash., doc., …) so related strings stay
 * together and a missing one is easy to place.
 */
export const STRINGS: Dict = {
  // ---------------------------------------------------------------- common
  'common.show':        { en: 'Show',        ta: 'காட்டு' },
  'common.hide':        { en: 'Hide',        ta: 'மறை' },
  'common.save':        { en: 'Save',        ta: 'சேமி' },
  'common.cancel':      { en: 'Cancel',      ta: 'ரத்து' },
  'common.close':       { en: 'Close',       ta: 'மூடு' },

  // ----------------------------------------------------- AI model settings
  'aim.title':    { en: 'AI Model',  ta: 'AI மாடல்' },
  'aim.settings': { en: 'AI Model / Settings', ta: 'AI மாடல் / அமைப்புகள்' },
  'aim.subtitle': {
    en: 'Choose which model answers. Keys are held on the server.',
    ta: 'எந்த மாடல் பதிலளிக்கும் என்பதைத் தேர்வுசெய்க. விசைகள் சேவையகத்தில் வைக்கப்பட்டுள்ளன.',
  },
  'aim.inUse':         { en: 'In use',          ta: 'பயன்பாட்டில்' },
  'aim.model':         { en: 'Model',           ta: 'மாடல்' },
  'aim.test':          { en: 'Test',            ta: 'சோதி' },
  'aim.testing':       { en: 'Testing…',        ta: 'சோதிக்கிறது…' },
  'aim.testOk':        { en: 'Connected',       ta: 'இணைக்கப்பட்டது' },
  'aim.testFailed':    { en: 'Connection failed', ta: 'இணைப்பு தோல்வியடைந்தது' },
  'aim.notConfigured': { en: 'Not configured',  ta: 'அமைக்கப்படவில்லை' },
  'aim.setEnv': {
    en: 'Set {var} in the server environment to enable this provider.',
    ta: 'இதைப் பயன்படுத்த சேவையக அமைப்பில் {var} என்பதை அமைக்கவும்.',
  },
  'aim.ollamaNote': {
    en: 'Runs locally. No key required; the daemon must be running.',
    ta: 'இந்தக் கணினியிலேயே இயங்குகிறது. அனுமதிச் சாவி தேவையில்லை; சேவை இயங்கிக் கொண்டிருக்க வேண்டும்.',
  },
  'aim.use':           { en: 'Use this model',  ta: 'இந்த மாடல்யைப் பயன்படுத்து' },
  'aim.saving':        { en: 'Saving…',         ta: 'சேமிக்கிறது…' },
  'aim.saved':         { en: 'Saved',           ta: 'சேமிக்கப்பட்டது' },
  'aim.keysNote': {
    en: 'API keys are stored only in the server environment. They are never sent to the browser and never stored in this application.',
    ta: 'API அனுமதிச் சாவிகள் சேவையகத்தில் மட்டுமே சேமிக்கப்படுகின்றன. அவை உலாவிக்கு அனுப்பப்படுவதில்லை; இந்தப் பயன்பாட்டில் சேமிக்கப்படுவதில்லை.',
  },
  'aim.translationService': { en: 'Dedicated Translation Service (TranslateAPI)', ta: 'பிரத்யேக மொழிபெயர்ப்பு சேவை (TranslateAPI)' },
  'aim.translateApiActive': { en: 'Active — Dedicated translation service connected', ta: 'செயலில் உள்ளது — பிரத்யேக மொழிபெயர்ப்பு சேவை இணைக்கப்பட்டுள்ளது' },
  'aim.translateApiFallback': { en: 'Translations fall back to selected AI model', ta: 'தேர்வு செய்யப்பட்ட AI மாடல் மூலம் மொழிபெயர்க்கப்படுகிறது' },
  'common.back':        { en: 'Back',        ta: 'பின்செல்' },
  'common.search':      { en: 'Search',      ta: 'தேடு' },
  'common.loading':     { en: 'Loading…',    ta: 'ஏற்றுகிறது…' },
  'common.none':        { en: '—',           ta: '—' },
  'common.notRecorded': { en: 'Not recorded', ta: 'பதிவு செய்யப்படவில்லை' },
  'common.open':        { en: 'Open',        ta: 'திற' },
  'common.download':    { en: 'Download',    ta: 'பதிவிறக்கு' },
  'common.retry':       { en: 'Try again',   ta: 'மீண்டும் முயற்சிக்கவும்' },
  'common.signOut':     { en: 'Sign out',    ta: 'வெளியேறு' },
  'common.live':        { en: 'Live',        ta: 'நேரலை' },
  'common.reconnecting':{ en: 'Reconnecting…', ta: 'மீண்டும் இணைக்கிறது…' },
  'common.language':    { en: 'Language',    ta: 'மொழி' },
  'footer.developedBy': { en: 'Developed by', ta: 'உருவாக்கியவர்' },

  // --------------------------------------------------- dashboard + detail
  'dash.officerUpload': { en: 'Officer upload', ta: 'அலுவலர் பதிவேற்றம்' },
  'dash.verifiedChip':  { en: 'Verified',       ta: 'சரிபார்க்கப்பட்டது' },
  'dash.analysisFailed':{ en: 'Analysis failed', ta: 'பகுப்பாய்வு தோல்வியடைந்தது' },
  'dash.pending':       { en: 'Pending',        ta: 'நிலுவையில்' },
  'dash.liveActivity':  { en: 'Live activity',  ta: 'நேரலை செயல்பாடு' },
  'dash.backToList':    { en: 'Back to list',   ta: 'பட்டியலுக்குத் திரும்பு' },
  'dash.selectDoc':     { en: 'Select a document to upload', ta: 'பதிவேற்ற ஆவணத்தைத் தேர்ந்தெடுக்கவும்' },
  'dash.uploadHint':    {
    en: 'The document is read and analysed automatically. Accepted: PDF, Word, JPG, PNG or text, up to 15 MB.',
    ta: 'ஆவணம் தானாகப் படிக்கப்பட்டு பகுப்பாய்வு செய்யப்படும். ஏற்கப்படுபவை: PDF, Word, JPG, PNG அல்லது உரை, அதிகபட்சம் 15 MB.',
  },
  'dash.uploadTitle':   { en: 'Upload Petition / Letter', ta: 'மனு / கடிதம் பதிவேற்று' },
  'dash.uploadLede':    {
    en: 'Enter citizen details, attach the scanned letter — AI analysis runs automatically',
    ta: 'குடிமகன் விவரங்களை உள்ளிட்டு, ஸ்கேன் செய்த கடிதத்தை இணைக்கவும் — AI பகுப்பாய்வு நடைபெறுகிறது தானாக இயங்கும்',
  },
  'dash.chooseFile':    { en: 'Choose File', ta: 'கோப்பைத் தேர்ந்தெடுக்கவும்' },
  'dash.uploadAnalyse': { en: 'Upload & Analyse', ta: 'பதிவேற்றி பகுப்பாய்வு செய்' },
  'dash.uploadFirst':   { en: 'Upload the first petition', ta: 'முதல் மனுவைப் பதிவேற்றவும்' },
  'dash.noPetitions':   { en: 'No petitions yet.', ta: 'இதுவரை மனுக்கள் இல்லை.' },

  // ------------------------------------------------- analysis panel
  /*
   * Moved here from AnalysisPanel, which kept its own label map.
   *
   * Two translation systems meant a wording fixed in one place stayed
   * wrong in the other, and nothing detected the drift. One phrase book
   * now serves the whole console.
   */
  'an.verifyTitle': { en: 'AI Recommendation — Requires Officer Verification', ta: 'AI பரிந்துரை — அதிகாரி சரிபார்ப்பு தேவை' },
  'an.verifyBody': { en: 'Every item below was matched against the configured AI Knowledge Configuration. No Act, department or authority can be named unless it exists there as a record. Please verify against the original document before acting.', ta: 'கீழே உள்ள ஒவ்வொரு உருப்படியும் கட்டமைக்கப்பட்ட AI அறிவுத் தளத்துடன் ஒப்பிடப்பட்டது. அங்கு பதிவாக இல்லாத எந்த சட்டம், துறை அல்லது அதிகாரியும் பெயரிடப்பட முடியாது. நடவடிக்கை எடுப்பதற்கு முன் அசல் ஆவணத்துடன் சரிபார்க்கவும்.' },
  'an.summary': { en: 'AI Summary', ta: 'AI சுருக்கம்' },
  'an.mainIssue': { en: 'Main issue', ta: 'முக்கிய பிரச்சினை' },
  'an.subIssues': { en: 'Other issues raised', ta: 'பிற பிரச்சினைகள்' },
  'an.request': { en: 'Petitioner’s request', ta: 'மனுதாரர் கோரிக்கை' },
  'an.understood': { en: 'What the AI understood this to be about', ta: 'AI புரிந்துகொண்ட பொருள்' },
  'an.facts': { en: 'Important facts', ta: 'முக்கிய தகவல்கள்' },
  'an.entities': { en: 'Details extracted', ta: 'பிரித்தெடுக்கப்பட்ட விவரங்கள்' },
  'an.entDates': { en: 'Dates', ta: 'தேதிகள்' },
  'an.entAmounts': { en: 'Amounts', ta: 'தொகைகள்' },
  'an.entPeople': { en: 'People', ta: 'நபர்கள்' },
  'an.entPlaces': { en: 'Places', ta: 'இடங்கள்' },
  'an.entDocs': { en: 'Documents', ta: 'ஆவணங்கள்' },
  'an.oldFormat': { en: 'This analysis was produced in an earlier format. Please re-run the analysis to see the full bilingual result.', ta: 'இந்த பகுப்பாய்வு பழைய வடிவத்தில் உருவாக்கப்பட்டது. முழு இருமொழி முடிவைக் காண பகுப்பாய்வை மீண்டும் இயக்கவும்.' },
  'an.act': { en: 'Applicable Act / Law', ta: 'பொருந்தும் சட்டம்' },
  'an.provision': { en: 'Provision text', ta: 'விதி உரை' },
  'an.whyAct': { en: 'Why this Act may apply', ta: 'இந்த சட்டம் ஏன் பொருந்தும்' },
  'an.alternatives': { en: 'Other Acts that scored closely', ta: 'ஏறக்குறைய சமமாக பொருந்திய பிற சட்டங்கள்' },
  'an.dept': { en: 'Recommended Department', ta: 'பரிந்துரைக்கப்பட்ட துறை' },
  'an.authority': { en: 'Recommended Officer / Authority', ta: 'பரிந்துரைக்கப்பட்ட அலுவலர்' },
  'an.why': { en: 'Why', ta: 'காரணம்' },
  'an.jurisdiction': { en: 'Jurisdiction', ta: 'அதிகார எல்லை' },
  'an.escalation': { en: 'Escalation authority', ta: 'மேல்முறையீட்டு அதிகாரி' },
  'an.nextAction': { en: 'Recommended next action', ta: 'பரிந்துரைக்கப்பட்ட நடவடிக்கை' },
  'an.workflow': { en: 'Workflow', ta: 'நடைமுறை' },
  'an.nextSteps': { en: 'Next steps', ta: 'அடுத்த நடவடிக்கைகள்' },
  'an.stepDone': { en: 'Completed', ta: 'முடிந்தது' },
  'an.stepNow': { en: 'Current step', ta: 'தற்போதைய படி' },
  'an.stepNext': { en: 'Pending', ta: 'நிலுவையில்' },
  'an.wfNote': { en: 'Generated from this petition’s own analysis. The officer decides each step.', ta: 'இந்த மனுவின் பகுப்பாய்விலிருந்து உருவாக்கப்பட்டது. ஒவ்வொரு படியையும் அலுவலர் தீர்மானிக்கிறார்.' },
  'an.requiredDocs': { en: 'Required documents', ta: 'தேவையான ஆவணங்கள்' },
  'an.priority': { en: 'priority', ta: 'முன்னுரிமை' },
  'an.URGENT': { en: 'URGENT', ta: 'அவசரம்' },
  'an.HIGH': { en: 'HIGH', ta: 'உயர்' },
  'an.NORMAL': { en: 'NORMAL', ta: 'இயல்பு' },
  'an.LOW': { en: 'LOW', ta: 'குறைவு' },
  'an.priorityWhy': { en: 'Priority reasoning', ta: 'முன்னுரிமை காரணம்' },
  'an.missing': { en: 'Missing information', ta: 'இல்லாத தகவல்' },
  'an.flow': { en: 'Reasoning flow', ta: 'பகுப்பாய்வு வழி' },
  'an.noAct': { en: 'No Act in the configured knowledge base matched this petition, so none is suggested. An administrator can add the relevant Act in AI Knowledge Configuration.', ta: 'கட்டமைக்கப்பட்ட அறிவுத் தளத்தில் இந்த மனுவுக்குப் பொருந்தும் சட்டம் எதுவும் காணப்படவில்லை. நிர்வாகி தொடர்புடைய சட்டத்தை சேர்க்கலாம்.' },
  'an.noDept': { en: 'No department matched. The officer is to determine the concerned department.', ta: 'பொருந்தும் துறை காணப்படவில்லை. அலுவலர் தீர்மானிக்க வேண்டும்.' },
  'an.noAuth': { en: 'No officer or authority is configured for this matter.', ta: 'இந்த விவகாரத்திற்கு அலுவலர் யாரும் கட்டமைக்கப்படவில்லை.' },
  'an.nothingMissing': { en: 'Nothing was flagged. The officer should still verify the particulars with the petitioner.', ta: 'எதுவும் குறிக்கப்படவில்லை. இருப்பினும் மனுதாரரிடம் விவரங்களை சரிபார்க்கவும்.' },
  'an.unverified': { en: 'This knowledge-base entry has not been verified against the Gazette. Confirm the provision before relying on it.', ta: 'இந்த அறிவுத் தளப் பதிவு அரசிதழுடன் சரிபார்க்கப்படவில்லை. நம்பும் முன் விதியை உறுதிப்படுத்தவும்.' },


  // Labels that were written inline in AnalysisPanel's markup.
  'an.lblSectionWord': { en: 'Section', ta: 'பிரிவு' },
  'an.lblAct': { en: 'Act', ta: 'சட்டம்' },
  'an.lblFullTitle': { en: 'Full title', ta: 'முழு தலைப்பு' },
  'an.lblReference': { en: 'Reference', ta: 'குறிப்பு' },
  'an.lblSectionDt': { en: 'Section / provision', ta: 'பிரிவு' },
  'an.lblOffice': { en: 'Office', ta: 'அலுவலகம்' },

  // ------------------------------------------------- workflow stages
  'wfs.title':       { en: 'Petition progress', ta: 'மனு முன்னேற்றம்்' },
  'wfs.advance':     { en: 'Move to',           ta: 'அடுத்த நிலைக்கு நகர்த்து' },
  'wfs.setStage':    { en: 'Set the stage',     ta: 'நிலையை அமைக்கவும்' },
  'wfs.saving':      { en: 'Saving…',           ta: 'சேமிக்கிறது…' },
  'wfs.optional':    { en: 'if required',       ta: 'தேவைப்பட்டால்' },
  'wfs.showHistory': { en: 'History',           ta: 'வரலாறு' },
  'wfs.hideHistory': { en: 'Hide history',      ta: 'வரலாற்றை மறை' },
  'wfs.note': {
    en: 'A stage changes only when an officer records it. Every change is kept with the officer’s name.',
    ta: 'அலுவலர் பதிவு செய்தால் மட்டுமே நிலை மாறும். ஒவ்வொரு மாற்றமும் அதைச் செய்த அலுவலர் பெயருடன் பதிவு செய்யப்படும்.',
  },
  'lang.ta':            { en: 'Tamil',   ta: 'தமிழ்' },
  'lang.en':            { en: 'English', ta: 'ஆங்கிலம்' },
  // Priority is a closed set, so its names are a lookup, not a translation.
  'prio.URGENT':        { en: 'URGENT', ta: 'அவசரம்' },
  'prio.HIGH':          { en: 'HIGH',   ta: 'உயர்ந்த' },
  'prio.NORMAL':        { en: 'NORMAL', ta: 'இயல்பு' },
  'prio.LOW':           { en: 'LOW',    ta: 'குறைந்த' },
  'dash.formHint':      {
    en: 'The document is read and analysed automatically once submitted. The petition appears in the table immediately.',
    ta: 'சமர்ப்பித்தவுடன் ஆவணம் தானாகப் படிக்கப்பட்டு பகுப்பாய்வு செய்யப்படும். மனு உடனடியாக பட்டியலில் தோன்றும்.',
  },
  'feed.petitionAnalysing': { en: 'AI analysis running…', ta: 'AI பகுப்பாய்வு நடைபெறுகிறது நடைபெறுகிறது…' },
  'feed.petitionAnalysed':  { en: 'Analysed',            ta: 'பகுப்பாய்வு முடிந்தது' },
  'feed.petitionUpdated':   { en: 'updated',             ta: 'புதுப்பிக்கப்பட்டது' },
  'feed.newPetition':       { en: 'New petition',        ta: 'புதிய மனு' },
  'feed.documentRead':      { en: 'Document read',       ta: 'ஆவணம் படிக்கப்பட்டது' },
  'dash.liveEvents':    { en: 'live events',  ta: 'நேரலை நிகழ்வுகள்' },
  'dash.liveEvent':     { en: 'live event',   ta: 'நேரலை நிகழ்வு' },
  'dash.noActMatched':  { en: 'No Act matched', ta: 'பொருந்தும் சட்டம் இல்லை' },
  'dash.translated':    { en: 'translated', ta: 'மொழிபெயர்க்கப்பட்டது' },
  'dash.pickFile':      { en: 'Please select a file to upload.', ta: 'பதிவேற்ற ஒரு கோப்பைத் தேர்ந்தெடுக்கவும்.' },
  'dash.uploadFailed':  { en: 'Upload failed. Please try again.', ta: 'பதிவேற்றம் தோல்வியடைந்தது. மீண்டும் முயற்சிக்கவும்க்கவும்.' },
  'dash.processing':    { en: 'Processing…',  ta: 'செயலாக்கத்தில்…' },
  'dash.pleaseWait':    { en: 'Please wait — this usually takes 10–30 seconds', ta: 'காத்திருக்கவும் — பொதுவாக 10–30 வினாடிகள் ஆகும்' },
  'dash.phaseUploading':{ en: 'Saving petition…', ta: 'மனு சேமிக்கப்படுகிறது…' },
  'dash.phaseOcr':      { en: 'Reading the document…', ta: 'ஆவணம் படிக்கப்படுகிறது…' },
  'dash.phaseAnalysing':{ en: 'AI is analysing the petition…', ta: 'AI மனுவை பகுப்பாய்வு செய்கிறது…' },
  'dash.reference':     { en: 'Reference',    ta: 'மனு எண்' },
  'dash.newChip':       { en: 'NEW',          ta: 'புதிய' },
  'dash.analysingText': { en: 'analysing…',   ta: 'பகுப்பாய்வு செய்கிறது…' },
  'detail.verifiedBy':  { en: 'Verified by officer', ta: 'அலுவலரால் சரிபார்க்கப்பட்டது' },
  'detail.runAnalysis': { en: 'Run AI analysis', ta: 'AI பகுப்பாய்வை இயக்கு' },
  'detail.analysing':   { en: 'Analysing…',     ta: 'பகுப்பாய்வு செய்கிறது…' },
  'detail.notAnalysed': { en: 'This petition has not been analysed yet.', ta: 'இந்த மனு இன்னும் பகுப்பாய்வு செய்யப்படவில்லை.' },
  'detail.analysisDone': {
    en: 'AI analysis complete. Every field below is a recommendation requiring your verification.',
    ta: 'AI பகுப்பாய்வு முடிந்தது. கீழே உள்ள ஒவ்வொரு விவரமும் பரிந்துரை மட்டுமே; அலுவலர் சரிபார்ப்பு தேவை.',
  },
  'detail.downloadFile':{ en: 'Download the file', ta: 'கோப்பைப் பதிவிறக்கு' },
  'detail.loadFailed': { en: 'The document could not be loaded.', ta: 'ஆவணத்தை ஏற்ற முடியவில்லை.' },


  // ------------------------------------------------------------------- app
  'app.title':    { en: 'Grievance Management Portal', ta: 'குறைதீர்ப்பு மேலாண்மை வாயில்' },
  'app.subtitle': {
    en: 'AI-Assisted Grievance Processing — Officer Console',
    ta: 'AI உதவியுடன் குறைதீர்ப்பு செயலாக்கம் — அலுவலர் பணியகம்',
  },
  'app.role':     { en: 'Grievance Officer', ta: 'குறைதீர்ப்பு அலுவலர்' },

  // ------------------------------------------------------------------- nav
  'nav.petitions': { en: 'Petitions',      ta: 'மனுக்கள்' },
  'nav.copilot':   { en: 'e-Gov Copilot',  ta: 'மின்-ஆளுமை துணை' },

  // ------------------------------------------------------------- dashboard
  'dash.title':     { en: 'Incoming Petitions', ta: 'வரப்பெற்ற மனுக்கள்' },
  'dash.lede':      {
    en: 'Grievances received at the office · receiving live updates',
    ta: 'அலுவலகத்தில் பெறப்பட்ட குறைகள் · நேரலை புதுப்பிப்புகள்',
  },
  'dash.upload':    { en: '+ Upload Petition / Letter', ta: '+ மனு / கடிதம் பதிவேற்று' },
  'dash.total':     { en: 'Total petitions',    ta: 'மொத்த மனுக்கள்' },
  'dash.awaiting':  { en: 'Awaiting AI analysis', ta: 'AI பகுப்பாய்வு நடைபெறுகிறது நிலுவையில்' },
  'dash.analysed':  { en: 'Analysed',           ta: 'பகுப்பாய்வு செய்யப்பட்டது' },
  'dash.verified':  { en: 'Officer verified',   ta: 'அலுவலர் சரிபார்த்தது' },
  'dash.searchPlaceholder': {
    en: 'Reference number, subject or citizen name',
    ta: 'மனு எண், பொருள் அல்லது குடிமகன் பெயர்',
  },
  'dash.petitions': { en: 'Petitions',   ta: 'மனுக்கள்' },
  'dash.empty':     { en: 'No petitions yet.', ta: 'இதுவரை மனுக்கள் இல்லை.' },

  // ---------------------------------------------------------------- table
  'col.reference':  { en: 'Reference',    ta: 'மனு எண்' },
  'col.citizen':    { en: 'Citizen',      ta: 'குடிமகன்' },
  'col.subject':    { en: 'Subject',      ta: 'பொருள்' },
  'col.status':     { en: 'Status',       ta: 'நிலை' },
  'col.suggestion': { en: 'AI suggestion', ta: 'AI பரிந்துரை' },
  'col.docs':       { en: 'Docs',         ta: 'ஆவணங்கள்' },
  'col.received':   { en: 'Received',     ta: 'பெறப்பட்டது' },
  'col.document':   { en: 'Document',     ta: 'ஆவணம்' },
  'col.extraction': { en: 'Text extraction', ta: 'உரை படித்தல்' },
  'col.uploaded':   { en: 'Uploaded',     ta: 'பதிவேற்றப்பட்டது' },

  // --------------------------------------------------------------- status
  'status.SUBMITTED':    { en: 'Submitted',    ta: 'சமர்ப்பிக்கப்பட்டது' },
  'status.ANALYSING':    { en: 'AI analysing', ta: 'AI பகுப்பாய்வு நடைபெறுகிறது' },
  'status.ANALYSED':     { en: 'Analysed',     ta: 'பகுப்பாய்வு முடிந்தது' },
  'status.UNDER_REVIEW': { en: 'Under review', ta: 'பரிசீலனையில்' },
  'status.ACTIONED':     { en: 'Actioned',     ta: 'நடவடிக்கை எடுக்கப்பட்டது' },
  'status.CLOSED':       { en: 'Closed',       ta: 'முடிக்கப்பட்டது' },
  'status.COMPLETED':    { en: 'Completed',    ta: 'முடிந்தது' },
  'status.PENDING':      { en: 'Pending',      ta: 'நிலுவையில்' },
  'status.PROCESSING':   { en: 'Processing',   ta: 'செயலாக்கத்தில்' },
  'status.FAILED':       { en: 'Failed',       ta: 'தோல்வியடைந்தது' },

  // -------------------------------------------------------------- detail
  'detail.backToDashboard': { en: 'Back to dashboard', ta: 'பணிமேசைக்குத் திரும்பு' },
  'detail.tabAnalysis': { en: 'AI Analysis',      ta: 'AI பகுப்பாய்வு நடைபெறுகிறது' },
  'detail.asSubmitted': { en: 'Petition as submitted', ta: 'சமர்ப்பிக்கப்பட்ட மனு' },
  'detail.subject':     { en: 'Subject',      ta: 'பொருள்' },
  'detail.description': { en: 'Description',  ta: 'விவரம்' },
  'detail.documents':   { en: 'Uploaded documents', ta: 'பதிவேற்றிய ஆவணங்கள்' },
  'detail.noDocuments': {
    en: 'No document was attached to this petition.',
    ta: 'இந்த மனுவுடன் ஆவணம் எதுவும் இணைக்கப்படவில்லை.',
  },
  'detail.noPreview':   {
    en: 'Preview is not available for this file type.',
    ta: 'இந்த வகை கோப்பிற்கு முன்னோட்டம் கிடைக்கவில்லை.',
  },

  // ---------------------------------------------------------- petitioner
  'pet.title':    { en: 'Petitioner',   ta: 'மனுதாரர்' },
  'pet.name':     { en: 'Name',         ta: 'பெயர்' },
  'pet.phone':    { en: 'Phone',        ta: 'தொலைபேசி' },
  'pet.address':  { en: 'Address',      ta: 'முகவரி' },
  'pet.language': { en: 'Language',     ta: 'மொழி' },
  'pet.received': { en: 'Received',     ta: 'பெறப்பட்டது' },
  'pet.docDate':  { en: 'Date on document', ta: 'ஆவணத்தின் தேதி' },
  'pet.reference':{ en: 'Document reference', ta: 'ஆவண குறிப்பு' },
  'pet.fromDoc':  { en: 'read from the document', ta: 'ஆவணத்திலிருந்து படிக்கப்பட்டது' },
  'pet.asWritten':{ en: 'as written in the document', ta: 'ஆவணத்தில் உள்ளபடி' },
  'pet.fromDocNote': {
    en: 'Particulars below marked “read from the document” were extracted automatically and require officer verification.',
    ta: 'கீழே “ஆவணத்திலிருந்து படிக்கப்பட்டது” எனக் குறிக்கப்பட்ட விவரங்கள் தானாக எடுக்கப்பட்டவை; அதிகாரம் பெற்றவர் சரிபார்ப்பு தேவை.',
  },

  // ------------------------------------------------------------ document
  'doc.textRead':   { en: 'Text read from the document', ta: 'ஆவணத்திலிருந்து படித்த உரை' },
  'doc.reading':    { en: 'reading…',    ta: 'படிக்கிறது…' },
  'doc.confidence': { en: 'confidence',  ta: 'துல்லியம்' },
  'doc.readingNote': {
    en: 'The document is being read. The text and analysis will appear shortly.',
    ta: 'ஆவணம் படிக்கப்படுகிறது. உரையும் பகுப்பாய்வும் விரைவில் தோன்றும்.',
  },
  'doc.readFailed': {
    en: 'The text of this document could not be read.',
    ta: 'இந்த ஆவணத்தின் உரையைப் படிக்க முடியவில்லை.',
  },
  'doc.noText':     {
    en: 'No text could be extracted from this document.',
    ta: 'இந்த ஆவணத்திலிருந்து உரை எதுவும் எடுக்க முடியவில்லை.',
  },
  'doc.lowConfidence': {
    en: 'The text was read with low confidence and may contain errors. Please read the original document.',
    ta: 'உரை குறைந்த துல்லியம்யுடன் படிக்கப்பட்டது; பிழைகள் இருக்கலாம். மூல ஆவணத்தைப் படிக்கவும்.',
  },
  'doc.charsRead':  { en: '{n} characters read.', ta: '{n} எழுத்துகள் படிக்கப்பட்டன.' },

  // ------------------------------------------------------------ analysis
  'ai.title':      { en: 'AI analysis',  ta: 'AI பகுப்பாய்வு நடைபெறுகிறது' },
  'ai.act':        { en: 'Act',          ta: 'சட்டம்' },
  'ai.department': { en: 'Department',   ta: 'துறை' },
  'ai.authority':  { en: 'Authority',    ta: 'அதிகாரம் பெற்றவர்' },
  'ai.priority':   { en: 'Priority',     ta: 'முன்னுரிமை' },
  'ai.rerun':      { en: 'Re-run analysis', ta: 'பகுப்பாய்வை மீண்டும் இயக்கு' },
  'ai.none':       { en: 'Not yet analysed', ta: 'இன்னும் பகுப்பாய்வு செய்யப்படவில்லை' },
  'ai.noneMatched':{ en: 'None matched', ta: 'பொருந்தவில்லை' },

  // -------------------------------------------------------------- copilot
  'cop.title':    { en: 'e-Gov Copilot', ta: 'மின்-ஆளுமை துணை' },
  'cop.welcome':  { en: 'How can I help?', ta: 'நான் என்ன உதவி செய்ய வேண்டும்?' },
  'cop.welcomeSub': {
    en: 'Ask about an Act, a department, a workflow — or attach a petition and ask about it.',
    ta: 'சட்டம், துறை அல்லது நடைமுறை குறித்துக் கேட்கவும் — அல்லது ஆவணத்தை இணைத்து அது பற்றிக் கேட்கவும்.',
  },
  'cop.placeholder': { en: 'Ask anything…', ta: 'எதையும் கேளுங்கள்…' },
  'cop.thinking':    { en: 'Thinking…',     ta: 'சிந்திக்கிறது…' },
  'cop.clearChat':  { en: 'Clear conversation', ta: 'உரையாடலை அழி' },
  'cop.copy':        { en: 'Copy',          ta: 'நகலெடு' },
  'cop.listen':      { en: 'Listen',        ta: 'கேட்க' },
  'cop.context':     { en: 'document in context', ta: 'ஆவணம் இணைக்கப்பட்டுள்ளது' },
  'cop.contextNote': {
    en: 'Questions are answered about the attached document until you clear the conversation.',
    ta: 'உரையாடலை அழிக்கும் வரை, இணைக்கப்பட்ட ஆவணத்தை அடிப்படையாகக் கொண்டே கேள்விகளுக்குப் பதிலளிக்கப்படும்.',
  },
  'cop.q1': { en: 'Which Act applies to a patta transfer dispute?', ta: 'பட்டா மாற்றத் தகராறுக்கு எந்த சட்டம் பொருந்தும்?' },
  'cop.q2': { en: 'Which department handles street light complaints?', ta: 'தெரு விளக்கு புகார்களை எந்தத் துறை கையாளும்?' },
  'cop.q3': { en: 'What is the workflow for a senior citizen maintenance petition?', ta: 'மூத்த குடிமக்கள் பராமரிப்பு மனுவின் நடைமுறை என்ன?' },
  'cop.q4': { en: 'How many petitions are pending?', ta: 'எத்தனை மனுக்கள் நிலுவையில் உள்ளன?' },

  // Hermes tool badge labels
  'cop.toolPetition':   { en: 'Petition',          ta: 'மனு' },
  'cop.toolKB':         { en: 'Knowledge Base',     ta: 'அறிவுத் தளம்' },
  'cop.toolWeb':        { en: 'Official Sources',   ta: 'அரசு ஆதாரங்கள்' },
  'cop.toolStats':      { en: 'Statistics',         ta: 'புள்ளிவிவரம்' },
  'cop.sourcesLabel':   { en: 'Sources:',           ta: 'ஆதாரங்கள்:' },
  'cop.mixedHint':      {
    en: 'Question uses both Tamil and English — responding in the console language.',
    ta: 'கேள்வியில் தமிழும் ஆங்கிலமும் கலந்துள்ளன — நீங்கள் தேர்ந்தெடுத்த மொழியில் பதில் வழங்கப்படும்.',
  },

  // Confidence tier descriptions
  'cop.highConf': {
    en: 'HIGH — petition, knowledge base, and official sources all grounded this answer.',
    ta: 'உயர்ந்த — மனு, அறிவுத் தளம் மற்றும் அதிகாரப்பூர்வ ஆதாரங்கள் அனைத்தும் பயன்படுத்தப்பட்டன.',
  },
  'cop.medConf': {
    en: 'MEDIUM — reasonable match; verify the Act and department before acting.',
    ta: 'நடுத்தரம் — ஓரளவு பொருந்துகிறது; நடவடிக்கைக்கு முன் சட்டத்தையும் துறையையும் சரிபார்க்கவும்.',
  },
  'cop.lowConf': {
    en: 'LOW — weak match; please verify every field against the source document.',
    ta: 'குறைந்தது — பொருத்தம் வலுவற்றது; ஒவ்வொரு விவரத்தையும் மூல ஆவணத்துடன் சரிபார்க்கவும்.',
  },

  'cop.subtitle': {
    en: 'Document reading and AI analysis — Tamil and English',
    ta: 'ஆவணம் படித்தல் மற்றும் AI பகுப்பாய்வு — தமிழ் மற்றும் ஆங்கிலம்',
  },
  'cop.upload':     { en: 'Upload a document', ta: 'ஆவணம் பதிவேற்று' },
  'cop.drop':       { en: 'Drop a file here, or click to choose', ta: 'கோப்பை இங்கே இழுத்துவிடவும், அல்லது தேர்ந்தெடுக்க சொடுக்கவும்' },
  'cop.accepts':    {
    en: 'PDF, Word (.doc/.docx), JPG, PNG or plain text · up to 15 MB',
    ta: 'PDF, Word (.doc/.docx), JPG, PNG அல்லது உரை · அதிகபட்சம் 15 MB',
  },
  'cop.scanNote':   {
    en: 'A scanned document is read in Tamil and English.',
    ta: 'ஸ்கேன் செய்யப்பட்ட ஆவணம் தமிழ் மற்றும் ஆங்கில எழுத்துகளில் படிக்கப்படும்.',
  },
  'cop.analyse':    { en: 'Analyse document', ta: 'ஆவணத்தை பகுப்பாய்வு செய்' },
  'cop.uploading':  { en: 'Uploading…',       ta: 'பதிவேற்றுகிறது…' },
  'cop.clear':      { en: 'Clear',            ta: 'அழி' },
  'cop.progress':   { en: 'Progress',         ta: 'முன்னேற்றம்' },
  'cop.ask':        { en: 'Ask a question',   ta: 'கேள்வி கேட்கவும்' },
  'cop.backToPetitions': { en: 'Back to Petitions', ta: 'மனுக்களுக்குத் திரும்பு' },
  'cop.stageUpload':  { en: 'Uploading',      ta: 'பதிவேற்றம்' },
  'cop.stageExtract': { en: 'Reading text',   ta: 'உரை படித்தல்' },
  'cop.stageAnalyse': { en: 'AI analysis',    ta: 'AI பகுப்பாய்வு நடைபெறுகிறது' },
  'cop.stageDone':    { en: 'Complete',       ta: 'முடிந்தது' },
  'cop.working':      { en: 'not added to the petition queue', ta: 'இது மனுப் பட்டியலில் சேர்க்கப்படாது' },
  'cop.tooLarge':     { en: 'That file is too large. The limit is 15 MB.', ta: 'கோப்பு மிகப் பெரியது. வரம்பு 15 MB.' },
  'cop.uploadFailed': { en: 'The document could not be uploaded.', ta: 'ஆவணத்தைப் பதிவேற்ற முடியவில்லை.' },
  'cop.analyseFailed':{ en: 'The document could not be analysed.', ta: 'ஆவணத்தை பகுப்பாய்வு செய்ய முடியவில்லை.' },


  // ---------------------------------------------------------- e-Gov agent
  'agent.title':      { en: 'e-Gov AI Agent', ta: 'மின்-ஆளுமை AI உதவியாளர்' },
  'agent.welcome':    { en: 'How Can I Help You', ta: 'நான் எவ்வாறு உதவ முடியும்' },
  'agent.welcomeSub': {
    en: 'Attach a petition — PDF, Word or a photograph — and I will read and analyse it.',
    ta: 'ஒரு மனுவை இணைக்கவும் — PDF, Word அல்லது புகைப்படம் — நான் படித்து பகுப்பாய்வு செய்கிறேன்.',
  },
  'agent.placeholder':     { en: 'Message…', ta: 'செய்தி…' },
  'agent.placeholderFile': { en: 'Add a note, or press send to analyse…', ta: 'குறிப்பு சேர்க்கவும், அல்லது பகுப்பாய்வு செய்ய அனுப்பவும்…' },
  'agent.attach':     { en: 'Attach a document', ta: 'ஆவணம் இணைக்கவும்' },
  'agent.tools':      { en: 'Tools', ta: 'கருவிகள்' },
  'agent.send':       { en: 'Send', ta: 'அனுப்பு' },
  'agent.analyseThis':{ en: 'Analyse this document', ta: 'இந்த ஆவணத்தை பகுப்பாய்வு செய்' },
  'agent.hint': {
    en: 'PDF, Word, JPG or PNG · up to 15 MB · documents are read on the server',
    ta: 'PDF, Word, JPG அல்லது PNG · அதிகபட்சம் 15 MB · ஆவணங்கள் சேவையகத்தில் படிக்கப்படுகின்றன',
  },

  // progress states, keyed to real server stages
  'agent.stageUpload':     { en: 'Uploading the document…', ta: 'ஆவணம் பதிவேற்றப்படுகிறது…' },
  'agent.stageRead':       { en: 'Reading the document…', ta: 'ஆவணம் படிக்கப்படுகிறது…' },
  'agent.stageUnderstand': { en: 'Understanding the petition…', ta: 'மனு புரிந்து கொள்ளப்படுகிறது…' },
  'agent.stageClassify':   { en: 'Identifying the department and section…', ta: 'துறை மற்றும் பிரிவு கண்டறியப்படுகிறது…' },
  'agent.stageWorkflow':   { en: 'Determining the next workflow…', ta: 'அடுத்த பணிப்பாய்வு தீர்மானிக்கப்படுகிறது…' },

  // reply sections
  'agent.secSummary':  { en: 'Document summary', ta: 'ஆவணச் சுருக்கம்' },
  'agent.secDept':     { en: 'Recommended department', ta: 'பரிந்துரைக்கப்பட்ட துறை' },
  'agent.secAct':      { en: 'Relevant Act / law', ta: 'பொருந்தும் சட்டம்' },
  'agent.secIssue':    { en: 'Issue classification', ta: 'பிரச்சினை வகைப்பாடு' },
  'agent.secSupport':  { en: 'Supporting information', ta: 'துணைத் தகவல்' },
  'agent.requiredDocs':{ en: 'Documents required', ta: 'தேவையான ஆவணங்கள்' },
  'agent.jurisdiction':{ en: 'Jurisdiction', ta: 'அதிகார எல்லை' },
  // Closed sets defined by the schema, so these are lookups, not translations.
  'pri.HIGH':          { en: 'HIGH',     ta: 'உயர்ந்த' },
  'pri.NORMAL':        { en: 'NORMAL',   ta: 'இயல்பு' },
  'pri.LOW':           { en: 'LOW',      ta: 'குறைந்த' },
  'ver.VERIFIED':      { en: 'VERIFIED', ta: 'சரிபார்க்கப்பட்டது' },
  'ver.AUTO_VERIFIED': { en: 'AUTO-VERIFIED', ta: 'தானாக சரிபார்க்கப்பட்டது' },
  'ver.UNVERIFIED':    { en: 'UNVERIFIED', ta: 'சரிபார்க்கப்படவில்லை' },
  'jur.STATE':         { en: 'State',    ta: 'மாநிலம்' },
  'jur.DISTRICT':      { en: 'District', ta: 'மாவட்டம்' },
  'jur.TALUK':         { en: 'Taluk',    ta: 'வட்டம்' },
  'jur.BLOCK':         { en: 'Block',    ta: 'ஒன்றியம்' },
  'jur.VILLAGE':       { en: 'Village',  ta: 'கிராமம்' },
  'jur.ZONE':          { en: 'Zone',     ta: 'மண்டலம்' },
  'jur.WARD':          { en: 'Ward',     ta: 'வார்டு' },
  'jur.NATIONAL':      { en: 'National', ta: 'தேசிய' },
  'agent.dates':       { en: 'Dates found',   ta: 'கண்டறிந்த தேதிகள்' },
  'agent.places':      { en: 'Places found',  ta: 'கண்டறிந்த இடங்கள்' },
  'agent.amounts':     { en: 'Amounts found', ta: 'கண்டறிந்த தொகைகள்' },
  'agent.confTitle':   { en: 'AI confidence', ta: 'AI துல்லியம்' },
  'agent.verifyChip':  { en: 'Officer verification required', ta: 'அதிகாரம் பெற்றவர் சரிபார்ப்பு தேவை' },
  'agent.conf.high':   {
    en: 'Strong match against the configured knowledge base.',
    ta: 'கட்டமைக்கப்பட்ட அறிவுத் தளத்துடன் வலுவான பொருத்தம்.',
  },
  'agent.conf.medium': {
    en: 'Reasonable match — check the Act and department before acting.',
    ta: 'ஓரளவு பொருத்தம் — நடவடிக்கைக்கு முன் சட்டத்தையும் துறையையும் சரிபார்க்கவும்.',
  },
  'agent.conf.low':    {
    en: 'Weak match — please verify every field against the document.',
    ta: 'பொருத்தம் வலுவற்றது — ஒவ்வொரு விவரத்தையும் மூல ஆவணத்துடன் சரிபார்க்கவும்.',
  },
  'agent.secDetails':  { en: 'Petition details', ta: 'மனு விவரங்கள்' },
  'agent.secClassify': { en: 'Government classification', ta: 'அரசு வகைப்பாடு' },
  'agent.secAction':   { en: 'Requested action', ta: 'கோரப்பட்ட நடவடிக்கை' },
  'agent.secWorkflow': { en: 'Recommended workflow', ta: 'பரிந்துரைக்கப்பட்ட பணிப்பாய்வு' },
  'agent.secMissing':  { en: 'Information not found in the document', ta: 'ஆவணத்தில் காணப்படாத தகவல்' },
  'agent.section':     { en: 'Section', ta: 'பிரிவு' },
  'agent.issue':       { en: 'Main issue', ta: 'முக்கிய பிரச்சினை' },
  'agent.request':     { en: 'Petitioner request', ta: 'மனுதாரர் கோரிக்கை' },
  'agent.showSource':  { en: 'Show the text read', ta: 'படித்த உரையைக் காட்டு' },
  'agent.verifyNote':  {
    en: 'AI recommendation — requires officer verification.',
    ta: 'AI பரிந்துரை — அதிகாரம் பெற்றவர் சரிபார்ப்பு தேவை.',
  },

  // honest failures
  'agent.notFound':        { en: 'This information was not found in the document.', ta: 'இந்த தகவல் ஆவணத்தில் காணப்படவில்லை.' },
  'agent.notIdentified':   { en: 'Not identified', ta: 'கண்டறியப்படவில்லை' },
  'agent.needsVerification': { en: 'Not identified — requires officer verification', ta: 'கண்டறியப்படவில்லை — அதிகாரம் பெற்றவர் சரிபார்ப்பு தேவை' },
  'agent.deptUnknown':     {
    en: 'Department could not be determined automatically. Please verify the classification.',
    ta: 'துறையைத் தானாகத் தீர்மானிக்க முடியவில்லை. வகைப்பாட்டைச் சரிபார்க்கவும்.',
  },
  'agent.errUnreadable':   {
    en: "I couldn't read this document. Its embedded font is damaged, so the text it stores does not match the page. Please upload it as an image or a scanned copy.",
    ta: 'இந்த ஆவணத்தைப் படிக்க முடியவில்லை. அதன் எழுத்துரு சேதமடைந்துள்ளது. படமாக அல்லது ஸ்கேன் செய்த நகலாகப் பதிவேற்றவும்.',
  },
  'agent.errUpload':  { en: 'The document could not be uploaded.', ta: 'ஆவணத்தைப் பதிவேற்ற முடியவில்லை.' },
  'agent.errAnswer':  { en: 'I could not answer that just now.', ta: 'இப்போது அதற்குப் பதிலளிக்க முடியவில்லை.' },
  'agent.tooLarge':   { en: 'That file is too large. The limit is 15 MB.', ta: 'கோப்பு மிகப் பெரியது. வரம்பு 15 MB.' },
  'agent.attachAnother': { en: '📎 Attach another document', ta: '📎 வேறு ஆவணத்தை இணைக்கவும்' },
  'agent.ok':         { en: 'OK — back to dashboard', ta: 'சரி — பணிமேசைக்குத் திரும்பு' },
  'agent.download':   { en: '⬇ Download report (PDF)', ta: '⬇ அறிக்கையைப் பதிவிறக்கு (PDF)' },
  'agent.preparing':  { en: 'Preparing…',  ta: 'தயாரிக்கிறது…' },
  'agent.errDownload':{ en: 'The report could not be produced.', ta: 'அறிக்கையை உருவாக்க முடியவில்லை.' },

  // ---------------------------------------------------------------- login
  'login.title':    { en: 'Sign in',      ta: 'உள்நுழை' },
  'login.username': { en: 'Username',     ta: 'பயனர் பெயர்' },
  'login.password': { en: 'Password',     ta: 'கடவுச்சொல்' },
  'login.submit':   { en: 'Sign in',      ta: 'உள்நுழை' },
  'login.failed':   { en: 'Sign in failed. Check the username and password.', ta: 'உள்நுழைவு தோல்வியடைந்தது. பயனர் பெயர் மற்றும் கடவுச்சொல்லைச் சரிபார்க்கவும்.' },
  'login.demo':     { en: 'Demo credentials:', ta: 'சோதனை அனுமதி விவரங்கள்:' },
  'login.poc':      { en: 'PROOF OF CONCEPT — demonstration environment', ta: 'கருத்து சான்று — விளக்கச் சூழல்' },
};

// ------------------------------------------------------------------ context
interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function readStoredLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'ta' || v === 'en') return v;
  } catch { /* private mode - fall through to the default */ }
  return 'en';
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* not essential */ }
    // Keep the document language in step, for screen readers and font choice.
    document.documentElement.lang = l === 'ta' ? 'ta' : 'en';
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === 'ta' ? 'ta' : 'en';
  }, [lang]);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    const entry = STRINGS[key];
    // An unknown key renders as itself, so a gap is visible rather than blank.
    let out = entry ? (entry[lang] || entry.en) : key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return out;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/**
 * Pick the right half of a bilingual value returned by the server.
 *
 * Act names, departments and analysis prose already arrive as { en, ta } from
 * the knowledge base. This selects by the current UI language and falls back
 * to English, so a record with no Tamil name still shows a name.
 */
export function useBilingual() {
  const { lang } = useI18n();
  return useCallback(
    (b: { en?: string; ta?: string } | string | null | undefined, fallback = '—') => {
      if (!b) return fallback;
      if (typeof b === 'string') return b;
      return b[lang] || b.en || b.ta || fallback;
    },
    [lang],
  );
}

/** The language toggle, used in the console header. */
export function LanguageToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      <button
        className={lang === 'en' ? 'on' : ''}
        onClick={() => setLang('en')}
        aria-pressed={lang === 'en'}
      >
        English
      </button>
      <button
        className={lang === 'ta' ? 'on' : ''}
        onClick={() => setLang('ta')}
        aria-pressed={lang === 'ta'}
      >
        தமிழ்
      </button>
    </div>
  );
}
