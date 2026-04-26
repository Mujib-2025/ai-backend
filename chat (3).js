// netlify/functions/chat.js
const OpenAI = require("openai");

// Helper to safely extract JSON from AI response
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
  // CORS headers (allow from anywhere)
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const {
      messages,
      mode = "edit",
      sandboxHTML = "",
    } = JSON.parse(event.body);
    if (!messages || !Array.isArray(messages)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "messages array required" }),
      };
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    let systemContent, temperature, maxTokens;

    if (mode === "generate") {
      systemContent = `You are a world‑class web designer and front‑end developer.
You create **complete, modern, fully responsive** HTML pages (including CSS and JavaScript) based on the user's request.

Your response must be a valid JSON object:
{
  "code": "<full HTML page (from <!DOCTYPE html> to </html>)>",
  "description": "a short, friendly summary of what you built"
}

The HTML must be beautiful, production‑ready, and include all necessary tags (doctype, head, body, meta viewport, etc.).
Use modern CSS (grid, flexbox, gradients, shadows, animations) and make everything interactive.

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
      maxTokens = 6000;
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
      maxTokens = 4096;
    }

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemContent }, ...messages],
      temperature,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    });

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
    console.error("CHAT FUNCTION ERROR:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ code: null, description: "Server error." }),
    };
  }
};
