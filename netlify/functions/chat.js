// netlify/functions/chat.js
const OpenAI = require("openai");

// Helper to safely extract JSON from AI response (unchanged, battle-tested)
function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    let cleaned = text
      .replace(/```json\s*([\s\S]*?)\s*```/g, "$1")
      .replace(/```html\s*([\s\S]*?)\s*```/g, "$1")
      .replace(/```javascript\s*([\s\S]*?)\s*```/g, "$1")
      .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.substring(start, end + 1);
      try {
        return JSON.parse(cleaned);
      } catch (e2) {
        try {
          return JSON.parse(cleaned.replace(/'/g, '"'));
        } catch (e3) {
          return null;
        }
      }
    }
    return null;
  }
}

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // Abort controller to enforce a 9‑second limit (keeping a 1‑second safety margin)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 9000);

  try {
    const {
      messages,
      mode = "edit",
      sandboxHTML = "",
    } = JSON.parse(event.body);
    if (!messages || !Array.isArray(messages)) {
      clearTimeout(timeoutId);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "messages array required" }),
      };
    }

    const client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.DEEPSEEK_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": "https://your-site-url.com", // optional
        "X-Title": "AI Builder",
      },
    });

    let systemContent, temperature, maxTokens;

    if (mode === "generate") {
      systemContent = `You are a world‑class web designer and front‑end developer.
You create **complete, modern, fully responsive** HTML pages (including CSS and JavaScript) based on the user's request.

Your response must be a valid JSON object:
{
  "code": "<full HTML page (from <!DOCTYPE html> to </html>)>",
  "description": "a short, friendly summary of what you built"
}

IMPORTANT: Keep the total HTML under 3000 tokens. Use efficient, clean code.

🖼️ **IMAGE RULES (CRITICAL)**:
- ALWAYS use absolute, working image URLs starting with "https://".
- NEVER use local file names like "image.png", "/img/hero.jpg", or "./photo.jpg".
- Use real placeholder services:
    - "https://picsum.photos/WIDTH/HEIGHT" (random photo)
    - "https://images.unsplash.com/photo-ID?w=WIDTH&h=HEIGHT" (specific photo)
    - "https://via.placeholder.com/WIDTHxHEIGHT?text=TEXT" (colored placeholder)
- All images must be directly viewable in a browser.
`;
      temperature = 0.3;
      maxTokens = 3000; // reduced from 6000 to prevent timeout
    } else {
      systemContent = `You are an expert front‑end developer. The user is working on a web page inside a sandbox.
The current content is:

\`\`\`html
${sandboxHTML || "(empty)"}
\`\`\`

Your task: **modify or extend** the existing page using JavaScript DOM code.
- Preserve all existing elements unless the user explicitly asks to remove/replace something.
- Use standard methods (querySelector, createElement, appendChild, innerHTML on specific containers).
- The code will run inside the sandbox (which may contain an iframe with id "sandbox-iframe").
  If the content is inside that iframe, you must access it via:
    const iframe = document.getElementById('sandbox-iframe');
    const doc = iframe.contentDocument;
  and then manipulate the iframe's document.
- Never use alert, prompt, or document.write.

🖼️ **IMAGE RULES**:
- When adding an image, use an absolute "https://" URL.
- Use "https://picsum.photos/400/300" or "https://via.placeholder.com/400x300?text=Image" as a placeholder.
- NEVER use local file paths like "image.png" or "./image.jpg".

- Return ONLY a JSON object: {"code": "...", "description": "..."}
- The "code" field must be executable JavaScript (no markdown inside the string).`;
      temperature = 0.5;
      maxTokens = 2048; // reduced to speed up
    }

    // DeepSeek V4 Flash – fast, but if you experience more timeouts, swap to "deepseek/deepseek-chat"
    const completion = await client.chat.completions.create(
      {
        model: "deepseek/deepseek-v4-flash",
        messages: [{ role: "system", content: systemContent }, ...messages],
        temperature,
        max_tokens: maxTokens,
      },
      { signal: controller.signal },
    );

    clearTimeout(timeoutId);

    const text = completion.choices[0].message.content;
    const parsed = extractJSON(text);

    if (
      parsed &&
      typeof parsed.code === "string" &&
      typeof parsed.description === "string"
    ) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          code: parsed.code,
          description: parsed.description,
        }),
      };
    } else {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          code: null,
          description: text || "Invalid response format.",
        }),
      };
    }
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("CHAT FUNCTION ERROR:", err);

    // Distinguish between timeout and other errors for a friendlier message
    const isTimeout = err.name === "AbortError" || err.code === "ETIMEDOUT";
    const userMsg = isTimeout
      ? "The generation took too long (timeout). Please try a simpler request or split it into smaller steps."
      : "Sorry, something went wrong. Server error.";

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        code: null,
        description: userMsg,
      }),
    };
  }
};
