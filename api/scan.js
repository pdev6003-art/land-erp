// Scanner — runs on Vercel's server, never in the browser.
// The API key lives only in process.env here, so it is never sent to the visitor.
//
// Two modes:
//   mode 'card' (default) — reads photos of a visiting card -> contact fields
//   mode 'land'           — reads a broker's WhatsApp message -> land fields

const MODEL = 'claude-sonnet-4-6';
const MAX_IMAGES = 4;
const MAX_TEXT = 6000;

const CARD_CATEGORIES = [
  'Land', 'Industrial plot', 'Residential plot', 'Village / Agricultural land',
  'Non-agricultural (NA) land', 'Office', 'Showrooms', 'Warehouse',
  'Flat', 'Bungalow', 'Weekend / Farm house'
];

const CARD_PROMPT = `You are reading photographs of a business/visiting card belonging to a property broker or estate agent in India. The photos may be the front and back of the same card.

The card may be in English, Gujarati, or both — read both scripts. If the same detail appears in two scripts, prefer the English/Latin version.

Return ONLY a JSON object, with no markdown fences and no commentary, in exactly this shape:
{"name":"","mobile":"","name2":"","mobile2":"","email":"","company":"","address":"","rera":"","deals":[]}

Rules:
- name / mobile: the FIRST person on the card and their mobile number.
- name2 / mobile2: a SECOND person and their number, if the card shows two people. Many partnership cards print one name and number in each top corner — keep each name with the number printed beside it. If the card shows two numbers for the SAME single person, put the second number in mobile2 and leave name2 "". If there is only one person and one number, leave both name2 and mobile2 "".
- Never split one person's name across name and name2.
- All mobile numbers: digits and spaces only. Drop +91, "M.", "Mo.", and WhatsApp/phone icons. An "Office :" landline is NOT a mobile — put it in neither field.
- email: lowercase.
- company: the firm or business name (e.g. "Dhaval Patel Real Estate", "Ashok Negi Real Estate Agent"). If the card shows only a person's name with a tagline like "Luxury Realtor", leave company "".
- address: the full postal address on one line, comma separated. Do not include the email or phone numbers here.
- rera: the RERA registration number if printed (often labelled "RERA Reg.", "RERA No.", "Rera Reg."). Copy it exactly as printed, e.g. "AA03730/040727R1". "" if absent.
- deals: what the card says the broker deals in. Cards usually print a strip like "Flat • Bunglow • Office • Shops • Plot — Rent & Sale" or "Land Purchase & Sell | Commercial and Retail Leasing".
  Each entry is {"category":"...","modes":["..."]}.
  category MUST be exactly one of: ${CARD_CATEGORIES.map(c => '"' + c + '"').join(', ')}.
  Map the card's wording: "Shops"/"Shop" -> "Showrooms"; "Bunglow"/"Banglow" -> "Bungalow"; "Plot"/"Plots" alone -> "Residential plot"; "Farm House"/"Weekend Home" -> "Weekend / Farm house"; "Agriculture land"/"Vadi"/"Kheti" -> "Village / Agricultural land"; "NA land" -> "Non-agricultural (NA) land"; "Godown" -> "Warehouse"; "Commercial"/"Retail" -> "Showrooms".
  modes is a list from "buy", "sell", "lease". Map: "Sale"/"Sell"/"Selling" -> "sell"; "Purchase"/"Buy"/"Buying" -> "buy"; "Rent"/"Rental"/"Lease"/"Leasing"/"Renting" -> "lease". "Rent & Sale" means ["lease","sell"]. "Purchase & Sell" means ["buy","sell"].
  If the card lists property types but no modes at all, use ["buy","sell"].
  If a mode line clearly applies to every listed type (a strip like "Rent & Sale" under the list), give that same modes list to every category.
  Return [] if the card does not say what they deal in. Never guess a category that is not printed.
- Use an empty string "" for anything not visible on the card. Never invent a value.`;

const LAND_PROMPT = `You are reading a message a property broker in Gujarat, India sent about ONE piece of land. It is written informally in Gujarati, in Gujarati words typed with English letters, or a mix. Spacing and punctuation are erratic (e.g. "T . P . 214", "6,860 /- var che").

GLOSSARY — this is how these brokers write:
- "Moje" / "મોજે" = the village name.
- "var" / "વાર" = square yard. "6,860 var" means 6860 Sq. Yard.
- "vigha"/"bigha" = Bigha. "guntha", "acre", "hectare", "sq ft", "sq mt", "chorasvar" also appear.
- "T.P." = Town Planning scheme number. "F.P." = Final Plot number.
- "Final plot area" = the FP measurement (an AREA, not a plot number).
- "Survey no" / "S.No" / "block no" = survey number.
- "N.A." = Non-Agricultural land. "J" / "Jaji" / "kheti" = agricultural.
- "FSI" = floor space index. "4 ni FSI che" means FSI is 4.
- "che" = "is". "sathe" = "with". "thi" = "from". "Nr" / "pase" = near.
- "possession sathe" = possession is included.
- Zones are written loosely: "C 4", "R-3", "R 3 che", "Affordable" (= residential affordable housing), "Gamtal", "Agri".

Return ONLY a JSON object, no markdown fences and no commentary, in exactly this shape:
{"village":"","district":"","landType":"","survey":"","tp":"","fp":"","surveyArea":"","surveyUnit":"","fpArea":"","fpUnit":"","zone":"","fsi":"","rate":"","rateUnit":"","remark":""}

Rules:
- village: just the place name after "Moje", in English letters, properly capitalised (e.g. "Kudasan", "Thaltej", "Oganaj").
- district: ONLY if the message actually names a district or city. Never infer it from the village. Leave "" otherwise.
- landType: one of "NA", "A", "TP", "DP", or "". Use "NA" when the message says N.A. / non-agricultural.
- survey / tp / fp: digits only as written (e.g. "214", "3", "408"). "" if absent. Do NOT put an area in these.
- surveyArea / fpArea: digits only, no commas or units (e.g. "6860"). "Final plot area" goes to fpArea, NOT surveyArea.
- surveyUnit / fpUnit: exactly one of "Sq. Yard", "Sq. Feet", "Sq. Meter", "Bigha", "Acre", "Hectare". "var" means "Sq. Yard". Only set a unit when its matching area is set.
- zone: a SHORT code only — one of "R-1","R-2","R-3","R-AH","C-1","C-2","C-3","C-4","IG","IS","PU","OS","A","KZ","TZ","GME", or "". "Affordable" means "R-AH". "C 4" means "C-4".
- fsi: the total FSI as a plain number (e.g. "4", "1.8"). "" if not stated.
- rate / rateUnit: only if a PRICE is stated. rate is digits only. rateUnit is one of "Sq. Yard","Sq. Feet","Sq. Meter","Bigha","Acre","Hectare". Treat "kimat", "bhav", "rate" as price. "" if no price.
- remark: everything else that matters, as short readable English sentences separated by ". " — road frontage ("Touches 24 metre road"), corners ("Corner of two roads, 18 m by 18 m"), landmarks ("Near Sindhu Bhavan"), distances ("150 m from ring road"), and possession ("Possession included"). Do NOT repeat the village, TP, FP, area, zone or FSI here.
- Use "" for anything the message does not state. NEVER guess or invent a value.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY is not set in the Vercel environment variables.'
    });
  }

  const body = req.body || {};
  const mode = body.mode === 'land' ? 'land' : 'card';

  let content;
  if (mode === 'land') {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return res.status(400).json({ error: 'Paste the broker message first.' });
    if (text.length > MAX_TEXT) {
      return res.status(400).json({ error: 'That message is too long — paste one land at a time.' });
    }
    content = [{ type: 'text', text: LAND_PROMPT + '\n\nMESSAGE:\n"""\n' + text + '\n"""' }];
  } else {
    const images = body.images || [];
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'No card photos received.' });
    }
    if (images.length > MAX_IMAGES) {
      return res.status(400).json({ error: `Please send at most ${MAX_IMAGES} photos.` });
    }
    // Both photos go into ONE message, so front + back cost a single request.
    content = images.map(img => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.media_type || 'image/jpeg',
        data: img.data
      }
    }));
    content.push({ type: 'text', text: CARD_PROMPT });
  }

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content }]
      })
    });

    const payload = await apiRes.json();

    if (!apiRes.ok) {
      const msg = (payload && payload.error && payload.error.message) || 'Anthropic API error.';
      // Log server-side only — never leak key details to the browser.
      console.error('Anthropic error', apiRes.status, msg);
      return res.status(502).json({ error: msg });
    }

    if (payload.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'That content could not be processed.' });
    }

    const text = (payload.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    const obj = parseJson(text);
    if (!obj) {
      console.error('Unparseable model output:', text.slice(0, 400));
      return res.status(502).json({
        error: mode === 'land'
          ? 'Could not read that message. Try pasting just one land.'
          : 'Could not read the card. Try a clearer photo.'
      });
    }

    return res.status(200).json(mode === 'land' ? shapeLand(obj) : shapeCard(obj));
  } catch (err) {
    console.error('scan failed', err);
    return res.status(500).json({ error: 'Scan failed. Please try again.' });
  }
};

// The model is asked for bare JSON, but strip fences defensively.
function parseJson(text) {
  if (!text) return null;
  let t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    return obj && typeof obj === 'object' ? obj : null;
  } catch (e) {
    return null;
  }
}

const str = v => (typeof v === 'string' ? v.trim() : (typeof v === 'number' ? String(v) : ''));
// keeps a decimal point (areas, FSI, rates) but drops stray dots from "T . P . 214"
const digits = v => {
  const s = str(v).replace(/[^\d.]/g, '').replace(/\.(?=.*\.)/g, '');
  return /^\.?\d/.test(s) ? s.replace(/^\.+/, '').replace(/\.+$/, '') : '';
};
const intOnly = v => str(v).replace(/\D/g, '');

const MODES = ['buy', 'sell', 'lease'];
// digits and spacing only, with a leading +91 country code dropped
const phone = v => {
  let s = str(v).replace(/[^\d\s]/g, '').replace(/\s+/g, ' ').trim();
  const d = s.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) {
    const stripped = s.replace(/^9\s*1\s*/, '').trim();
    s = stripped.replace(/\D/g, '').length === 10 ? stripped : d.slice(2);
  }
  return s;
};

function shapeCard(o) {
  const name = str(o.name), name2 = str(o.name2);
  const mobile = phone(o.mobile), mobile2 = phone(o.mobile2);
  return {
    name,
    mobile,
    // a second contact only counts if it actually adds something new
    name2: name2 && name2.toLowerCase() !== name.toLowerCase() ? name2 : '',
    mobile2: mobile2 && mobile2 !== mobile ? mobile2 : '',
    email: str(o.email).toLowerCase(),
    company: str(o.company),
    address: str(o.address),
    rera: str(o.rera),
    deals: shapeDeals(o.deals)
  };
}

function shapeDeals(list) {
  if (!Array.isArray(list)) return [];
  const out = {};
  list.forEach(d => {
    if (!d || typeof d !== 'object') return;
    const cat = oneOf(d.category, CARD_CATEGORIES);
    if (!cat) return;
    const modes = Array.isArray(d.modes)
      ? d.modes.map(m => str(m).toLowerCase()).filter(m => MODES.includes(m))
      : [];
    if (!modes.length) return;
    out[cat] = [...new Set([...(out[cat] || []), ...modes])];
  });
  return Object.entries(out).map(([category, modes]) => ({ category, modes }));
}

const UNITS = ['Sq. Yard', 'Sq. Feet', 'Sq. Meter', 'Bigha', 'Acre', 'Hectare'];
const ZONES = ['R-1','R-2','R-3','R-AH','C-1','C-2','C-3','C-4','IG','IS','PU','OS','A','KZ','TZ','GME'];
const TYPES = ['NA', 'A', 'TP', 'DP'];
const oneOf = (v, list) => (list.includes(str(v)) ? str(v) : '');

function shapeLand(o) {
  const surveyArea = digits(o.surveyArea);
  const fpArea = digits(o.fpArea);
  return {
    village: str(o.village),
    district: str(o.district),
    landType: oneOf(o.landType, TYPES),
    survey: str(o.survey),
    tp: intOnly(o.tp),
    fp: intOnly(o.fp),
    surveyArea,
    surveyUnit: surveyArea ? (oneOf(o.surveyUnit, UNITS) || 'Sq. Yard') : '',
    fpArea,
    fpUnit: fpArea ? (oneOf(o.fpUnit, UNITS) || 'Sq. Yard') : '',
    zone: oneOf(o.zone, ZONES),
    fsi: digits(o.fsi),
    rate: digits(o.rate),
    rateUnit: digits(o.rate) ? (oneOf(o.rateUnit, UNITS) || 'Sq. Yard') : '',
    remark: str(o.remark)
  };
}
