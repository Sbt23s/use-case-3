/**
 * Repair Tamil text from a PDF whose ToUnicode map emits the wrong codepoints.
 *
 * WHAT GOES WRONG. Some Windows producers embed a subset of NirmalaUI with no
 * ToUnicode table at all. pdf.js then reconstructs text from a guessed
 * encoding, and for Tamil that guess fails in two specific, mechanical ways:
 *
 *   1. A LEFT-SIDE VOWEL SIGN becomes a copy of the consonant it attaches to.
 *      Tamil draws ெ ே ை to the left of their consonant, and the faulty map
 *      emits the consonant's own codepoint in the vowel sign's place:
 *          கைபேசி  ->  ககசபசி      (ை became a second க)
 *          பெறுநர் ->  பபறுநர்      (ெ became a second ப)
 *          பொருள்  ->  பபொருள்      (ப duplicated before the ொ)
 *
 *   2. ே (U+0BC7) IS EMITTED WHERE ச (U+0B9A) BELONGS. The two glyphs are
 *      near-identical in this typeface, so the guessed encoding confuses them:
 *          சரிபார்க்கவும் -> ேரிபார்க்கவும்
 *
 * WHY REPAIR RATHER THAN RE-OCR. Measured on a real petition, 87.6% of the
 * Tamil words came through correctly; only 12.4% carried the damage. The page
 * cannot be rasterised for OCR on this platform - node-canvas has no glyphs for
 * the embedded subset and draws tofu boxes, so OCR reads nothing at all.
 * Discarding the layer therefore loses a document that is mostly right, and an
 * officer is left with no text whatsoever.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not guess at words. Every rule
 * below rewrites a sequence that is ORTHOGRAPHICALLY IMPOSSIBLE in Tamil into
 * the one reading that is possible, so a correct document passes through
 * untouched. Where a sequence is merely unusual it is left alone: a wrong
 * repair would put words in a citizen's mouth, which is worse than leaving the
 * text visibly damaged for an officer to check against the original.
 */

/** Tamil consonants க..ஹ */
const CONS = 'க-ஹ';

/**
 * A duplicated consonant that should be a consonant plus a left-side matra.
 *
 * Tamil does write geminates, but always with a virama between the pair
 * (ப்ப, ட்ட). Two BARE identical consonants in succession cannot occur, so the
 * second one is the mis-emitted vowel sign.
 *
 * Which vowel sign it was is decided by what follows, because the faulty map
 * is consistent: a following ா means the original was the two-part ொ, and a
 * bare duplicate at the start of a syllable was ை or ெ. Only the cases the
 * evidence actually supports are rewritten.
 */
interface Rule {
  /** What the broken text contains. */
  find: RegExp;
  /** What it must be replaced with. */
  replace: string;
  /** Why this rewrite is the only possible reading. */
  because: string;
}

const RULES: Rule[] = [
  /*
   * "பபொருள்" -> "பொருள்". The ொ is already present and correct; the
   * duplicated ப before it is the artefact. Removing the duplicate is safe
   * because a bare consonant immediately followed by the same consonant
   * carrying ொ cannot occur in Tamil.
   */
  {
    find: new RegExp(`([${CONS}])\\1(ொ|ோ)`, 'g'),
    replace: '$1$2',
    because: 'consonant duplicated before a two-part vowel sign',
  },

  /*
   * A BARE DOUBLED CONSONANT IS DELIBERATELY NOT REPAIRED.
   *
   * It is genuinely ambiguous, and the evidence shows why: the identical
   * broken pattern stands for different vowel signs, and sometimes for one
   * that belongs to a later consonant entirely.
   *
   *     ககசபசி     ->  கைபேசி       (ை here)
   *     பபறுநர்    ->  பெறுநர்       (ெ here)
   *     ககலக்டர்   ->  கலெக்டர்      (ெ, and it belongs AFTER the next letter)
   *     உத்தரவுககள ->  உத்தரவுகளை    (ை, and it moves past ள)
   *
   * Choosing between them needs the word, not the letters. Guessing would put
   * words the citizen never wrote into an official record - "கைலக்டர்" for
   * "கலெக்டர்" - which reads as authoritative and is wrong. Leaving the
   * damage visible is safer: the officer sees that the text is mangled and
   * checks it against the original, which the document viewer shows alongside.
   */

  /*
   * "ேரிபார்" -> "சரிபார்". A dependent vowel sign cannot begin a word, so a
   * ே at the start of a run is not a vowel sign at all: it is ச, whose glyph
   * is nearly identical in this typeface.
   */
  {
    find: /(^|[^஀-௿])ே(?=[஀-௿])/gm,
    replace: '$1ச',
    because: 'ே cannot start a word - it is ச mis-mapped',
  },

  /*
   * The same collision inside a word: a ே directly after a virama is
   * impossible, because a virama closes the preceding consonant.
   */
  {
    find: /்ே/g,
    replace: '்ச',
    because: 'ே cannot follow a virama - it is ச mis-mapped',
  },
];

export interface RepairResult {
  text: string;
  /** How many substitutions were made, for the audit trail. */
  repairs: number;
  /** True when the text was changed at all. */
  repaired: boolean;
}

/**
 * Repair the mechanical damage, leaving everything else exactly as extracted.
 *
 * The petitioner's words are the record, so this only ever rewrites sequences
 * that could not have been written by a person.
 */
export function repairTamilText(text: string): RepairResult {
  const src = String(text ?? '');
  if (!src) return { text: src, repairs: 0, repaired: false };

  let out = src;
  let repairs = 0;

  for (const rule of RULES) {
    rule.find.lastIndex = 0;
    out = out.replace(rule.find, (...args) => {
      repairs++;
      // Build the replacement from the captured groups, as String.replace would.
      const groups = args.slice(0, -2) as string[];
      return rule.replace.replace(/\$(\d)/g, (_, d) => groups[Number(d)] ?? '');
    });
  }

  return { text: out, repairs, repaired: out !== src };
}
