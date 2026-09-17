/**
 * Extract the petitioner's particulars from a document's text.
 *
 * Runs entirely on the server, on text that OCR has already produced, and
 * returns only what it can actually find. Every field is optional and every
 * field carries the exact snippet it was taken from, so an officer can check
 * the extraction against the document rather than trusting it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not guess. A name is reported only when it follows a form of address
 * a Tamil Nadu petition actually uses (திருமதி / திரு / Thiru / Tmt), or an
 * explicit "Name:" label. A phone number is reported only when it is a valid
 * ten-digit Indian mobile number. Where nothing matches, the field comes back
 * null and the UI shows a dash.
 *
 * That restraint is the point: a case record carrying an invented name or a
 * number assembled from a survey reference would be worse than an empty field,
 * because an officer would act on it. Tamil Nadu petitions also routinely name
 * the respondent and the issuing officer alongside the petitioner, so a
 * greedy "first capitalised words" rule would frequently attribute the case to
 * the wrong person.
 */

export interface ExtractedField<T = string> {
  value: T;
  /** The text this was taken from, so the officer can verify it. */
  evidence: string;
  /** How the value was identified, for the audit trail. */
  matched_by: string;
}

export interface PetitionerDetails {
  name: ExtractedField | null;
  phone: ExtractedField | null;
  address: ExtractedField | null;
  document_date: ExtractedField | null;
  /** Reference numbers found on the document (ப.மு., file no). */
  reference: ExtractedField | null;
  /** The petition's own subject line ("பொருள்: …" / "Subject: …"). */
  subject: ExtractedField | null;
}

const TAMIL = /[஀-௿]/;

/** Collapse OCR whitespace without losing line structure. */
function lines(text: string): string[] {
  return String(text || '')
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    // Page markers inserted by the PDF extractor are scaffolding, not content.
    .filter((l) => !/^---\s*Page\s+\d+\s*---$/i.test(l));
}

function clean(s: string): string {
  return String(s || '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,;:\-–—.\s]+$/, '')
    .trim();
}

/**
 * Trim the grammatical particle that introduces the following phrase.
 *
 * "வழுக்குப்பாறை, நாச்சிபாளையம், நெ. 1108 என்ற" ends with "என்ற" ("of the"),
 * which belongs to "என்ற முகவரியில்" - the address phrase - not to the address.
 */
function trimParticle(s: string): string {
  return clean(String(s || '').replace(/\s*(?:என்ற|எனும்|என்கிற)\s*$/, ''));
}

// ------------------------------------------------------------------- name
/*
 * Tamil and English honorifics used on petitions. The name follows the
 * honorific, which is what makes this safe: the honorific is the evidence that
 * the following words really are a person's name.
 */
// OCR mangles the first character of திருமதி often enough that a near-miss
// ('இருமதி') must still be recognised as a form of address.
const HONORIFIC_TA =
  '(?<![\u0B80-\u0BFF])(?:திருமதி|திரு|செல்வி|செல்வன்|டாக்டர்|[இஐடத]ருமதி|[இஐடத]ரு(?=\s*\.))';
const HONORIFIC_EN = '(?:Thiru|Tmt|Selvi|Mr|Mrs|Ms|Dr|Smt|Sri|Shri)';

/**
 * A Tamil name run.
 *
 * Tamil names carry initials and dots (ரா.மாருதிப்பிரியா), so dots and spaces
 * are allowed inside the run, but it stops at punctuation that ends a clause.
 */
const TA_NAME_RUN = '[\\u0B80-\\u0BFF][\\u0B80-\\u0BFF.\\s]{1,60}';
const EN_NAME_RUN = '[A-Z][A-Za-z.\\s]{1,60}';

/**
 * Remove a leading form of address from a captured name.
 *
 * "திருமதி. அய்யாத்தாள்" is recorded as "அய்யாத்தாள்" - the honorific is a form
 * of address, not part of the person's name, and keeping it would make the two
 * spellings of the same petitioner look like different people.
 *
 * OCR frequently mangles the first character of திருமதி (it was read as
 * "இருமதி" on a real scan), so a near-miss is accepted: any word ending in
 * "ருமதி" / "ிரு" that precedes a longer name run is treated as an honorific.
 */
function stripHonorific(s: string): string {
  const out = String(s || '')
    .replace(
      /^\s*(?:திருமதி|திரு|செல்வி|செல்வன்|[஀-௿]{0,2}ருமதி|[஀-௿]{0,2}ரு(?=\s*\.))\s*\.?\s*/,
      '',
    )
    .replace(/^\s*(?:Thiru|Tmt|Selvi|Mr|Mrs|Ms|Dr|Smt|Sri|Shri)\s*\.?\s*/i, '');
  // Never strip so much that nothing usable is left.
  return clean(out).length >= 2 ? clean(out) : clean(s);
}

/**
 * The "From:" block a letter opens with.
 *
 * Most petitions are laid out as
 *
 *     From:   ரவி குமார்
 *             12 காந்தி தெரு, பீளமேடு, கோயம்புத்தூர் - 641004
 *     To:     The District Collector
 *
 * The sender's name is on the From line and the address on the lines beneath
 * it, up to the next block ("To:", "Subject:", "பொருள்:"). Nothing else in the
 * document identifies the petitioner as reliably, so this is read first.
 *
 * Returns both parts together because they are found by the same structure -
 * splitting the two would mean walking the block twice with different rules
 * and risking them disagreeing about where it ends.
 */
/*
 * A Tamil petition heads its sender block with a COMMA, not a colon:
 *
 *     அனுப்புநர் ,
 *     ஹரீஸ்
 *     80/33 சித்தாப்புதூர் , கோயம்புத்தூர் , …
 *
 * Requiring a colon meant that entire form was skipped, and the extractor fell
 * through to a weaker guess that picked the SUBJECT line up as the
 * petitioner's name. A comma, a full stop, or nothing at all before the line
 * break are all accepted now - the label itself is the evidence, not the
 * punctuation that happens to follow it.
 *
 * The separator stays optional rather than becoming `.*`, so an ordinary
 * sentence containing the word "from" cannot open a sender block.
 */
const FROM_LABEL =
  /^\s*(?:from|அனுப்புநர்|இருந்து)\s*[:：,.।]?\s*(.*)$/i;
/*
 * Where the sender block stops.
 *
 * Besides the obvious "To:"/"Subject:", a date or a file reference on its own
 * line ends it too - those belong to the letter, not to the sender, and
 * without them listed here "நாள்: 15.09.2026" was absorbed into the address.
 */
const BLOCK_END =
  /^\s*(?:to|subject|sub|ref|ப[பெொ]*றுநர்|ப[பெொ]*ருள்|விஷயம்|மாண்புமிகு|மதிப்பிற்குரிய|நாள்|தேதி|date|dated|ப\.மு|ந\.க|file\s*no)\s*[:：.,]?/i;

/*
 * A second, looser end-of-block test for OCR damage.
 *
 * "To:" came back as "1௦:" from a real scan - a digit and a Tamil numeral - so
 * the recipient line was read as part of the sender's address. Any very short
 * token followed by a colon, sitting in front of an address-like phrase, ends
 * the block: a genuine address line does not begin that way.
 */
const BLOCK_END_LOOSE = /^\s*\S{1,3}[:：]\s*(?:the\s|district|collector|commissioner|மாவட்ட)/i;

/*
 * Lines inside the sender block that belong to their own field.
 *
 * Age, mobile, Aadhaar, email and PAN are all written under the address in a
 * Tamil petition. They are skipped when the address is assembled, so the
 * address is an address. The Tamil labels are matched loosely because OCR
 * damages their vowel signs ("கைபேசி" came back as "க கபசி").
 */
/*
 * `\b` is deliberately NOT used here: in JavaScript a Tamil letter is not a
 * word character, so `வயது\b` never matches and every one of these lines was
 * still being swallowed into the address. The trailing colon is the anchor
 * instead, which is what these labelled lines actually have in common.
 */
const OWN_FIELD_LINE =
  /*
   * The Tamil labels are matched on the consonant skeleton that survives a
   * damaged font, because the vowel signs are exactly what such fonts lose.
   * One real document rendered "கைபேசி" as "ககசபசி" - க க ச ப ச ி - so a
   * pattern expecting "கை...பே...சி" missed it and the phone line was joined
   * onto the petitioner's address.
   *
   * `[கசப]` covers the letters these fonts substitute for one another; the
   * trailing "சி" is the stable part of the word in every variant seen.
   */
  /*
   * Matched on the CONSONANT SKELETON, so both the correct spelling and the
   * damaged one are recognised.
   *
   * The same label reaches this code two ways: "கைபேசி" when the page was read
   * by OCR, and "ககசபசி" when it came from a PDF whose font map had dropped the
   * vowel signs. An earlier pattern handled only the damaged form and then
   * missed the correct one, so a clean extraction had the phone line appended
   * to the petitioner's address.
   *
   * `[கைபேசிகச]` accepts either, and the trailing "சி" is the part that is
   * stable across every variant seen.
   */
  /^\s*(?:வயது|age|[கைபேசிகச]{2,8}\s*சி|தொ?லை?\s*[பே]{0,2}சி|அலை?\s*[பே]{0,2}சி|phone|mobile|cell|ஆ[தெ]?[ாொ]?[ரா]ர்|aadhaar|aadhar|uid|email|e-?mail|மின்னஞ்சல்|pan)\s*(?:எண்|no\.?|number)?\s*[:：]/i;

function findFromBlock(ls: string[]): { name?: ExtractedField; address?: ExtractedField } {
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(FROM_LABEL);
    if (!m) continue;

    const firstLine = clean(m[1]);
    const rest: string[] = [];
    for (let j = i + 1; j < ls.length && rest.length < 4; j++) {
      if (BLOCK_END.test(ls[j]) || BLOCK_END_LOOSE.test(ls[j]) || FROM_LABEL.test(ls[j])) break;
      const line = clean(ls[j]);
      if (!line) break;
      /*
       * Particulars that sit inside the sender block but are NOT the address.
       *
       * A Tamil petition lists age, mobile and Aadhaar directly under the
       * address, and joining the block wholesale produced an "address" reading
       * "80/33 Sithapudhur, Coimbatore, …, Age : 23, Mobile : +91 93441 74752".
       * Each of these is its own field - the phone is extracted separately, and
       * an Aadhaar number must never be copied into an address - so they are
       * skipped here while the walk continues past them.
       */
      if (OWN_FIELD_LINE.test(line)) continue;
      rest.push(line);
    }

    /*
     * The name is the first line of the block when it carries one. Where the
     * From line is empty (the name wrapped to the next line), the first
     * following line is the name instead.
     */
    let nameLine = firstLine || rest.shift() || '';
    const out: { name?: ExtractedField; address?: ExtractedField } = {};

    /*
     * OCR often loses the line breaks inside an indented block, so the whole
     * of "From: ரவி குமார்  12 காந்தி தெரு, …  கைபேசி: 9840012345" arrives as
     * one line. Split it where the address begins - the first door/plot number
     * or the first contact label - so the name is not swallowed by it.
     */
    if (!rest.length) {
      /*
       * Split at a DOOR NUMBER - one to five digits followed by a separator or
       * a word - not at any digit. OCR misreads letters as digits inside Tamil
       * words ("கைபேசி" came back as "கைபே9ி"), and splitting there cut the
       * address in half and left the remainder to be mistaken for one.
       */
      const split = nameLine.match(
        /^(.{2,60}?)[\s,]+(\d{1,5}[\s,/-]\s*\S.*)$/,
      );
      if (split) {
        nameLine = clean(split[1]);
        /*
         * Drop a trailing contact clause; the phone is recorded separately.
         *
         * The label itself cannot be relied on - OCR read "கைபேசி" as
         * "கைபே9ி" on a real scan - so the cut is made at the phone NUMBER,
         * together with the few characters of label in front of it.
         */
        const tail = clean(split[2])
          // Cut at the phone number, keeping at most one short label token
          // before it (the label may be misread, so it is matched loosely).
          .replace(/[,\s]*[^\s,]{0,12}[:：]\s*(?:\+?91[\s-]?)?[6-9]\d{9}\s*$/, '')
          .replace(/[,\s]*(?:\+?91[\s-]?)?[6-9]\d{9}\s*$/, '');
        if (clean(tail).length >= 6) rest.push(clean(tail));
      }
    }

    const nm = stripHonorific(nameLine);
    // A line that is mostly digits is an address or a reference, not a name.
    if (nm.length >= 2 && !/^\W*\d/.test(nm)) {
      out.name = {
        value: nm,
        evidence: clean(`${ls[i]} ${nameLine}`).slice(0, 160),
        matched_by: 'sender block',
      };
    }

    const addr = rest.join(', ').replace(/,\s*,/g, ',').trim();
    if (addr.length >= 6) {
      out.address = {
        value: trimParticle(addr),
        evidence: rest.join(' | ').slice(0, 200),
        matched_by: 'sender block',
      };
    }

    if (out.name || out.address) return out;
  }
  return {};
}

function findName(text: string, ls: string[]): ExtractedField | null {
  /*
   * 1. An explicit label is the strongest signal.
   *
   * Tamil OCR routinely drops or alters the trailing pulli (பெயர் vs பெயர்‌),
   * so the label is matched without requiring that final character. The
   * honorific is then stripped from the captured value - "திருமதி. அய்யாத்தாள்"
   * should be recorded as the name, with the form of address dropped.
   */
  const labelled = text.match(
    /(?:^|\n)\s*(?:name|பெயர|மனுதாரர்?\s*பெயர|petitioner(?:'s)?\s*name)[்‌‍]?\s*[:：]\s*([^\n]{2,80})/i,
  );
  if (labelled) {
    const v = stripHonorific(clean(labelled[1]));
    if (v.length >= 2) {
      return { value: v, evidence: clean(labelled[0]), matched_by: 'labelled field' };
    }
  }

  /*
   * 2. An honorific.
   *
   * A petition names several people - the petitioner, the respondent, and the
   * officer issuing the order. The petitioner is the one whose name appears in
   * a line that also marks them as the applicant ("என்பவர்", "மனுதாரர்",
   * "petitioner", "applicant"), so those lines are preferred. Where no line is
   * marked, the FIRST honorific in the document is taken, which is the
   * convention in these letters, and the evidence is returned so an officer can
   * see what it was based on.
   */
  const reTa = new RegExp(`${HONORIFIC_TA}\\s*\\.?\\s*(${TA_NAME_RUN})`, 'g');
  const reEn = new RegExp(`\\b${HONORIFIC_EN}\\s*\\.?\\s*(${EN_NAME_RUN})`, 'g');

  /*
   * Lines that name someone OTHER than the petitioner.
   *
   * A Tamil Nadu order names the issuing officer at the top
   * ("பிறப்பிப்பவர் : திருமதி.ரா.மாருதிப்பிரியா, பி.இ.,") and the respondent
   * in the body. Taking the first honorific attributed a real case to the
   * magistrate who issued the order rather than to the elderly woman who
   * brought it. These lines are excluded outright.
   */
  const NOT_PETITIONER =
    /பிறப்பிப்பவர்|கையொப்ப|அனுப்புந|நகல்|issued\s+by|signed|copy\s+to|before\s+the|முன்னிலை|தீர்ப்பாயம்\s*[:：]/i;

  const candidates: { value: string; evidence: string; marked: boolean }[] = [];
  for (const line of ls) {
    if (NOT_PETITIONER.test(line)) continue;
    const marked = /என்பவர்|என்பவரு|என்பவது|மனுதாரர்|petitioner|applicant|கோரியுள்ளார்|வசித்து/i.test(line);
    for (const re of [reTa, reEn]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) {
        const v = clean(m[1]);
        // A single character after an honorific is an OCR artefact, not a name.
        if (v.replace(/[.\s]/g, '').length < 2) continue;
        candidates.push({ value: v, evidence: clean(line).slice(0, 160), marked });
      }
    }
  }

  if (!candidates.length) return null;
  const chosen = candidates.find((c) => c.marked) ?? candidates[0];
  return {
    value: chosen.value,
    evidence: chosen.evidence,
    matched_by: chosen.marked ? 'honorific on a petitioner line' : 'honorific',
  };
}

// ------------------------------------------------------------------ phone
/**
 * An Indian mobile number: ten digits beginning 6-9, optionally with +91.
 *
 * The leading-digit rule matters. Petitions are full of numbers - survey
 * numbers, door numbers, file references, years - and without it a ten-digit
 * run from a land reference would be reported as the petitioner's phone.
 */
/*
 * A twelve-digit AADHAAR number must never be reported as a phone number.
 *
 * It is written in the same grouped style on the same kind of line
 * ("ஆதார் எண் : 5118 3224 4552"), and publishing one as a contact number would
 * put a national identity number into a case record and onto a printed report.
 * Any line naming Aadhaar is skipped outright.
 */
const AADHAAR_LINE = /ஆதார்|ஆெொர்|aadhaar|aadhar|uid\b/i;

/** Digits only, so a grouped number can be measured and normalised. */
const digitsOf = (s: string) => s.replace(/\D/g, '');

/**
 * Is this a plausible Indian mobile number?
 *
 * Ten digits beginning 6-9. A 91 country prefix is accepted and stripped;
 * anything longer is an identity or reference number, not a phone.
 */
function asMobile(raw: string): string | null {
  let d = digitsOf(raw);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length !== 10) return null;
  return /^[6-9]/.test(d) ? d : null;
}

function findPhone(text: string, ls: string[]): ExtractedField | null {
  /*
   * A LABELLED number, where the label may be damaged.
   *
   * Real OCR returned "க கபசி எண்" for "கைபேசி எண்" - the vowel signs were
   * lost - so matching the label literally found nothing even though the
   * number was plainly there on the line. The Tamil labels are therefore
   * matched on the consonant skeleton that survives such damage, and the bare
   * word "எண்" ("number") counts as a label in its own right.
   *
   * The digits are allowed to be grouped freely, because "+91 93441 74752" is
   * how a petitioner actually writes it, and are then validated as a mobile
   * number - which is what keeps a survey or file number out.
   */
  const LABEL = '(?:phone|mobile|cell|contact|தொ?லை?பே?சி|கை?\\s*க?பே?சி|அலை?பே?சி|எண்)';
  const labelled = new RegExp(
    `${LABEL}\\s*(?:no\\.?|number|எண்)?\\s*[:：]?\\s*((?:\\+?91[\\s-]?)?[6-9][\\d\\s-]{8,14}\\d)`,
    'i',
  );

  for (const line of ls) {
    if (AADHAAR_LINE.test(line)) continue;
    const m = line.match(labelled);
    if (!m) continue;
    const value = asMobile(m[1]);
    if (!value) continue;
    return { value, evidence: clean(m[0]), matched_by: 'labelled field' };
  }

  /*
   * UNLABELLED: a bare mobile number on its own line.
   *
   * Grouped digits are accepted here too - a petitioner writes "93441 74752"
   * as readily as "9344174752", and requiring ten contiguous digits missed the
   * grouped form entirely.
   */
  const re = /(?:\+?91[\s-]?)?([6-9]\d{4}[\s-]?\d{5})(?!\d)/g;
  for (const line of ls) {
    // Skip lines that are plainly an identity, file or order reference.
    if (AADHAAR_LINE.test(line)) continue;
    if (/ப\.மு|file\s*no|reference|ஆணை|no\.\s*\d+\/\d/i.test(line)) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      const value = asMobile(m[1]);
      if (value) {
        return {
          value,
          evidence: clean(line).slice(0, 160),
          matched_by: 'mobile number pattern',
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- address
/*
 * Address markers. A Tamil petition states the address as "<place>, <village>,
 * <door no> என்ற முகவரியில் வசித்து வரும்" - literally "residing at the address".
 * That phrase is the reliable anchor.
 */
const ADDRESS_ANCHOR_TA = /(?:என்ற\s*முகவரியில்|முகவரி|வசித்து\s*வரும்|குடியிருப்பு)/;
const ADDRESS_ANCHOR_EN = /(?:residing\s+at|address|r\/o\b|resident\s+of)/i;

function findAddress(text: string, ls: string[]): ExtractedField | null {
  const labelled = text.match(
    /(?:^|\n)\s*(?:address|முகவரி)[்‌‍]?\s*[:：]\s*([^\n]{5,160})/i,
  );
  if (labelled) {
    // OCR sometimes doubles the separator ("முகவரி: : 12 காந்தி தெரு"), which
    // left a stray colon at the front of the recorded address.
    const v = trimParticle(clean(labelled[1]).replace(/^[\s:：\-–—]+/, ''));
    if (v.length >= 5) {
      return { value: v, evidence: clean(labelled[0]), matched_by: 'labelled field' };
    }
  }

  /*
   * The address precedes the anchor phrase, sometimes wrapping from the line
   * above, so the preceding line is included when the anchor appears near the
   * start of its own line.
   */
  for (let i = 0; i < ls.length; i++) {
    const line = ls[i];
    const taAt = line.search(ADDRESS_ANCHOR_TA);
    const enAt = line.search(ADDRESS_ANCHOR_EN);
    const at = taAt >= 0 ? taAt : enAt;
    if (at < 0) continue;

    let before = line.slice(0, at).trim();
    if (before.replace(/[\s,]/g, '').length < 6 && i > 0) {
      before = `${ls[i - 1]} ${before}`.trim();
    }
    // English "residing at X" / "Address: X" puts the address AFTER the anchor.
    if (taAt < 0 && enAt >= 0) {
      const after = clean(line.slice(enAt).replace(ADDRESS_ANCHOR_EN, ''));
      if (after.length >= 6) {
        return { value: after, evidence: clean(line).slice(0, 200), matched_by: 'address phrase' };
      }
    }
    const v = trimParticle(before);
    if (v.length >= 6) {
      return { value: v, evidence: clean(line).slice(0, 200), matched_by: 'address phrase' };
    }
  }
  return null;
}

// ------------------------------------------------------------------- date
/**
 * The date written on the document.
 *
 * This is NOT the received date - the system records that itself when the file
 * is uploaded, and a date printed on a letter is the date the letter was
 * written. Both are shown so an officer can see the difference.
 */
/*
 * Spaces are allowed AROUND the separators.
 *
 * A petition writes its date "நாள் : 16 - 09 - 2026", and requiring the
 * separator to hug the digits missed it entirely. The spacing is then removed
 * so the stored value is the ordinary "16-09-2026" whichever way it was typed.
 */
const DATE_BODY = String.raw`\d{1,2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*`;

/** "16 - 09 - 2026" and "16-09-2026" are the same date; store one form. */
const tidyDate = (s: string) => s.replace(/\s*([.\-/])\s*/g, '$1');

function findDate(text: string): ExtractedField | null {
  const labelled = text.match(
    new RegExp(String.raw`(?:நாள்|தேதி|date|dated)\s*[:：]?\s*(${DATE_BODY}\d{2,4})`, 'i'),
  );
  if (labelled) {
    return {
      value: tidyDate(labelled[1]),
      evidence: clean(labelled[0]),
      matched_by: 'labelled date',
    };
  }
  const bare = text.match(new RegExp(String.raw`\b(${DATE_BODY}(?:19|20)\d{2})\b`));
  if (bare) {
    return { value: tidyDate(bare[1]), evidence: clean(bare[0]), matched_by: 'date pattern' };
  }
  return null;
}

// ---------------------------------------------------------------- subject
/*
 * The petition's own subject line.
 *
 * Every formal petition states what it is about on one labelled line -
 * "பொருள் : தெருவிளக்குகள் எரியாததால் …" or "Subject: Street lights not
 * working". Without it the record carried the FILENAME as the subject
 * ("AP-2026-6D6AC6.pdf"), which told an officer nothing and gave the analyser
 * nothing to classify: the Act and department were being chosen from the body
 * text alone.
 *
 * The label is matched loosely because OCR doubles or drops its vowel signs
 * ("பொருள்" came back as "பபொருள்"), and the value may wrap onto the next
 * line, which a formal subject usually does.
 */
const SUBJECT_LABEL = /^\s*(?:ப[பெொ]*ருள்|விஷயம்|subject|sub|re)\s*[:：]\s*(.*)$/i;

function findSubject(ls: string[]): ExtractedField | null {
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(SUBJECT_LABEL);
    if (!m) continue;

    let value = clean(m[1]);

    /*
     * A subject wraps. Continuation lines are taken while they look like the
     * same sentence - no new label, and not the salutation that follows it -
     * and stop at the full stop that ends a formal subject line.
     */
    for (let j = i + 1; j < ls.length && value.length < 220; j++) {
      const next = clean(ls[j]);
      if (!next) break;
      if (SUBJECT_LABEL.test(next) || BLOCK_END.test(next) || FROM_LABEL.test(next)) break;
      if (/^(?:மதிப்பிற்குரிய|அய்யா|ஐயா|sir|madam|respected)/i.test(next)) break;
      value = `${value} ${next}`.trim();
      if (/[.।]\s*$/.test(next)) break;
    }

    value = value.replace(/\s*[-–—]\s*$/, '').replace(/\s*[.।]\s*$/, '').trim();
    if (value.length < 6) continue;

    return {
      value: value.slice(0, 220),
      evidence: clean(ls[i]).slice(0, 200),
      matched_by: 'subject line',
    };
  }
  return null;
}

// -------------------------------------------------------------- reference
function findReference(text: string, ls: string[]): ExtractedField | null {
  /*
   * A file reference, not a word that happens to start with "ref".
   *
   * `Ref\.?` previously matched inside "refers" and recorded that as the
   * document's reference number. Two rules fix it: the label must be a whole
   * token (\b … \b), and the value that follows must contain a digit - every
   * real reference does ("ப.மு.0018/2026/அ1", "File No. 42/2026").
   */
  for (const line of ls) {
    /*
     * `\b` is a Latin word boundary and does not apply to Tamil letters, so the
     * Tamil prefixes are matched without it and the Latin ones with it.
     */
    const m = line.match(
      /((?:ப\.மு\.?|ந\.க\.?|\b(?:File\s*No|Ref(?:erence)?)\b\.?)\s*[:.]?\s*[\w./\-஀-௿]{4,40})/i,
    );
    if (m && /\d/.test(m[1])) {
      return { value: clean(m[1]), evidence: clean(line).slice(0, 160), matched_by: 'reference pattern' };
    }
  }
  return null;
}

/**
 * Extract every supported field from a document's text.
 *
 * Returns nulls freely. The caller must treat a null as "not stated in this
 * document", never as an invitation to fill the gap another way.
 */
export function extractPetitionerDetails(text: string): PetitionerDetails {
  const src = String(text || '');
  const ls = lines(src);
  const joined = ls.join('\n');

  /*
   * The sender block is the most reliable source, so it is consulted first and
   * the other strategies only fill what it did not supply.
   */
  const from = findFromBlock(ls);

  return {
    name: from.name ?? findName(joined, ls),
    phone: findPhone(joined, ls),
    address: from.address ?? findAddress(joined, ls),
    document_date: findDate(joined),
    reference: findReference(joined, ls),
    subject: findSubject(ls),
  };
}

/** True when the text is predominantly Tamil - used only for logging. */
export function isTamilText(text: string): boolean {
  return TAMIL.test(String(text || ''));
}
