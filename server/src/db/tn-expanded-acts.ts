import { TNAct100 } from './tn-100-acts.js';
import { TN_ACTS_101_200 } from './tn-acts-101-200.js';
import { TN_ACTS_201_350 } from './tn-acts-201-350.js';

export const TN_EXPANDED_ACTS: TNAct100[] = [
  ...TN_ACTS_101_200,
  ...TN_ACTS_201_350
];

export function seedExpandedActs(db: any) {
  const existingCount = (db.prepare('SELECT COUNT(*) n FROM kb_act WHERE active = 1').get() as any)?.n ?? 0;
  if (existingCount >= 340) {
    return;
  }

  console.log('[seedExpandedActs] Starting ingestion of Tamil Nadu Acts 101 to 350...');

  // Ensure all necessary departments exist
  const upsertDept = db.prepare(`
    INSERT INTO kb_department (code, name, name_ta, description, responsibilities, keywords, active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      name_ta = excluded.name_ta,
      description = excluded.description,
      responsibilities = excluded.responsibilities,
      keywords = excluded.keywords,
      active = 1
  `);

  const deptMap: Record<string, { code: string; name: string; name_ta: string; keywords: string }> = {
    REV: { code: 'REV', name: 'Revenue & Disaster Management', name_ta: 'வருவாய் மற்றும் பேரிடர் மேலாண்மைத் துறை', keywords: 'revenue, patta, survey, fmb, encroachment, recovery, வருவாய், பட்டா, சர்வே' },
    REG: { code: 'REG', name: 'Commercial Taxes & Registration', name_ta: 'வணிகவரி மற்றும் பதிவுத் துறை', keywords: 'registration, stamp duty, sub registrar, marriage, பத்திர பதிவு, முத்திரைத்தாள்' },
    CT: { code: 'CT', name: 'Commercial Taxes', name_ta: 'வணிகவரித் துறை', keywords: 'gst, sales tax, commercial tax, samadhan, வணிகவரி, ஜிஎஸ்டி, சமாதான்' },
    LAW: { code: 'LAW', name: 'Law Department', name_ta: 'சட்டத்துறை', keywords: 'law, legal aid, lok adalat, sles, சட்டம், இலவச சட்ட உதவி, லோக் அதாலத்' },
    HRCE: { code: 'HRCE', name: 'HR & CE Department', name_ta: 'இந்து சமய அறநிலையத் துறை', keywords: 'temple, hr ce, endowment, choultry, கோவில், அறநிலையத்துறை, சத்திரம்' },
    ARCH: { code: 'ARCH', name: 'Archaeology Department', name_ta: 'தொல்லியல் துறை', keywords: 'monuments, archaeology, heritage, excavation, தொல்லியல், பழங்கால சின்னங்கள்' },
    MAWS: { code: 'MAWS', name: 'Municipal Administration & Water Supply', name_ta: 'நகராட்சி நிருவாகத் துறை (மாநகராட்சி)', keywords: 'corporation, municipality, civic, tax, drainage, நகராட்சி, மாநகராட்சி, பாதாள சாக்கடை' },
    GCC: { code: 'GCC', name: 'Greater Chennai Corporation', name_ta: 'சென்னை பெருநகர மாநகராட்சி', keywords: 'chennai corporation, gcc, rippon building, சென்னை மாநகராட்சி' },
    HUD: { code: 'HUD', name: 'Housing & Urban Development', name_ta: 'வீட்டுவசதி மற்றும் நகர்ப்புற வளர்ச்சித் துறை', keywords: 'housing, cmda, dtcp, apartment, tenancy, rera, slum, வீட்டுவசதி, அடுக்குமாடி' },
    IND: { code: 'IND', name: 'Industries, Investment Promotion & Commerce', name_ta: 'தொழில், முதலீட்டு ஊக்குவிப்பு மற்றும் வர்த்தகத் துறை', keywords: 'industries, guidance, single window, palm board, தொழில், ஒற்றைச் சாளரம்' },
    HED: { code: 'HED', name: 'Higher Education', name_ta: 'உயர் கல்வித் துறை', keywords: 'university, college, engineering, admission, tnea, உயர்கல்வி, கல்லூரி, பல்கலைக்கழகம்' },
    SED: { code: 'SED', name: 'School Education', name_ta: 'பள்ளிக் கல்வித் துறை', keywords: 'school education, fee regulation, ceo, deo, பள்ளி, கல்வி, கட்டண நிர்ணயம்' },
    HRM: { code: 'HRM', name: 'Human Resources Management', name_ta: 'மனிதவள மேலாண்மைத் துறை', keywords: 'hrm, tnpsc, pstm, government servants, reservation, மனிதவளம், டிஎன்பிஎஸ்சி' },
    BCMBC: { code: 'BCMBC', name: 'BC, MBC & Minorities Welfare', name_ta: 'பிற்படுத்தப்பட்டோர், மிகவும் பிற்படுத்தப்பட்டோர் நலத்துறை', keywords: 'bc, mbc, dnc, reservation, scholarship, பிற்படுத்தப்பட்டோர், சீர்மரபினர்' },
    ADTW: { code: 'ADTW', name: 'Adi Dravidar & Tribal Welfare', name_ta: 'ஆதிதிராவிடர் மற்றும் பழங்குடியினர் நலத்துறை', keywords: 'adi dravidar, sc st, tribal, arunthathiyar, ஆதிதிராவிடர், பழங்குடியினர்' },
    NRTW: { code: 'NRTW', name: "Non-Resident Tamils' Welfare", name_ta: 'வெளிநாடு வாழ் தமிழர் நலத்துறை', keywords: 'non resident tamils, nrt, overseas tamils, வெளிநாடு வாழ் தமிழர்' },
    MSME: { code: 'MSME', name: 'Micro, Small and Medium Enterprises', name_ta: 'குறு, சிறு மற்றும் நடுத்தரத் தொழில் நிறுவனங்கள் துறை', keywords: 'msme, khadi, village industries, artisan, கதர், கிராமத் தொழில், கைவினைஞர்' },
    AGR: { code: 'AGR', name: "Agriculture & Farmers' Welfare", name_ta: 'வேளாண்மை மற்றும் உழவர் நலத்துறை', keywords: 'agriculture, tnau, marketing, oil palm, protected zone, வேளாண்மை, உழவர்' },
    SERI: { code: 'SERI', name: 'Sericulture Department', name_ta: 'பட்டு வளர்ச்சித் துறை', keywords: 'sericulture, silkworm, cocoon, dfl, பட்டு வளர்ச்சி, பட்டுப்புழு' },
    AHD: { code: 'AHD', name: 'Animal Husbandry, Dairying & Fisheries', name_ta: 'கால்நடை பராமரிப்புத் துறை', keywords: 'animal husbandry, tanuvas, cattle, bovine, veterinary, கால்நடை, மாடுகள்' },
    FISH: { code: 'FISH', name: 'Fisheries and Fishermen Welfare', name_ta: 'மீன்வளம் மற்றும் மீனவர் நலத்துறை', keywords: 'fisheries, boat, tnjfu, coastal, marine, மீன்வளம், விசைப்படகு' },
    FOR: { code: 'FOR', name: 'Environment, Climate Change & Forests', name_ta: 'சுற்றுச்சூழல், காலநிலை மாற்றம் மற்றும் வனத்துறை', keywords: 'forest, trees, dfo, rosewood, hill area, வனம், காடு, மரங்கள் பாதுகாப்பு' },
    WRD: { code: 'WRD', name: 'Water Resources Department', name_ta: 'நீர்வளத்துறை', keywords: 'water resources, tank, irrigation, canal, lake, groundwater, நீர்வளம், ஏரி, பாசனம்' },
    HMP: { code: 'HMP', name: 'Highways & Minor Ports', name_ta: 'நெடுஞ்சாலைகள் மற்றும் சிறு துறைமுகங்கள் துறை', keywords: 'highways, maritime, ports, road, நெடுஞ்சாலை, துறைமுகம், சாலை' },
    TNSTC: { code: 'TNSTC', name: 'Transport Department', name_ta: 'போக்குவரத்துத் துறை', keywords: 'transport, rto, motor vehicles, taxation, bus, போக்குவரத்து, ஆர்டிஓ, பேருந்து' },
    LAB: { code: 'LAB', name: 'Labour Welfare & Skill Development', name_ta: 'தொழிலாளர் நலன் மற்றும் திறன் மேம்பாட்டுத் துறை', keywords: 'labour, shops, worker, wages, holiday, subsistence, தொழிலாளர், ஊதியம்' },
    HFW: { code: 'HFW', name: 'Health & Family Welfare', name_ta: 'மக்கள் நல்வாழ்வு மற்றும் குடும்ப நலத்துறை', keywords: 'health, hospital, clinical establishments, public health, மருத்துவம், சுகாதாரம்' },
    FIN: { code: 'FIN', name: 'Finance Department', name_ta: 'நிதித்துறை', keywords: 'finance, tender, budget, fiscal, procurement, நிதி, டெண்டர், பட்ஜெட்' },
    ENG: { code: 'ENG', name: 'Energy Department', name_ta: 'எரிசக்தித் துறை', keywords: 'electricity, lifts, tangedco, ceig, energy, மின்சாரம், லிப்ட், மின்தூக்கி' },
    COOP: { code: 'COOP', name: 'Cooperation, Food & Consumer Protection', name_ta: 'கூட்டுறவு, உணவு மற்றும் நுகர்வோர் பாதுகாப்புத் துறை', keywords: 'cooperation, cooperative societies, crop loan, கூட்டுறவு, கூட்டுறவு வங்கி' },
    HOME: { code: 'HOME', name: 'Home, Prohibition & Excise', name_ta: 'உள்துறை, மதுவிலக்கு மற்றும் ஆயத்தீர்வைத் துறை', keywords: 'police, home, crime, prohibition, gambling, goondas, காவல், உள்துறை, மதுவிலக்கு' },
    FRS: { code: 'FRS', name: 'Fire and Rescue Services', name_ta: 'தீயணைப்பு மற்றும் மீட்புப் பணிகள் துறை', keywords: 'fire, rescue, fire safety, noc, தீயணைப்பு, மீட்புப் பணி' },
    SWWE: { code: 'SWWE', name: 'Social Welfare & Women Empowerment', name_ta: 'சமூக நலம் மற்றும் மகளிர் உரிமைத் துறை', keywords: 'social welfare, senior citizens, women, children, child rights, சமூக நலம், மூத்த குடிமக்கள்' },
    RDPR: { code: 'RDPR', name: 'Rural Development & Panchayat Raj', name_ta: 'ஊரக வளர்ச்சி மற்றும் ஊராட்சித் துறை', keywords: 'panchayat, bdo, rural, drinking water, ஊராட்சி, கிராம பஞ்சாயத்து, பிடிஓ' }
  };

  for (const d of Object.values(deptMap)) {
    upsertDept.run(d.code, d.name, d.name_ta, d.name, d.name, d.keywords);
  }

  const getDeptId = db.prepare('SELECT id FROM kb_department WHERE code = ?');
  const findAct = db.prepare('SELECT id FROM kb_act WHERE short_name = ?');

  const insAct = db.prepare(`
    INSERT INTO kb_act (
      short_name, short_name_ta, full_title, full_title_ta, act_type, year, jurisdiction,
      summary, applies_when, applies_when_ta, rules, section, authority,
      petition_type, keywords, keywords_ta, workflow, official_source,
      verification_status, last_verified_date, active, is_demo
    ) VALUES (
      ?, ?, ?, ?, 'ACT', ?, 'STATE',
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, 1, 0
    )
  `);

  const updAct = db.prepare(`
    UPDATE kb_act SET
      short_name_ta = ?, full_title = ?, full_title_ta = ?, year = ?,
      summary = ?, applies_when = ?, applies_when_ta = ?, rules = ?, section = ?,
      authority = ?, petition_type = ?, keywords = ?, keywords_ta = ?,
      workflow = ?, official_source = ?, verification_status = ?, last_verified_date = ?,
      active = 1, updated_at = datetime('now')
    WHERE id = ?
  `);

  const linkActDept = db.prepare(`
    INSERT OR IGNORE INTO kb_department_act (department_id, act_id) VALUES (?, ?)
  `);

  const insSection = db.prepare(`
    INSERT OR IGNORE INTO kb_section (act_id, section_no, heading, heading_ta, text, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `);

  let count = 0;
  for (const item of TN_EXPANDED_ACTS) {
    const existing = findAct.get(item.act_name_en) as any;
    let actId: number;

    const summary = `${item.act_name_en} administers statutory functions relating to ${item.petition_type}. Primary authority: ${item.authority}.`;
    const appliesWhen = `Applies to grievances relating to ${item.petition_type} handled under ${item.rules}. Competent officer: ${item.authority}.`;
    const appliesWhenTa = `${item.petition_type} தொடர்பான மனுக்கள் மற்றும் புகார்களுக்கு இச்சட்டம் பொருந்தும். கையாளும் அதிகாரி: ${item.authority_ta || item.authority}.`;

    if (existing) {
      updAct.run(
        item.act_name_ta, item.act_name_en, item.act_name_ta, item.act_year,
        summary, appliesWhen, appliesWhenTa, item.rules, item.section,
        item.authority, item.petition_type, item.keywords_en, item.keywords_ta,
        item.workflow, item.official_source, item.status, item.last_verified_date,
        existing.id
      );
      actId = existing.id;
    } else {
      const res = insAct.run(
        item.act_name_en, item.act_name_ta, item.act_name_en, item.act_name_ta, item.act_year,
        summary, appliesWhen, appliesWhenTa, item.rules, item.section, item.authority,
        item.petition_type, item.keywords_en, item.keywords_ta, item.workflow, item.official_source,
        item.status, item.last_verified_date
      );
      actId = Number(res.lastInsertRowid);
    }

    // Link department
    const dept = getDeptId.get(item.dept_code) as any;
    if (dept) {
      linkActDept.run(dept.id, actId);
    }

    // Insert key section
    insSection.run(
      actId,
      'Provisions',
      item.section.split(',')[0]?.trim() || 'Key Statutory Provisions',
      'முக்கிய சட்டப் பிரிவுகள்',
      `${item.section} under ${item.rules}. Redressal workflow: ${item.workflow}`
    );

    count++;
  }

  console.log(`[seedExpandedActs] Successfully synced ${count} expanded Tamil Nadu Acts (Acts 101 to 350) into kb_act.`);
}
