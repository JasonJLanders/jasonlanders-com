// api/fine-print.js -- Vercel serverless function

module.exports = async function handler(req, res) {
  // Log immediately so we know the function is running
  console.log('Fine Print called, method:', req.method);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse body -- Vercel may pass it as string or object
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    console.log('Body parse error:', e.message, 'raw body:', req.body);
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const jobDescription = body?.jobDescription;
  console.log('JD length:', jobDescription?.length);

  if (!jobDescription || jobDescription.trim().length < 100) {
    return res.status(400).json({ error: 'Please paste a complete job description.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  console.log('API key present:', !!apiKey);

  if (!apiKey) {
    return res.status(503).json({ rateLimited: true });
  }

  const prompt = `You are an expert Sales Engineering career advisor. Analyze this job description and return ONLY a JSON object with no markdown or explanation.

JOB DESCRIPTION:
${jobDescription.slice(0, 5000)}

Return exactly this JSON structure:
{
  "overallScore": <number 0-100>,
  "overallVerdict": "<Solid Role | Mostly Solid | Proceed with Caution | Significant Concerns>",
  "summary": "<2-3 sentences honest assessment for an experienced SE>",
  "dimensions": {
    "compensation": { "score": <0-20>, "label": "<Strong | Fair | Unclear | Weak>", "note": "<1 sentence>" },
    "technicalDepth": { "score": <0-20>, "label": "<Strong | Fair | Unclear | Weak>", "note": "<1 sentence>" },
    "careerPath": { "score": <0-20>, "label": "<Clear | Mentioned | Vague | Absent>", "note": "<1 sentence>" },
    "seMotion": { "score": <0-20>, "label": "<Structured | Developing | Unclear | Concerning>", "note": "<1 sentence>" },
    "workLifeBalance": { "score": <0-20>, "label": "<Healthy | Typical | Watch Out | Red Flag>", "note": "<1 sentence>" }
  },
  "greenFlags": ["<positive signal>", "<another>"],
  "yellowFlags": ["<worth asking about>", "<another>"],
  "interviewQuestions": ["<question 1>", "<question 2>", "<question 3>"]
}`;

  try {
    console.log('Calling Gemini API...');
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
        })
      }
    );

    console.log('Gemini status:', geminiRes.status);
    const data = await geminiRes.json();

    if (geminiRes.status === 429) {
      console.log('Rate limited:', JSON.stringify(data).slice(0, 200));
      return res.status(429).json({ rateLimited: true });
    }

    if (!geminiRes.ok) {
      console.log('Gemini error:', JSON.stringify(data).slice(0, 300));
      return res.status(503).json({ rateLimited: true });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.log('No text in response:', JSON.stringify(data).slice(0, 200));
      return res.status(503).json({ rateLimited: true });
    }

    console.log('Got response, parsing JSON...');
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(clean);
    console.log('Success, score:', result.overallScore);
    return res.status(200).json(result);

  } catch (err) {
    console.log('Caught error:', err?.message || String(err));
    return res.status(503).json({ rateLimited: true });
  }
};
