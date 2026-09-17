/**
 * Tamil names for the knowledge base.
 *
 * The configuration screen can be read in Tamil or English. Showing a Tamil
 * interface while every Act and department is still named in English would be
 * half a translation, so each record carries a Tamil name alongside its
 * English one.
 *
 * The English name stays the identifier - it is what the seed matches on and
 * what the audit trail records - and the Tamil name is what is displayed when
 * the officer chooses Tamil. An administrator can edit either from the screen.
 *
 * Where a statute has no settled Tamil title, the Tamil entry is a plain
 * description of its subject rather than an invented official name. An Act
 * without an entry here simply shows its English name in both views, which is
 * honest; a fabricated Tamil title would not be.
 */

export const ACT_NAMES_TA: Record<string, { short: string; full?: string; applies?: string }> = {
  'Maintenance and Welfare of Parents and Senior Citizens Act, 2007': {
    short: 'பெற்றோர் மற்றும் மூத்த குடிமக்கள் பராமரிப்பு நலச் சட்டம், 2007',
    full: 'பெற்றோர் மற்றும் மூத்த குடிமக்களின் பராமரிப்பு மற்றும் நலன் சட்டம், 2007',
    applies: 'மூத்த குடிமகன் அல்லது பெற்றோர் தம்மைத் தாமே பராமரிக்க இயலாத நிலையில், அல்லது பராமரிப்பு வழங்காமல் சொத்து மாற்றப்பட்டதாகக் கூறும்போது.',
  },
  'Protection of Women from Domestic Violence Act, 2005': {
    short: 'குடும்ப வன்முறையிலிருந்து பெண்களைப் பாதுகாக்கும் சட்டம், 2005',
    applies: 'குடும்ப உறவுக்குள் பெண் வன்முறை, துன்புறுத்தல் அல்லது கொடுமைக்கு ஆளானதாகக் கூறும்போது.',
  },
  'Right of Children to Free and Compulsory Education Act, 2009': {
    short: 'இலவச கட்டாயக் கல்வி உரிமைச் சட்டம், 2009',
    applies: 'பள்ளி சேர்க்கை மறுப்பு, பள்ளிக் கட்டணம், அல்லது குழந்தை தொடக்கக் கல்வியிலிருந்து விலக்கப்படுதல்.',
  },
  'Juvenile Justice (Care and Protection of Children) Act, 2015': {
    short: 'சிறார் நீதி (குழந்தைகள் பராமரிப்பு மற்றும் பாதுகாப்பு) சட்டம், 2015',
    applies: 'பராமரிப்பு மற்றும் பாதுகாப்பு தேவைப்படும் குழந்தை தொடர்பான விவகாரம்.',
  },
  'Rights of Persons with Disabilities Act, 2016': {
    short: 'மாற்றுத்திறனாளிகள் உரிமைச் சட்டம், 2016',
    applies: 'மாற்றுத்திறன் சான்றிதழ், பலன்கள், இடஒதுக்கீடு அல்லது அணுகல் தொடர்பான விவகாரம்.',
  },
  'SC/ST (Prevention of Atrocities) Act, 1989': {
    short: 'பட்டியல் சாதியினர்/பழங்குடியினர் (கொடுமைகள் தடுப்பு) சட்டம், 1989',
    applies: 'பட்டியல் சாதி அல்லது பழங்குடி இனத்தைச் சேர்ந்தவர் மீதான கொடுமை குறித்த குற்றச்சாட்டு.',
  },
  'Right to Information Act, 2005': {
    short: 'தகவல் அறியும் உரிமைச் சட்டம், 2005',
    applies: 'பொதுத் துறையிடம் தகவல் கோரிக்கை, பதில் தாமதம் அல்லது தகவல் மறுப்பு.',
  },
  'Legal Services Authorities Act, 1987': {
    short: 'சட்டப் பணிகள் ஆணைய சட்டம், 1987',
    applies: 'இலவச சட்ட உதவிக்கு தகுதியுள்ளவர், அல்லது லோக் அதாலத்திற்குப் பொருத்தமான விவகாரம்.',
  },
  'Consumer Protection Act, 2019': {
    short: 'நுகர்வோர் பாதுகாப்புச் சட்டம், 2019',
    applies: 'பழுதான பொருள், சேவைக் குறைபாடு அல்லது நியாயமற்ற வர்த்தக நடைமுறை.',
  },
  'Real Estate (Regulation and Development) Act, 2016': {
    short: 'ரியல் எஸ்டேட் (ஒழுங்குமுறை மற்றும் மேம்பாடு) சட்டம், 2016',
    applies: 'கட்டுநர், குடியிருப்பு ஒப்படைப்பு தாமதம் அல்லது பதிவு செய்யப்பட்ட திட்டம் தொடர்பானது.',
  },
  'Information Technology Act, 2000': {
    short: 'தகவல் தொழில்நுட்பச் சட்டம், 2000',
    applies: 'இணைய மோசடி, ஆன்லைன் துன்புறுத்தல் அல்லது மின்னணு ஆவணம் தொடர்பானது.',
  },
  'Motor Vehicles Act, 1988': {
    short: 'மோட்டார் வாகனச் சட்டம், 1988',
    applies: 'ஓட்டுநர் உரிமம், வாகனப் பதிவு, அனுமதி அல்லது சாலை விபத்து இழப்பீடு.',
  },
  'Environment (Protection) Act, 1986': {
    short: 'சுற்றுச்சூழல் (பாதுகாப்பு) சட்டம், 1986',
    applies: 'சுற்றுச்சூழல் சேதம், அபாயகரமான கழிவு வெளியேற்றம் அல்லது மாசுபடுத்தும் செயல்பாடு.',
  },
  'Water (Prevention and Control of Pollution) Act, 1974': {
    short: 'நீர் (மாசு தடுப்பு மற்றும் கட்டுப்பாடு) சட்டம், 1974',
    applies: 'நீர் மாசுபாடு, கழிவுநீர் வெளியேற்றம் அல்லது தொழிற்சாலையால் நீர் மாசடைதல்.',
  },
  'Air (Prevention and Control of Pollution) Act, 1981': {
    short: 'காற்று (மாசு தடுப்பு மற்றும் கட்டுப்பாடு) சட்டம், 1981',
    applies: 'காற்று மாசு, புகை, தூசி அல்லது உமிழ்வு தொடர்பானது.',
  },
  'Wild Life (Protection) Act, 1972': {
    short: 'வனவிலங்கு (பாதுகாப்பு) சட்டம், 1972',
    applies: 'வனவிலங்கு, விலங்கு வேட்டை அல்லது மனித-விலங்கு மோதல்.',
  },
  'Forest (Conservation) Act, 1980': {
    short: 'வனம் (பாதுகாப்பு) சட்டம், 1980',
    applies: 'வன நிலம், வன நிலத் திருப்பம் அல்லது வன உரிமைகள்.',
  },
  'Biological Diversity Act, 2002': {
    short: 'உயிரியல் பன்முகத்தன்மைச் சட்டம், 2002',
    applies: 'உயிரியல் வளங்கள் மற்றும் பல்லுயிர் பாதுகாப்பு.',
  },
  'RFCTLARR Act, 2013': {
    short: 'நில கையகப்படுத்துதல், மறுவாழ்வு மற்றும் மறுகுடியமர்வு சட்டம், 2013',
    full: 'நியாயமான இழப்பீடு மற்றும் வெளிப்படைத்தன்மை உரிமை - நில கையகப்படுத்துதல், மறுவாழ்வு மற்றும் மறுகுடியமர்வு சட்டம், 2013',
    applies: 'அரசால் நிலம் கையகப்படுத்தப்படுதல், இழப்பீடு அல்லது மறுவாழ்வு.',
  },
  'Registration Act, 1908': {
    short: 'பதிவுச் சட்டம், 1908',
    applies: 'ஆவணப் பதிவு, கிரய பத்திரம், வில்லங்கச் சான்று அல்லது பதிவேட்டில் உள்ள விவரம்.',
  },
  'Transfer of Property Act, 1882': {
    short: 'சொத்து மாற்றச் சட்டம், 1882',
    applies: 'விற்பனை, தானம், அடமானம், குத்தகை மூலம் அசையா சொத்து மாற்றம்.',
  },
  'Indian Succession Act, 1925': {
    short: 'இந்திய வாரிசுரிமைச் சட்டம், 1925',
    applies: 'வாரிசுரிமை, உயில், ப்ரொபேட் அல்லது வாரிசுச் சான்றிதழ்.',
  },
  'Hindu Succession Act, 1956': {
    short: 'இந்து வாரிசுரிமைச் சட்டம், 1956',
    applies: 'இந்து வாரிசுகளிடையே சொத்துப் பங்கீடு, மகள் அல்லது விதவையின் பங்கு.',
  },
  'Hindu Marriage Act, 1955': {
    short: 'இந்து திருமணச் சட்டம், 1955',
    applies: 'திருமணம், விவாகரத்து அல்லது நீதிமன்றப் பிரிவினை.',
  },
  'Hindu Adoptions and Maintenance Act, 1956': {
    short: 'இந்து தத்தெடுப்பு மற்றும் பராமரிப்புச் சட்டம், 1956',
    applies: 'தத்தெடுப்பு, அல்லது மனைவி, குழந்தை, வயதான பெற்றோரின் பராமரிப்புக் கோரிக்கை.',
  },
  'Special Marriage Act, 1954': {
    short: 'சிறப்புத் திருமணச் சட்டம், 1954',
    applies: 'பதிவுத் திருமணம் அல்லது கலப்புத் திருமணப் பதிவு.',
  },
  'Indian Contract Act, 1872': {
    short: 'இந்திய ஒப்பந்தச் சட்டம், 1872',
    applies: 'ஒப்பந்தம், ஒப்பந்த மீறல் அல்லது நிறைவேற்றப்படாத வாக்குறுதி.',
  },
  'Arbitration and Conciliation Act, 1996': {
    short: 'நடுவர் மற்றும் சமரசச் சட்டம், 1996',
    applies: 'நடுவர் தீர்ப்பு அல்லது சமரசம் தொடர்பானது.',
  },
  'Code of Civil Procedure, 1908': {
    short: 'சிவில் நடைமுறைச் சட்டத் தொகுப்பு, 1908',
    applies: 'சிவில் வழக்கு நடைமுறை, ஆணை அமலாக்கம் அல்லது சிவில் வழக்கு.',
  },
  'Bharatiya Nyaya Sanhita, 2023': {
    short: 'பாரதிய நியாய சன்ஹிதா, 2023',
    applies: 'குற்றமாக அமையக்கூடிய செயல் குறித்த குற்றச்சாட்டு.',
  },
  'Bharatiya Nagarik Suraksha Sanhita, 2023': {
    short: 'பாரதிய நாகரிக் சுரக்ஷா சன்ஹிதா, 2023',
    applies: 'குற்றவியல் நடைமுறை, புகார் பதிவு, விசாரணை அல்லது ஜாமீன்.',
  },
  'Bharatiya Sakshya Adhiniyam, 2023': {
    short: 'பாரதிய சாக்ஷ்ய அதிநியம், 2023',
    applies: 'சாட்சியம் மற்றும் அதன் ஏற்புடைமை.',
  },
  'Child and Adolescent Labour (Prohibition and Regulation) Act, 1986': {
    short: 'குழந்தை மற்றும் இளம்பருவத் தொழிலாளர் (தடை மற்றும் ஒழுங்குமுறை) சட்டம், 1986',
    applies: 'குழந்தை அல்லது இளம்பருவத்தினரை வேலைக்கு அமர்த்துதல்.',
  },
  'MGNREGA, 2005': {
    short: 'மகாத்மா காந்தி தேசிய ஊரக வேலை உறுதி சட்டம், 2005',
    applies: 'நூறு நாள் வேலை, வேலை அட்டை அல்லது திட்டத்தின் கீழ் ஊதியம் வழங்கப்படாமை.',
  },
  'National Food Security Act, 2013': {
    short: 'தேசிய உணவுப் பாதுகாப்புச் சட்டம், 2013',
    applies: 'ரேஷன் உரிமை, ரேஷன் அட்டை அல்லது நியாய விலைக் கடை விநியோகம்.',
  },
  'National Rural Livelihoods Mission framework': {
    short: 'தேசிய ஊரக வாழ்வாதார இயக்க கட்டமைப்பு',
    applies: 'சுய உதவிக் குழு, ஊரக வாழ்வாதார ஆதரவு அல்லது சிறு கடன்.',
  },
  'Employees Provident Funds and Miscellaneous Provisions Act, 1952': {
    short: 'ஊழியர் வருங்கால வைப்பு நிதிச் சட்டம், 1952',
    applies: 'வருங்கால வைப்பு நிதி பங்களிப்பு, திரும்பப் பெறுதல் அல்லது ஓய்வூதியம்.',
  },
  'Employees State Insurance Act, 1948': {
    short: 'ஊழியர் மாநிலக் காப்பீட்டுச் சட்டம், 1948',
    applies: 'ஈஎஸ்ஐ பலன்கள், மருத்துவ சிகிச்சை அல்லது முதலாளி பங்களிப்பு.',
  },
  'Minimum wages framework': {
    short: 'குறைந்தபட்ச ஊதியக் கட்டமைப்பு',
    applies: 'அறிவிக்கப்பட்ட குறைந்தபட்ச ஊதியத்திற்குக் கீழ் ஊதியம் வழங்குதல்.',
  },
  'Payment of Wages framework': {
    short: 'ஊதியம் வழங்கும் கட்டமைப்பு',
    applies: 'ஊதியம் வழங்குவதில் தாமதம், முறையற்ற பிடித்தம் அல்லது வழங்காமை.',
  },
  'Occupational safety framework': {
    short: 'தொழில்சார் பாதுகாப்புக் கட்டமைப்பு',
    applies: 'பணியிடப் பாதுகாப்பு, தொழிற்சாலை விபத்து அல்லது பாதுகாப்பற்ற பணிச்சூழல்.',
  },
  'Tamil Nadu Land Encroachment Act, 1905': {
    short: 'தமிழ்நாடு நில ஆக்கிரமிப்புச் சட்டம், 1905',
    applies: 'அரசு நிலம், புறம்போக்கு நிலம் ஆக்கிரமிப்பு அல்லது அனுமதியற்ற ஆக்கிரமிப்பு.',
  },
  'Tamil Nadu Patta Pass Book Act, 1983': {
    short: 'தமிழ்நாடு பட்டா பாஸ் புத்தகச் சட்டம், 1983',
    applies: 'பட்டா, பட்டா பாஸ் புத்தகம், பட்டா மாற்றம் அல்லது நில ஆவணத்தில் உள்ள முரண்பாடு.',
  },
  'Tamil Nadu Panchayats Act, 1994': {
    short: 'தமிழ்நாடு ஊராட்சிகள் சட்டம், 1994',
    applies: 'கிராம ஊராட்சி நிர்வாகம், ஊராட்சி நிதி அல்லது கிராம சபை.',
  },
  'Tamil Nadu Urban Local Bodies framework': {
    short: 'தமிழ்நாடு நகர்ப்புற உள்ளாட்சி கட்டமைப்பு',
    applies: 'நகராட்சி அல்லது மாநகராட்சி சேவை, நகர்ப்புற அடிப்படை வசதி.',
  },
  'Tamil Nadu Town and Country Planning Act, 1971': {
    short: 'தமிழ்நாடு நகர்ப்புற ஊரக திட்டமிடல் சட்டம், 1971',
    applies: 'திட்ட அனுமதி, லேஅவுட் ஒப்புதல் அல்லது அனுமதியற்ற கட்டுமானம்.',
  },
  'Tamil Nadu Co-operative Societies Act, 1983': {
    short: 'தமிழ்நாடு கூட்டுறவுச் சங்கங்கள் சட்டம், 1983',
    applies: 'கூட்டுறவுச் சங்கம், சங்கக் கடன் அல்லது சங்கத் தேர்தல்.',
  },
  'Tamil Nadu Agricultural Produce Marketing (Regulation) Act, 1987': {
    short: 'தமிழ்நாடு வேளாண் விளைபொருள் சந்தைப்படுத்தல் (ஒழுங்குமுறை) சட்டம், 1987',
    applies: 'ஒழுங்குபடுத்தப்பட்ட சந்தை அல்லது வேளாண் விளைபொருள் விற்பனை.',
  },
  'Tamil Nadu Forest Act, 1882': {
    short: 'தமிழ்நாடு வனச் சட்டம், 1882',
    applies: 'காப்புக் காடு, வனப் பொருள் அல்லது வன நிர்வாகம்.',
  },
  'Tamil Nadu Prevention of Begging Act, 1945': {
    short: 'தமிழ்நாடு பிச்சையெடுத்தல் தடுப்புச் சட்டம், 1945',
    applies: 'ஆதரவற்ற நிலையில் பிச்சையெடுப்பவர் அல்லது அவர்களின் மறுவாழ்வு.',
  },
  'Tamil Nadu Prohibition of Charging Exorbitant Interest Act, 2003': {
    short: 'தமிழ்நாடு அதிக வட்டி வசூலிப்பு தடைச் சட்டம், 2003',
    applies: 'கந்து வட்டி, கடன் கொடுத்தவரின் மிரட்டல் அல்லது அதிக வட்டி வசூல்.',
  },
  'Tamil Nadu Protection of Interests of Depositors Act, 1997': {
    short: 'தமிழ்நாடு வைப்பாளர் நல பாதுகாப்புச் சட்டம், 1997',
    applies: 'நிதி நிறுவனம் வைப்புத் தொகையைத் திருப்பித் தராமை அல்லது வைப்பு மோசடி.',
  },
  'Tamil Nadu Shops and Establishments framework': {
    short: 'தமிழ்நாடு கடைகள் மற்றும் நிறுவனங்கள் கட்டமைப்பு',
    applies: 'கடை அல்லது வணிக நிறுவனத்தில் பணிச்சூழல், பணி நேரம் அல்லது வேலைவாய்ப்பு.',
  },
  'Tamil Nadu Labour Welfare Fund Act, 1972': {
    short: 'தமிழ்நாடு தொழிலாளர் நல நிதிச் சட்டம், 1972',
    applies: 'தொழிலாளர் நல நிதி பலன்கள் அல்லது பங்களிப்பு.',
  },
  'Tamil Nadu Industrial Establishments (National and Festival Holidays) Act, 1958': {
    short: 'தமிழ்நாடு தொழில் நிறுவனங்கள் (தேசிய மற்றும் பண்டிகை விடுமுறை) சட்டம், 1958',
    applies: 'தொழிலாளர்களுக்கு தேசிய அல்லது பண்டிகை விடுமுறை மறுக்கப்படுதல்.',
  },
  'Tamil Nadu Private Colleges (Regulation) Act, 1976': {
    short: 'தமிழ்நாடு தனியார் கல்லூரிகள் (ஒழுங்குமுறை) சட்டம், 1976',
    applies: 'தனியார் கல்லூரி, அதன் நிர்வாகம், பணியாளர் அல்லது மாணவர் விவகாரம்.',
  },
  'Tamil Nadu Schools (Regulation of Collection of Fee) Act, 2009': {
    short: 'தமிழ்நாடு பள்ளிகள் (கட்டண வசூல் ஒழுங்குமுறை) சட்டம், 2009',
    applies: 'தனியார் பள்ளியில் அதிக கட்டணம் அல்லது அனுமதியற்ற கட்டண வசூல்.',
  },
  'Tamil Nadu Recognised Private Schools (Regulation) Act, 1973': {
    short: 'தமிழ்நாடு அங்கீகரிக்கப்பட்ட தனியார் பள்ளிகள் (ஒழுங்குமுறை) சட்டம், 1973',
    applies: 'அங்கீகரிக்கப்பட்ட தனியார் பள்ளி, அதன் அங்கீகாரம் அல்லது நிர்வாகம்.',
  },
  'Tamil Nadu Fire and Rescue Services Act, 2025': {
    short: 'தமிழ்நாடு தீயணைப்பு மற்றும் மீட்புப் பணிகள் சட்டம், 2025',
    applies: 'தீ பாதுகாப்பு, தீயணைப்புப் பணி அல்லது தீ தடையின்மைச் சான்றிதழ்.',
  },
  'Tamil Nadu Highways Act, 2001': {
    short: 'தமிழ்நாடு நெடுஞ்சாலைகள் சட்டம், 2001',
    applies: 'மாநில நெடுஞ்சாலை, சாலை விரிவாக்கம் அல்லது சாலைப் பராமரிப்பு.',
  },
  'Tamil Nadu Maritime Board Act, 1995': {
    short: 'தமிழ்நாடு கடல்சார் வாரியச் சட்டம், 1995',
    applies: 'சிறு துறைமுகங்கள் அல்லது கடல்சார் நிர்வாகம்.',
  },
  'Tamil Nadu Tax on Consumption or Sale of Electricity Act, 2003': {
    short: 'தமிழ்நாடு மின்சார நுகர்வு அல்லது விற்பனை வரிச் சட்டம், 2003',
    applies: 'மின்சார நுகர்வு அல்லது விற்பனை மீதான வரி.',
  },
  'Tamil Nadu Goods and Services Tax Act, 2017': {
    short: 'தமிழ்நாடு சரக்கு மற்றும் சேவை வரிச் சட்டம், 2017',
    applies: 'ஜிஎஸ்டி பதிவு, தாக்கல், திரும்பப் பெறுதல் அல்லது மதிப்பீடு.',
  },
  'Tamil Nadu Fiscal Responsibility Act, 2003': {
    short: 'தமிழ்நாடு நிதிப் பொறுப்புச் சட்டம், 2003',
    applies: 'மாநில நிதி மேலாண்மை மற்றும் பொறுப்பு.',
  },
  'Tamil Nadu Acquisition of Lands for Industrial Purposes Act, 1997': {
    short: 'தமிழ்நாடு தொழில் நோக்கங்களுக்கான நில கையகப்படுத்துதல் சட்டம், 1997',
    applies: 'தொழில் நோக்கத்திற்காக நிலம் கையகப்படுத்துதல் மற்றும் இழப்பீடு.',
  },
  'Tamil Nadu Land Reforms (Fixation of Ceiling on Land) Act, 1961': {
    short: 'தமிழ்நாடு நில சீர்திருத்தம் (நில உச்சவரம்பு நிர்ணயம்) சட்டம், 1961',
    applies: 'நில உச்சவரம்பு, உபரி நிலம் அல்லது நில சீர்திருத்த நடவடிக்கை.',
  },
  'Tamil Nadu Cultivating Tenants Protection Act, 1955': {
    short: 'தமிழ்நாடு பயிரிடும் குத்தகைதாரர் பாதுகாப்புச் சட்டம், 1955',
    applies: 'பயிரிடும் குத்தகைதாரர், வேளாண் நிலத்திலிருந்து வெளியேற்றம் அல்லது குத்தகை உரிமை.',
  },
  'Tamil Nadu Agricultural Lands Record of Tenancy Rights Act, 1969': {
    short: 'தமிழ்நாடு வேளாண் நிலக் குத்தகை உரிமைப் பதிவுச் சட்டம், 1969',
    applies: 'வேளாண் நிலத்தில் குத்தகை உரிமைப் பதிவு.',
  },
  'Tamil Nadu Slum Areas (Improvement and Clearance) Act, 1971': {
    short: 'தமிழ்நாடு குடிசைப் பகுதிகள் (மேம்பாடு மற்றும் அகற்றம்) சட்டம், 1971',
    applies: 'குடிசைப் பகுதி, குடிசை அகற்றம், மறுகுடியமர்வு அல்லது குடியிருப்பு ஒதுக்கீடு.',
  },
  'Tamil Nadu District Municipalities Act, 1920': {
    short: 'தமிழ்நாடு மாவட்ட நகராட்சிகள் சட்டம், 1920',
    applies: 'நகராட்சி நிர்வாகம், நகராட்சி வரி அல்லது நகராட்சி சேவை.',
  },
  'Tamil Nadu Hindu Religious and Charitable Endowments Act, 1959': {
    short: 'தமிழ்நாடு இந்து சமய அறநிலையச் சட்டம், 1959',
    applies: 'கோயில், கோயில் நிலம், கோயில் நிர்வாகம் அல்லது அறக்கட்டளை.',
  },
  'Tamil Nadu Protection of Tanks and Eviction of Encroachment Act, 2007': {
    short: 'தமிழ்நாடு ஏரிகள் பாதுகாப்பு மற்றும் ஆக்கிரமிப்பு அகற்றுதல் சட்டம், 2007',
    applies: 'ஏரி, நீர்நிலை அல்லது அதன் வாய்க்கால் ஆக்கிரமிப்பு.',
  },
  'Tamil Nadu Private Schools Fee Regulation framework': {
    short: 'தமிழ்நாடு தனியார் பள்ளிக் கட்டண ஒழுங்குமுறைக் கட்டமைப்பு',
    applies: 'தனியார் பள்ளிகள் வசூலிக்கும் கட்டணத்தின் ஒழுங்குமுறை.',
  },
  'Tamil Nadu Prevention of Dangerous Activities Act, 1982': {
    short: 'தமிழ்நாடு அபாயகரமான செயல்பாடுகள் தடுப்புச் சட்டம், 1982',
    applies: 'பழக்கமான குற்றவாளிகள், ரவுடிகள் அல்லது தடுப்புக் காவல்.',
  },
  'Tamil Nadu Prohibition Act, 1937': {
    short: 'தமிழ்நாடு மதுவிலக்குச் சட்டம், 1937',
    applies: 'கள்ளச் சாராயம், மதுவிலக்கு குற்றம் அல்லது மதுக் கடை.',
  },
  'Tamil Nadu Gaming Act, 1930': {
    short: 'தமிழ்நாடு சூதாட்டச் சட்டம், 1930',
    applies: 'சூதாட்டம் அல்லது சூதாட்ட விடுதி.',
  },
  'Tamil Nadu Regulation of Rights and Responsibilities of Landlords and Tenants Act, 2017': {
    short: 'தமிழ்நாடு வீட்டு உரிமையாளர் மற்றும் குடியிருப்பாளர் உரிமைகள் ஒழுங்குமுறைச் சட்டம், 2017',
    applies: 'வாடகை வீடு, வாடகைத் தகராறு, வாடகை அல்லது குடியிருப்பிலிருந்து வெளியேற்றம்.',
  },
  'Tamil Nadu Apartment Ownership Act, 2022': {
    short: 'தமிழ்நாடு குடியிருப்பு உரிமைச் சட்டம், 2022',
    applies: 'குடியிருப்பு உரிமை, பொதுப் பகுதிகள் அல்லது குடியிருப்பு சங்கம்.',
  },
  'Tamil Nadu Combined Development and Building Rules, 2019': {
    short: 'தமிழ்நாடு ஒருங்கிணைந்த வளர்ச்சி மற்றும் கட்டிட விதிகள், 2019',
    applies: 'கட்டிட விதிகள், பின்வாங்கல், தளப் பரப்பு அல்லது கட்டிட ஒழுங்குமுறை.',
  },
  'Tamil Nadu Transparency in Tenders Act, 1998': {
    short: 'தமிழ்நாடு டெண்டர்களில் வெளிப்படைத்தன்மைச் சட்டம், 1998',
    applies: 'அரசு டெண்டர் நடைமுறை அல்லது டெண்டர் முறைகேடு.',
  },
  'Tamil Nadu Protection of Traditional Rights of Fishing Community Act, 2020': {
    short: 'தமிழ்நாடு மீனவ சமூகத்தின் பாரம்பரிய உரிமைகள் பாதுகாப்புச் சட்டம், 2020',
    applies: 'மீனவர் உரிமைகள், மீன்பிடி அணுகல் அல்லது கடலோர வாழ்வாதாரம்.',
  },
  'Tamil Nadu Agricultural University Act': {
    short: 'தமிழ்நாடு வேளாண் பல்கலைக்கழகச் சட்டம்',
    applies: 'வேளாண் பல்கலைக்கழகம், அதன் நிர்வாகம், பணியாளர் அல்லது மாணவர்.',
  },
  'Tamil Nadu Veterinary and Animal Sciences University Act': {
    short: 'தமிழ்நாடு கால்நடை மற்றும் விலங்கு அறிவியல் பல்கலைக்கழகச் சட்டம்',
    applies: 'கால்நடை பல்கலைக்கழகம், அதன் நிர்வாகம் அல்லது மாணவர்.',
  },
  'Tamil Nadu Dr. M.G.R. Medical University Act': {
    short: 'தமிழ்நாடு டாக்டர் எம்.ஜி.ஆர். மருத்துவப் பல்கலைக்கழகச் சட்டம்',
    applies: 'மருத்துவப் பல்கலைக்கழகம், மருத்துவக் கல்லூரி இணைப்பு அல்லது மாணவர்.',
  },
  'Tamil Nadu Dr. Ambedkar Law University Act': {
    short: 'தமிழ்நாடு டாக்டர் அம்பேத்கர் சட்டப் பல்கலைக்கழகச் சட்டம்',
    applies: 'சட்டப் பல்கலைக்கழகம், சட்டக் கல்லூரி அல்லது மாணவர்.',
  },
  'Tamil Nadu Universities Laws': {
    short: 'தமிழ்நாடு பல்கலைக்கழகச் சட்டங்கள்',
    applies: 'மாநிலப் பல்கலைக்கழகம், அதன் நிர்வாகம், நியமனம் அல்லது மாணவர் விவகாரம்.',
  },
  'Tamil Nadu Prohibition of Ragging Act, 1997': {
    short: 'தமிழ்நாடு ராகிங் தடுப்புச் சட்டம், 1997',
    applies: 'கல்வி நிறுவனத்தில் ராகிங் குறித்த குற்றச்சாட்டு.',
  },
  'Tamil Nadu private tuition centres framework': {
    short: 'தமிழ்நாடு தனியார் பயிற்சி மையக் கட்டமைப்பு',
    applies: 'தனியார் பயிற்சி மையம் அல்லது கோச்சிங் நிறுவனம்.',
  },
  'Tamil Nadu SC/ST welfare rules and schemes': {
    short: 'தமிழ்நாடு ஆதிதிராவிடர்/பழங்குடியினர் நல விதிகள் மற்றும் திட்டங்கள்',
    applies: 'ஆதிதிராவிடர் நலத்திட்டம், உதவித்தொகை, விடுதி அல்லது பலன்கள்.',
  },
  'Tamil Nadu State Commission for Women framework': {
    short: 'தமிழ்நாடு மாநில மகளிர் ஆணையக் கட்டமைப்பு',
    applies: 'மகளிர் ஆணையத்திற்குப் பொருத்தமான பெண் தொடர்பான புகார்.',
  },
  'Tamil Nadu State Commission for Protection of Child Rights framework': {
    short: 'தமிழ்நாடு மாநில குழந்தைகள் உரிமைப் பாதுகாப்பு ஆணையக் கட்டமைப்பு',
    applies: 'குழந்தைகள் உரிமை மீறல்.',
  },
  'Tamil Nadu State Human Rights Commission framework': {
    short: 'தமிழ்நாடு மாநில மனித உரிமைகள் ஆணையக் கட்டமைப்பு',
    applies: 'பொது ஊழியர் அல்லது அதிகாரியால் மனித உரிமை மீறல்.',
  },
  'Tamil Nadu State Legal Services Authority framework': {
    short: 'தமிழ்நாடு மாநில சட்டப் பணிகள் ஆணையக் கட்டமைப்பு',
    applies: 'இலவச சட்ட உதவி அல்லது லோக் அதாலத் உதவி.',
  },
  'Tamil Nadu Electricity Regulatory Commission framework': {
    short: 'தமிழ்நாடு மின்சார ஒழுங்குமுறை ஆணையக் கட்டமைப்பு',
    applies: 'மின் கட்டணம், மின் விநியோகம், புதிய இணைப்பு, பில் அல்லது மின்வெட்டு.',
  },
  'Tamil Nadu Pollution Control Board framework': {
    short: 'தமிழ்நாடு மாசுக் கட்டுப்பாட்டு வாரியக் கட்டமைப்பு',
    applies: 'தொழிற்சாலை மாசுபாடு, இயக்க ஒப்புதல் அல்லது சுற்றுச்சூழல் தொல்லை.',
  },
  'Tamil Nadu RERA framework': {
    short: 'தமிழ்நாடு ரியல் எஸ்டேட் ஒழுங்குமுறை ஆணையக் கட்டமைப்பு',
    applies: 'பதிவு செய்யப்பட்ட ரியல் எஸ்டேட் திட்டம் அல்லது ஒப்படைப்பு தாமதம்.',
  },
  'Tamil Nadu clinical establishments framework': {
    short: 'தமிழ்நாடு மருத்துவ நிறுவனங்கள் கட்டமைப்பு',
    applies: 'மருத்துவமனை, கிளினிக், அதன் பதிவு, கட்டணம் அல்லது சிகிச்சைத் தரம்.',
  },
  'Tamil Nadu labour compliance framework': {
    short: 'தமிழ்நாடு தொழிலாளர் இணக்கக் கட்டமைப்பு',
    applies: 'தொழிலாளர் இணக்கம், நிறுவனப் பதிவு அல்லது ஆய்வு.',
  },
  'Tamil Nadu Social Security Pension framework': {
    short: 'தமிழ்நாடு சமூகப் பாதுகாப்பு ஓய்வூதியக் கட்டமைப்பு',
    applies: 'முதியோர், விதவை அல்லது ஆதரவற்றோர் ஓய்வூதியம் - வழங்குதல், கிடைக்காமை அல்லது தகுதி.',
  },
};

export const DEPARTMENT_NAMES_TA: Record<string, { name: string; responsibilities?: string }> = {
  AGRI: { name: 'வேளாண்மை மற்றும் விவசாயிகள் நலத்துறை',
    responsibilities: 'வேளாண் திட்டங்கள், பயிர் ஆதரவு, விவசாயி நலன், பாசன ஆதரவு, விதை மற்றும் உர விநியோகம், பயிர் காப்பீடு.' },
  ADW: { name: 'ஆதிதிராவிடர் மற்றும் பழங்குடியினர் நலத்துறை',
    responsibilities: 'பட்டியல் சாதி மற்றும் பழங்குடியினர் நலன், சாதிச் சான்றிதழ், விடுதி வசதி, உதவித்தொகை.' },
  AHDF: { name: 'கால்நடை பராமரிப்பு, பால்வளம், மீன்வளம் மற்றும் மீனவர் நலத்துறை',
    responsibilities: 'கால்நடை, கால்நடை மருத்துவ சேவை, பால்வள மேம்பாடு, மீன்வளம், மீனவர் நலன்.' },
  BCMBC: { name: 'பிற்படுத்தப்பட்டோர், மிகவும் பிற்படுத்தப்பட்டோர் மற்றும் சிறுபான்மையினர் நலத்துறை',
    responsibilities: 'பிற்படுத்தப்பட்டோர், மிகவும் பிற்படுத்தப்பட்டோர் மற்றும் சிறுபான்மையினர் நலன், சான்றிதழ், உதவித்தொகை.' },
  COOP: { name: 'கூட்டுறவு, உணவு மற்றும் நுகர்வோர் பாதுகாப்புத் துறை',
    responsibilities: 'கூட்டுறவுச் சங்கங்கள், பொது விநியோக முறை, ரேஷன் அட்டை, நியாய விலைக் கடை, நுகர்வோர் பாதுகாப்பு.' },
  CTR: { name: 'வணிக வரிகள் மற்றும் பதிவுத் துறை',
    responsibilities: 'வணிக வரிகள், ஜிஎஸ்டி நிர்வாகம், ஆவணப் பதிவு, சார்பதிவாளர் அலுவலகங்கள், வில்லங்கச் சான்று.' },
  ENV: { name: 'சுற்றுச்சூழல், காலநிலை மாற்றம் மற்றும் வனத்துறை',
    responsibilities: 'சுற்றுச்சூழல் பாதுகாப்பு, மாசுக் கட்டுப்பாடு, வனப் பாதுகாப்பு, வனவிலங்கு பாதுகாப்பு, பல்லுயிர்.' },
  FIN: { name: 'நிதித்துறை',
    responsibilities: 'மாநில நிதி, பட்ஜெட், கருவூலம், ஓய்வூதியம் வழங்குதல், சிறு சேமிப்பு.' },
  HHTK: { name: 'கைத்தறி, கைவினைப் பொருட்கள், ஜவுளி மற்றும் காதித் துறை',
    responsibilities: 'கைத்தறி நெசவாளர்கள், கைவினைஞர்கள், ஜவுளித் தொழில், காதி மற்றும் கிராமத் தொழில்.' },
  HEALTH: { name: 'சுகாதாரம் மற்றும் குடும்ப நலத்துறை',
    responsibilities: 'பொது சுகாதாரம், அரசு மருத்துவமனைகள், ஆரம்ப சுகாதார நிலையங்கள், மருத்துவ சிகிச்சை, குடும்ப நலன்.' },
  HIGHEDU: { name: 'உயர்கல்வித் துறை',
    responsibilities: 'பல்கலைக்கழகங்கள், கல்லூரிகள், தொழில்நுட்பக் கல்வி, சேர்க்கை, உதவித்தொகை.' },
  HOME: { name: 'உள்துறை, மதுவிலக்கு மற்றும் ஆயத்தீர்வைத் துறை',
    responsibilities: 'காவல்துறை நிர்வாகம், சட்டம் ஒழுங்கு, சிறைச்சாலைகள், மதுவிலக்கு, தீயணைப்புப் பணி.' },
  HOUSING: { name: 'வீட்டுவசதி மற்றும் நகர்ப்புற வளர்ச்சித் துறை',
    responsibilities: 'வீட்டுவசதித் திட்டங்கள், குடிசை மாற்றுவாரியம், நகர்ப்புற வளர்ச்சி, கட்டிட ஒப்புதல்.' },
  IND: { name: 'தொழில், முதலீட்டு மேம்பாடு மற்றும் வர்த்தகத் துறை',
    responsibilities: 'தொழில் வளர்ச்சி, முதலீட்டு மேம்பாடு, தொழிற்பேட்டைகள், சுரங்கம் மற்றும் கனிமங்கள்.' },
  ITDS: { name: 'தகவல் தொழில்நுட்பம் மற்றும் இணையச் சேவைகள் துறை',
    responsibilities: 'மின்னாளுகை, இணையச் சேவைகள், தகவல் தொழில்நுட்ப உள்கட்டமைப்பு, இணையக் குற்ற விவகாரங்கள்.' },
  LABOUR: { name: 'தொழிலாளர் நலன் மற்றும் திறன் மேம்பாட்டுத் துறை',
    responsibilities: 'தொழிலாளர் நலன், ஊதியம், வேலைவாய்ப்பு, தொழில் தகராறு, பணியிடப் பாதுகாப்பு, திறன் மேம்பாடு.' },
  LAW: { name: 'சட்டத்துறை',
    responsibilities: 'சட்ட விவகாரங்கள், சட்ட உதவி, நீதிமன்ற நிர்வாக ஆதரவு.' },
  MSME: { name: 'குறு, சிறு மற்றும் நடுத்தர தொழில் நிறுவனங்கள் துறை',
    responsibilities: 'குறு, சிறு மற்றும் நடுத்தர தொழில் மேம்பாடு, மானியங்கள், தொழில்முனைவோர் ஆதரவு.' },
  MAWS: { name: 'நகராட்சி நிர்வாகம் மற்றும் குடிநீர் வழங்கல் துறை',
    responsibilities: 'மாநகராட்சிகள் மற்றும் நகராட்சிகள், குடிநீர் வழங்கல், சாக்கடை, திடக்கழிவு, தெரு விளக்கு, நகர்ப்புற சுகாதாரம்.' },
  PUBLIC: { name: 'பொதுத்துறை',
    responsibilities: 'பொது நிர்வாகம், பொதுமக்கள் குறைதீர்ப்பு, துறைகளுக்கிடையேயான ஒருங்கிணைப்பு.' },
  PWD: { name: 'பொதுப்பணித் துறை',
    responsibilities: 'அரசு கட்டிடங்கள், பாசனப் பணிகள், நீர்வள அமைப்புகள், பொதுக் கட்டுமானம்.' },
  REVENUE: { name: 'வருவாய் மற்றும் பேரிடர் மேலாண்மைத் துறை',
    responsibilities: 'நில ஆவணங்கள், பட்டா மற்றும் சிட்டா, அளவீடு, பெயர் மாற்றம், நில ஆக்கிரமிப்பு, வருவாய்ச் சான்றிதழ், கிராம நிர்வாகம், பேரிடர் நிவாரணம்.' },
  RDPR: { name: 'ஊரக வளர்ச்சி மற்றும் ஊராட்சித் துறை',
    responsibilities: 'கிராம ஊராட்சிகள், ஊரக சாலைகள், ஊரக வேலைவாய்ப்புத் திட்டங்கள், ஊரக வீட்டுவசதி.' },
  SCHEDU: { name: 'பள்ளிக் கல்வித் துறை',
    responsibilities: 'அரசு மற்றும் தனியார் பள்ளிகள், பள்ளி சேர்க்கை, ஆசிரியர்கள், பள்ளிக் கட்டண ஒழுங்குமுறை, சத்துணவு.' },
  SWWE: { name: 'சமூக நலன் மற்றும் மகளிர் உரிமைத் துறை',
    responsibilities: 'மகளிர் நலன், குழந்தைகள் நலன், ஊட்டச்சத்து, முதியோர் மற்றும் விதவை ஓய்வூதியம், ஆதரவற்றோர் உதவி, மூத்த குடிமக்கள் நலன்.' },
  TAMILDEV: { name: 'தமிழ் வளர்ச்சி மற்றும் செய்தித் துறை',
    responsibilities: 'தமிழ் மொழி வளர்ச்சி, அரசுத் தகவல், விளம்பரம், ஆவணக் காப்பகம்.' },
  TOURISM: { name: 'சுற்றுலா, பண்பாடு மற்றும் அறநிலையத் துறை',
    responsibilities: 'சுற்றுலா மேம்பாடு, பண்பாடு, கோயில்கள், சமய அறநிலையங்கள்.' },
  TRANSPORT: { name: 'போக்குவரத்துத் துறை',
    responsibilities: 'மோட்டார் வாகனங்கள், ஓட்டுநர் உரிமம், வாகனப் பதிவு, பொதுப் போக்குவரத்து, சாலைப் பாதுகாப்பு.' },
  WATERRES: { name: 'நீர்வளத் துறை',
    responsibilities: 'பாசனம், ஆறுகள், ஏரிகள், கால்வாய்கள், நிலத்தடி நீர், நீர்வள மேலாண்மை.' },
  WDAP: { name: 'மாற்றுத்திறனாளிகள் நலத்துறை',
    responsibilities: 'மாற்றுத்திறனாளிகள் நலன், மாற்றுத்திறன் சான்றிதழ், உதவிச் சாதனங்கள், ஓய்வூதியம், அணுகல் வசதி.' },
  ENERGY: { name: 'மின்சாரத் துறை',
    responsibilities: 'மின்சார விநியோகம், மின் இணைப்பு, கட்டண விவகாரங்கள், புதுப்பிக்கத்தக்க எரிசக்தி.' },
  HIGHWAYS: { name: 'நெடுஞ்சாலைகள் மற்றும் சிறு துறைமுகங்கள் துறை',
    responsibilities: 'மாநில நெடுஞ்சாலைகள், சாலை அமைத்தல் மற்றும் பராமரிப்பு, பாலங்கள், சிறு துறைமுகங்கள்.' },
  PLANNING: { name: 'திட்டமிடல், வளர்ச்சி மற்றும் சிறப்புத் திட்டங்கள் துறை',
    responsibilities: 'மாநிலத் திட்டமிடல், வளர்ச்சித் திட்டங்கள், சிறப்பு முன்முயற்சிகள்.' },
  PAR: { name: 'பணியாளர் மற்றும் நிர்வாக சீர்திருத்தத் துறை',
    responsibilities: 'அரசுப் பணி விவகாரங்கள், நிர்வாக சீர்திருத்தம், பொதுமக்கள் குறைதீர்ப்பு, தகவல் அறியும் உரிமை நிர்வாகம்.' },
  HRM: { name: 'மனிதவள மேலாண்மைத் துறை',
    responsibilities: 'பணியாளர் தேர்வு, பணி நிபந்தனைகள், அரசு மனிதவள நிர்வாகம்.' },
  ASSEMBLY: { name: 'சட்டமன்றத் துறை',
    responsibilities: 'சட்டமன்ற நிர்வாகம் மற்றும் சட்டமன்றப் பணிகள்.' },
  ELECTION: { name: 'தேர்தல் மற்றும் மறுவாழ்வு உள்ளிட்ட பொதுப் பணிகள்',
    responsibilities: 'தேர்தல், வாக்காளர் பட்டியல், வாக்காளர் விவகாரங்கள், மறுவாழ்வுத் திட்டங்கள்.' },
  SPI: { name: 'சிறப்புத் திட்ட அமலாக்கத் துறை',
    responsibilities: 'சிறப்பு அரசுத் திட்டங்களின் அமலாக்கம் மற்றும் கண்காணிப்பு.' },
  YOUTH: { name: 'இளைஞர் நலன் மற்றும் விளையாட்டு மேம்பாட்டுத் துறை',
    responsibilities: 'இளைஞர் நலன், விளையாட்டு மேம்பாடு, விளையாட்டரங்குகள், விளையாட்டுத் திட்டங்கள்.' },
  NATRES: { name: 'இயற்கை வளங்கள் துறை',
    responsibilities: 'இயற்கை வள நிர்வாகம் மற்றும் பாதுகாப்பு.' },
  HRCE: { name: 'இந்து சமய அறநிலையத் துறை',
    responsibilities: 'இந்து சமய நிறுவனங்கள், கோயில் நிலங்கள், அறநிலையங்களின் நிர்வாகம்.' },
  SOCDEF: { name: 'சமூகப் பாதுகாப்புத் துறை',
    responsibilities: 'சிறார் நீதி, பராமரிப்பு தேவைப்படும் குழந்தைகள், ஆதரவற்றோர் இல்லங்கள்.' },
  ICDS: { name: 'ஊட்டச்சத்து / ஒருங்கிணைந்த குழந்தை வளர்ச்சித் திட்டம்',
    responsibilities: 'ஒருங்கிணைந்த குழந்தை வளர்ச்சிப் பணிகள், அங்கன்வாடி மையங்கள், கூடுதல் ஊட்டச்சத்து.' },
  KVIC: { name: 'ஊரகத் தொழில்கள் / காதி மற்றும் கிராமத் தொழில்கள்',
    responsibilities: 'ஊரகத் தொழில்கள், காதி மற்றும் கிராமத் தொழில்கள், ஊரக வேலைவாய்ப்பு உருவாக்கம்.' },
  COOPAUDIT: { name: 'கூட்டுறவு தணிக்கைத் துறை',
    responsibilities: 'கூட்டுறவுச் சங்கங்களின் தணிக்கை.' },
  TREASURY: { name: 'கருவூலம் மற்றும் கணக்குத் துறை',
    responsibilities: 'கருவூலப் பணிகள், அரசுக் கணக்குகள், பணம் வழங்குதல்.' },
  LFA: { name: 'உள்ளாட்சி நிதி தணிக்கைத் துறை',
    responsibilities: 'உள்ளாட்சி அமைப்புகள் மற்றும் உள்ளாட்சி நிதியின் தணிக்கை.' },
  PENSION: { name: 'ஓய்வூதியத் துறை',
    responsibilities: 'அரசு ஊழியர் ஓய்வூதியம் வழங்குதல், ஓய்வூதியத் திருத்தம், ஓய்வூதியதாரர் குறைகள்.' },
  SMALLSAV: { name: 'சிறு சேமிப்புத் துறை',
    responsibilities: 'சிறு சேமிப்புத் திட்டங்கள் மற்றும் வைப்புத் திரட்டல்.' },
  EGOV: { name: 'அரசு தரவு மையம் / மின்னாளுகை',
    responsibilities: 'அரசு தரவு மையம், மின்னாளுகை தளங்கள், இணையச் சேவை வழங்கல்.' },
};

export const AUTHORITY_NAMES_TA: Record<string, { designation: string; office?: string }> = {
  'District Collector': { designation: 'மாவட்ட ஆட்சியர்', office: 'மாவட்ட ஆட்சியர் அலுவலகம்' },
  'Revenue Divisional Officer': { designation: 'வருவாய் கோட்டாட்சியர்', office: 'வருவாய் கோட்ட அலுவலகம்' },
  Tahsildar: { designation: 'வட்டாட்சியர்', office: 'வட்டாட்சியர் அலுவலகம்' },
  'Village Administrative Officer': { designation: 'கிராம நிர்வாக அலுவலர்', office: 'கிராம நிர்வாக அலுவலகம்' },
  'Sub Registrar': { designation: 'சார்பதிவாளர்', office: 'சார்பதிவாளர் அலுவலகம்' },
  'District Registrar': { designation: 'மாவட்டப் பதிவாளர்', office: 'மாவட்டப் பதிவாளர் அலுவலகம்' },
  'District Social Welfare Officer': { designation: 'மாவட்ட சமூக நல அலுவலர்', office: 'மாவட்ட சமூக நல அலுவலகம்' },
  'Maintenance Tribunal (Revenue Divisional Officer)': { designation: 'பராமரிப்பு தீர்ப்பாயம் (வருவாய் கோட்டாட்சியர்)', office: 'பராமரிப்பு தீர்ப்பாயம்' },
  'District Supply Officer': { designation: 'மாவட்ட வழங்கல் அலுவலர்', office: 'மாவட்ட வழங்கல் அலுவலகம்' },
  'Superintendent of Police': { designation: 'காவல் கண்காணிப்பாளர்', office: 'மாவட்ட காவல் அலுவலகம்' },
  'Station House Officer': { designation: 'காவல் நிலைய அலுவலர்', office: 'காவல் நிலையம்' },
  'Joint Director of Health Services': { designation: 'இணை இயக்குநர், சுகாதாரப் பணிகள்', office: 'மாவட்ட சுகாதார அலுவலகம்' },
  'Chief Educational Officer': { designation: 'முதன்மைக் கல்வி அலுவலர்', office: 'மாவட்டக் கல்வி அலுவலகம்' },
  'District Educational Officer': { designation: 'மாவட்டக் கல்வி அலுவலர்', office: 'மாவட்டக் கல்வி அலுவலகம்' },
  'Block Development Officer': { designation: 'ஊராட்சி ஒன்றிய வளர்ச்சி அலுவலர்', office: 'ஊராட்சி ஒன்றிய அலுவலகம்' },
  'District Collector (Disaster Management)': { designation: 'மாவட்ட ஆட்சியர் (பேரிடர் மேலாண்மை)', office: 'மாவட்ட பேரிடர் மேலாண்மை ஆணையம்' },
  'Commissioner, Municipal Corporation': { designation: 'ஆணையர், மாநகராட்சி', office: 'மாநகராட்சி' },
  'Municipal Commissioner': { designation: 'நகராட்சி ஆணையர', office: 'நகராட்சி' },
  'Executive Engineer, TANGEDCO': { designation: 'செயற்பொறியாளர், தமிழ்நாடு மின் பகிர்மான கழகம்', office: 'மின்சார வாரிய அலுவலகம்' },
  'Regional Transport Officer': { designation: 'மண்டலப் போக்குவரத்து அலுவலர்', office: 'மண்டலப் போக்குவரத்து அலுவலகம்' },
  'Deputy Commissioner of Labour': { designation: 'துணை ஆணையர், தொழிலாளர் நலன்', office: 'தொழிலாளர் நல அலுவலகம்' },
  'District Environmental Engineer, TNPCB': { designation: 'மாவட்ட சுற்றுச்சூழல் பொறியாளர், மாசுக் கட்டுப்பாட்டு வாரியம்', office: 'மாசுக் கட்டுப்பாட்டு வாரிய மாவட்ட அலுவலகம்' },
  'District Forest Officer': { designation: 'மாவட்ட வன அலுவலர்', office: 'மாவட்ட வன அலுவலகம்' },
  'Joint Director of Agriculture': { designation: 'இணை இயக்குநர், வேளாண்மை', office: 'மாவட்ட வேளாண்மை அலுவலகம்' },
  'District Adi Dravidar Welfare Officer': { designation: 'மாவட்ட ஆதிதிராவிடர் நல அலுவலர்', office: 'மாவட்ட ஆதிதிராவிடர் நல அலுவலகம்' },
  'District Backward Classes Welfare Officer': { designation: 'மாவட்ட பிற்படுத்தப்பட்டோர் நல அலுவலர்', office: 'மாவட்ட பிற்படுத்தப்பட்டோர் நல அலுவலகம்' },
  'District Differently Abled Welfare Officer': { designation: 'மாவட்ட மாற்றுத்திறனாளிகள் நல அலுவலர்', office: 'மாவட்ட மாற்றுத்திறனாளிகள் நல அலுவலகம்' },
  'Secretary, District Legal Services Authority': { designation: 'செயலாளர், மாவட்ட சட்டப் பணிகள் ஆணையம்', office: 'மாவட்ட சட்டப் பணிகள் ஆணையம்' },
  'Executive Engineer, Public Works Department': { designation: 'செயற்பொறியாளர், பொதுப்பணித் துறை', office: 'பொதுப்பணித் துறை கோட்ட அலுவலகம்' },
  'Divisional Engineer, Highways': { designation: 'கோட்டப் பொறியாளர், நெடுஞ்சாலைகள்', office: 'நெடுஞ்சாலைக் கோட்ட அலுவலகம்' },
  'Executive Officer, Temple (HR&CE)': { designation: 'செயல் அலுவலர், கோயில் (அறநிலையத் துறை)', office: 'கோயில் நிர்வாக அலுவலகம்' },
  'Assistant Director, Town and Country Planning': { designation: 'உதவி இயக்குநர், நகர்ப்புற ஊரக திட்டமிடல்', office: 'நகர்ப்புற ஊரக திட்டமிடல் அலுவலகம்' },
  'Deputy Registrar of Co-operative Societies': { designation: 'துணைப் பதிவாளர், கூட்டுறவுச் சங்கங்கள்', office: 'கூட்டுறவுச் சங்கங்கள் அலுவலகம்' },
  'Assistant Commissioner (Commercial Taxes)': { designation: 'உதவி ஆணையர் (வணிக வரிகள்)', office: 'வணிக வரிகள் அலுவலகம்' },
  'District Child Protection Officer': { designation: 'மாவட்ட குழந்தைகள் பாதுகாப்பு அலுவலர்', office: 'மாவட்ட குழந்தைகள் பாதுகாப்பு அலகு' },
  'Assistant Director, Fisheries': { designation: 'உதவி இயக்குநர், மீன்வளம்', office: 'மாவட்ட மீன்வள அலுவலகம்' },
  'Regional Joint Director, Animal Husbandry': { designation: 'மண்டல இணை இயக்குநர், கால்நடை பராமரிப்பு', office: 'கால்நடை பராமரிப்பு அலுவலகம்' },
  'General Manager, District Industries Centre': { designation: 'பொது மேலாளர், மாவட்டத் தொழில் மையம்', office: 'மாவட்டத் தொழில் மையம்' },
  'Public Information Officer': { designation: 'பொதுத் தகவல் அலுவலர்', office: 'சம்பந்தப்பட்ட பொது அமைப்பு' },
  'Electoral Registration Officer': { designation: 'வாக்காளர் பதிவு அலுவலர்', office: 'தேர்தல் அலுவலகம்' },
  'Treasury Officer': { designation: 'கருவூல அலுவலர்', office: 'மாவட்டக் கருவூலம்' },
  'Executive Engineer, Water Resources Department': { designation: 'செயற்பொறியாளர், நீர்வளத் துறை', office: 'நீர்வளத் துறை கோட்ட அலுவலகம்' },
  'Assistant Director, Town Panchayat': { designation: 'உதவி இயக்குநர், பேரூராட்சி', office: 'பேரூராட்சி அலுவலகம்' },
  'District Employment Officer': { designation: 'மாவட்ட வேலைவாய்ப்பு அலுவலர்', office: 'மாவட்ட வேலைவாய்ப்பு அலுவலகம்' },
  'Assistant Engineer, Highways': { designation: 'உதவிப் பொறியாளர், நெடுஞ்சாலைகள்', office: 'நெடுஞ்சாலை உட்கோட்ட அலுவலகம்' },
};

export const SUBJECT_NAMES_TA: Record<string, string> = {
  LAND_RECORDS: 'நில ஆவணம் / பட்டா',
  LAND_ENCROACHMENT: 'நில ஆக்கிரமிப்பு',
  PROPERTY_TRANSFER: 'சொத்து விற்பனை / மாற்றம்',
  SENIOR_CITIZEN: 'மூத்த குடிமக்கள் நலன்',
  PENSION_SCHEME: 'ஓய்வூதியம் / சமூகப் பாதுகாப்பு',
  WOMEN_SAFETY: 'மகளிர் பாதுகாப்பு மற்றும் நலன்',
  CHILD_WELFARE: 'குழந்தைகள் நலன் மற்றும் பாதுகாப்பு',
  DISABILITY: 'மாற்றுத்திறனாளிகள் நலன்',
  RATION_PDS: 'ரேஷன் மற்றும் உணவு விநியோகம்',
  HEALTH_SERVICE: 'சுகாதாரம் மற்றும் மருத்துவம்',
  EDUCATION: 'கல்வி',
  CIVIC_WATER: 'குடிநீர் மற்றும் சுகாதாரம்',
  CIVIC_ROAD: 'சாலைகள் மற்றும் உள்கட்டமைப்பு',
  ELECTRICITY: 'மின்சார விநியோகம்',
  EMPLOYMENT_WAGES: 'வேலைவாய்ப்பு மற்றும் ஊதியம்',
  AGRICULTURE: 'வேளாண்மை மற்றும் விவசாயி நலன்',
  POLICE_MATTER: 'காவல்துறை மற்றும் சட்டம் ஒழுங்கு',
  POLLUTION: 'மாசுபாடு மற்றும் சுற்றுச்சூழல்',
  HOUSING_MATTER: 'வீட்டுவசதி மற்றும் கட்டிடம்',
  TRANSPORT_MATTER: 'போக்குவரத்து மற்றும் வாகனங்கள்',
  RTI_MATTER: 'தகவல் அறியும் உரிமை',
  GENERAL: 'பொதுக் குறை',
};
