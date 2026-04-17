// api/jeopardy.js -- Vercel serverless function for SE Jeopardy board generation

module.exports = async function handler(req, res) {
  console.log('SE Jeopardy called, method:', req.method);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const { content, url } = body;
  const sourceText = content || '';
  console.log('Content length:', sourceText.length, 'URL:', url || 'none');

  if (sourceText.trim().length < 200) {
    return res.status(400).json({ error: 'Not enough content to generate a game. Paste more text or try a different URL.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(429).json({ rateLimited: true });
  }

  const prompt = `You are an expert quiz writer for technical sales training. You will be given product or technical documentation. Generate a Jeopardy-style quiz board.

RULES:
- Create exactly 5 categories relevant to the content
- Each category has exactly 5 clues at point values: 200, 400, 600, 800, 1000
- Higher point values = harder clues
- All clues must be answerable from the provided content
- Each clue needs exactly 4 multiple choice options (A, B, C, D), with exactly one correct answer
- Clues should be phrased as statements (Jeopardy style: "This is the term for...")
- Answers should be concise (1-5 words ideally)
- Make questions that would genuinely test SE/presales knowledge of the product

CONTENT:
${sourceText.slice(0, 8000)}

Return ONLY a valid JSON object with NO markdown, NO explanation, NO code blocks. Use this exact structure:
{
  "title": "<short descriptive title for this board, e.g. 'Datadog Observability'>",
  "categories": [
    {
      "name": "<category name, max 3 words>",
      "clues": [
        {
          "points": 200,
          "clue": "<the jeopardy clue statement>",
          "options": ["<option A>", "<option B>", "<option C>", "<option D>"],
          "correct": 0
        }
      ]
    }
  ]
}

The "correct" field is the 0-based index of the correct option in the options array.`;

  try {
    console.log('Calling Gemini API...');
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 4096 }
        })
      }
    );

    console.log('Gemini status:', geminiRes.status);
    const data = await geminiRes.json();

    if (geminiRes.status === 429) {
      return res.status(429).json({ rateLimited: true });
    }

    if (!geminiRes.ok) {
      console.log('Gemini error:', JSON.stringify(data).slice(0, 300));
      return res.status(503).json({ error: 'Generation failed' });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return res.status(503).json({ error: 'No response from AI' });
    }

    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(clean);

    // Validate structure
    if (!result.categories || result.categories.length !== 5) {
      return res.status(503).json({ error: 'Invalid board structure generated' });
    }

    console.log('Board generated:', result.title, '- categories:', result.categories.map(c => c.name).join(', '));
    return res.status(200).json(result);

  } catch (err) {
    console.log('Error:', err?.message || String(err));
    return res.status(503).json({ error: 'Failed to generate board. Try again.' });
  }
};
