// api/fine-print.js
// Vercel serverless function -- analyzes SE job descriptions via Gemini API

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { jobDescription } = req.body;

  if (!jobDescription || jobDescription.trim().length < 100) {
    return res.status(400).json({ error: 'Please paste a complete job description (at least a few sentences).' });
  }

  if (jobDescription.length > 8000) {
    return res.status(400).json({ error: 'Job description is too long. Try pasting just the core sections.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ rateLimited: true });
  }

  const prompt = `You are an expert Sales Engineering career advisor with 20+ years of experience evaluating SE roles at B2B SaaS companies. Analyze this job description and return a JSON object only -- no markdown, no explanation, just the JSON.

JOB DESCRIPTION:
${jobDescription}

Return this exact JSON structure:
{
  "overallScore": <number 0-100>,
  "overallVerdict": "<one of: Solid Role | Mostly Solid | Proceed with Caution | Significant Concerns>",
  "summary": "<2-3 sentences honest assessment of this role for an experienced SE>",
  "dimensions": {
    "compensation": {
      "score": <0-20>,
      "label": "<one of: Strong | Fair | Unclear | Weak>",
      "note": "<1 sentence specific observation about comp structure, variable pay, or lack thereof>"
    },
    "technicalDepth": {
      "score": <0-20>,
      "label": "<one of: Strong | Fair | Unclear | Weak>",
      "note": "<1 sentence about whether this requires real technical depth or is presentation-focused>"
    },
    "careerPath": {
      "score": <0-20>,
      "label": "<one of: Clear | Mentioned | Vague | Absent>",
      "note": "<1 sentence about whether career growth is addressed>"
    },
    "seMotion": {
      "score": <0-20>,
      "label": "<one of: Structured | Developing | Unclear | Concerning>",
      "note": "<1 sentence about whether this company appears to have a real SE motion or is figuring it out>"
    },
    "workLifeBalance": {
      "score": <0-20>,
      "label": "<one of: Healthy | Typical | Watch Out | Red Flag>",
      "note": "<1 sentence about travel, hours, or on-call signals in the posting>"
    }
  },
  "greenFlags": ["<specific positive signal from the JD>", "<another>"],
  "yellowFlags": ["<something worth asking about in the interview>", "<another>"],
  "interviewQuestions": [
    "<specific question to ask based on what this JD reveals>",
    "<another question>",
    "<a third question>"
  ]
}

Be honest and specific. Reference actual language from the job description where possible. Be helpful and constructive -- the goal is to help SEs make informed decisions, not to scare them away from good opportunities.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1024,
          }
        })
      }
    );

    if (response.status === 429) {
      return res.status(429).json({ rateLimited: true });
    }

    if (!response.ok) {
      const err = await response.text();
      console.error('Gemini error:', err);
      return res.status(503).json({ rateLimited: true });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(503).json({ rateLimited: true });
    }

    // Strip any markdown code fences if present
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);

  } catch (err) {
    console.error('Fine Print API error:', err);
    return res.status(503).json({ rateLimited: true });
  }
}
