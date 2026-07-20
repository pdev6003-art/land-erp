// Visiting-card scanner — runs on Vercel's server, never in the browser.
// The API key lives only in process.env here, so it is never sent to the visitor.

const MODEL = 'claude-sonnet-4-6';
const MAX_IMAGES = 4;

const PROMPT = `You are reading photographs of a business/visiting card. The photos may be the front and back of the same card.

Extract the contact details. The card may be in English, Gujarati, or both — read both scripts. If the same detail appears in two scripts, prefer the English/Latin version.

Return ONLY a JSON object, with no markdown fences and no commentary, in exactly this shape:
{"name":"","mobile":"","email":"","company":"","address":""}

Rules:
- name: the person's name only (drop titles like Shri/Mr/Er and qualifications).
- mobile: one primary mobile number, digits and spaces only, no +91 country code, no labels.
- email: lowercase.
- company: the firm or business name.
- address: the full postal address on one line, comma separated.
- Use an empty string "" for anything not visible on the card. Never invent a value.`;

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

  const images = (req.body && req.body.images) || [];
  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'No card photos received.' });
  }
  if (images.length > MAX_IMAGES) {
    return res.status(400).json({ error: `Please send at most ${MAX_IMAGES} photos.` });
  }

  // Both photos go into ONE message, so front + back cost a single request.
  const content = images.map(img => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: img.media_type || 'image/jpeg',
      data: img.data
    }
  }));
  content.push({ type: 'text', text: PROMPT });

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
      return res.status(422).json({ error: 'The image could not be processed.' });
    }

    const text = (payload.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    const fields = parseFields(text);
    if (!fields) {
      console.error('Unparseable model output:', text.slice(0, 400));
      return res.status(502).json({ error: 'Could not read the card. Try a clearer photo.' });
    }

    return res.status(200).json(fields);
  } catch (err) {
    console.error('scan failed', err);
    return res.status(500).json({ error: 'Scan failed. Please try again.' });
  }
};

// The model is asked for bare JSON, but strip fences defensively.
function parseFields(text) {
  if (!text) return null;
  let t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  let obj;
  try {
    obj = JSON.parse(t.slice(start, end + 1));
  } catch (e) {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const str = v => (typeof v === 'string' ? v.trim() : '');
  return {
    name: str(obj.name),
    mobile: str(obj.mobile),
    email: str(obj.email).toLowerCase(),
    company: str(obj.company),
    address: str(obj.address)
  };
}
