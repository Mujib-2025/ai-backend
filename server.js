// server.js – AI backend for Render (full CORS, streaming + non‑streaming)
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

// --------------- CORS – allow all origins ---------------
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json({ limit: "5mb" }));

// --------------- OpenAI client (OpenRouter) ---------------
const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.DEEPSEEK_API_KEY || "missing-api-key",
  defaultHeaders: {
    "HTTP-Referer": process.env.REFERER_URL || "http://localhost:3000",
    "X-Title": "AI Builder",
  },
});

// --------------- Helper: extract JSON from AI response ---------------
function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    let cleaned = text
      .replace(/```json\s*([\s\S]*?)\s*```/g, "$1")
      .replace(/```html\s*([\s\S]*?)\s*```/g, "$1")
      .replace(/```javascript\s*([\s\S]*?)\s*```/g, "$1")
      .replace(/```\s*([\s\S]*?)\s*```/g, "$1")
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

// --------------- Helper: extract HTML or JS code from raw text ---------------
function extractCodeFromRawText(text, mode) {
  if (mode === "generate") {
    const htmlMatch = text.match(/```html\s*([\s\S]*?)\s*```/);
    if (htmlMatch) return htmlMatch[1].trim();

    const doctypeMatch = text.match(/<!DOCTYPE html[\s\S]*/i);
    if (doctypeMatch) return doctypeMatch[0].trim();
  }

  const jsMatch = text.match(/```javascript\s*([\s\S]*?)\s*```/);
  if (jsMatch) return jsMatch[1].trim();

  const codeMatch = text.match(/```\s*([\s\S]*?)```/);
  if (codeMatch) return codeMatch[1].trim();

  return null;
}

// --------------- Helper: build system prompt (IMAGE RULES RESTORED) ---------------
function buildSystemPrompt(mode, sandboxHTML, complexity, device, userMessage) {
  const isGenerate = mode === "generate";
  const isMobile = device === "mobile";
  const isSimple = complexity === "simple";

  const lowerMsg = (userMessage || "").toLowerCase();
  const isGame =
    lowerMsg.includes("game") ||
    lowerMsg.includes("play") ||
    lowerMsg.includes("tic") ||
    lowerMsg.includes("snake") ||
    lowerMsg.includes("puzzle");

  let layoutInstructions = "";
  if (isMobile) {
    layoutInstructions = `
- **CRITICAL: STRICT VERTICAL MOBILE LAYOUT**
  * The entire page must fit a phone screen without any horizontal scrolling.
  * Use \`max-width: 100vw; overflow-x: hidden; box-sizing: border-box;\` on body and all containers.
  * No fixed widths; percentages or \`100%\`.
  * Touch targets at least 44×44px.
  * Absolutely no horizontal scrollbars.
`;
  } else {
    layoutInstructions = `- **Desktop layout** – responsive, mobile‑friendly.`;
  }

  let gameInstructions = "";
  if (isGame) {
    gameInstructions = `
- **YOU ARE BUILDING A GAME – NOT A MULTI‑SECTION WEBSITE.**
  * Single gameplay screen only (canvas/board, buttons, score, restart). No header, nav, etc.
  * **NO input fields, textareas, prompt() or contenteditable** – they trigger mobile keyboard.
  * Disable user‑select and focus outlines.
`;
  } else {
    gameInstructions = `- For a standard website, include header, main, footer, etc.`;
  }

  let complexityInstructions =
    complexity === "simple"
      ? `- **Simple Mode**: Minimal but complete. All logic must work; prioritize function over decoration.`
      : `- **Advanced Mode**: Richer styling, animations, but still rock‑solid functionality.`;

  const noPromptAlert =
    "- **NEVER** use `prompt()`, `alert()`, `document.write()`, `<input>`, `<textarea>`, or `contenteditable` unless explicitly asked for a form. For games, avoid them entirely.";

  // ---------- RESTORED IMAGE RULES ----------
  const imageRules = `
🖼️ **IMAGE RULES (CRITICAL – FOLLOW EXACTLY)**:
- Images MUST be absolute URLs.
- **Choose images that match the page’s theme** (e.g., food for restaurants, technology for startups, nature for camping). Do NOT use completely random images.
- Use one of these services with **specific identifiers** to reflect the context:
  1. Unsplash (preferred): \`https://images.unsplash.com/photo-{PHOTO_ID}?w=WIDTH&h=HEIGHT\`
     Example: for a coffee shop, use photo‑ID \`1414235077428-338989a2e8c0\` (coffee).
     Use your knowledge of real Unsplash photo IDs.
  2. Picsum with seed: \`https://picsum.photos/seed/{DESCRIPTIVE_WORD}/400/300\`
     The seed ensures a consistent, thematic image.
  3. Placeholder with text: \`https://via.placeholder.com/400x300?text=Your+Text\`
- The filename alone determines the image; ensure the URL is directly viewable. 
- **NEVER** use local paths like \`"/img/hero.jpg"\` or \`"./photo.png"\`.
- If you are unsure of a specific photo ID, use a descriptive seed with picsum (e.g., \`seed=coffeeshop\`).`;

  if (isGenerate) {
    return `You are a world‑class web designer.
Create a **complete, ready‑to‑publish HTML page** based on the user's request.

Response format: ONLY a JSON object:
{ "code": "<full HTML from <!DOCTYPE html> to </html>>", "description": "short summary" }

${layoutInstructions}
${gameInstructions}
${complexityInstructions}
${noPromptAlert}

${imageRules}

**CRITICAL INTERACTIVITY RULES (MUST FOLLOW):**
- Any buttons or interactive elements must have working event listeners (addEventListener, onclick).
- For games: implement full logic, scoring, win/loss, and restart.
- Clicking a button must produce a visible result immediately.

**REQUIREMENTS**:
- Real content, no lorem ipsum.
- If a **game**, it must be playable right away.
- Your entire message must start with { and end with }. No markdown, no commentary.`;
  } else {
    return `You are an expert front‑end developer.
The current sandbox page content is:

\`\`\`html
${sandboxHTML || "(empty)"}
\`\`\`

Write a **JavaScript snippet** that modifies or extends the page to satisfy the user's request.
- Access the iframe’s document via:
    const iframe = document.getElementById('sandbox-iframe');
    const doc = iframe.contentDocument;
- Use stable DOM methods.
${noPromptAlert}
${layoutInstructions}
${gameInstructions}
${complexityInstructions}

${imageRules}

**INTERACTIVITY RULES:**
- Any added buttons/elements must respond to clicks/touches.

Response: ONLY a JSON object:
{"code": "pure JS", "description": "one line summary"}

Start with { and end with }. No markdown wrapping.`;
  }
}

// ============================
//  POST /chat – Build / Edit (non‑streaming fallback)
// ============================
app.post("/chat", async (req, res) => {
  try {
    const {
      messages,
      mode = "edit",
      sandboxHTML = "",
      complexity = "simple",
      device = "desktop",
    } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    const userMessage =
      messages.length > 0 ? messages[messages.length - 1].content : "";

    let maxTokens;
    if (complexity === "simple") {
      maxTokens = mode === "generate" ? 5000 : 1500;
    } else {
      maxTokens = mode === "generate" ? 6000 : 2000;
    }

    const systemContent = buildSystemPrompt(
      mode,
      sandboxHTML,
      complexity,
      device,
      userMessage,
    );
    const temperature = mode === "generate" ? 0.2 : 0.3;

    const completion = await client.chat.completions.create({
      model: "deepseek/deepseek-v4-flash",
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
      return res.json({ code: parsed.code, description: parsed.description });
    } else {
      const code = extractCodeFromRawText(text, mode);
      if (code) {
        return res.json({ code, description: "Auto‑extracted from response." });
      }
      return res.json({
        code: null,
        description: text || "Invalid response format.",
      });
    }
  } catch (err) {
    console.error("/chat error:", err);
    res
      .status(500)
      .json({ code: null, description: "Server error: " + err.message });
  }
});

// ============================
//  POST /chat/stream – Streaming version with SSE
// ============================
app.post("/chat/stream", async (req, res) => {
  try {
    const {
      messages,
      mode = "edit",
      sandboxHTML = "",
      complexity = "simple",
      device = "desktop",
    } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    const userMessage =
      messages.length > 0 ? messages[messages.length - 1].content : "";

    let maxTokens;
    if (complexity === "simple") {
      maxTokens = mode === "generate" ? 5000 : 1500;
    } else {
      maxTokens = mode === "generate" ? 6000 : 2000;
    }

    const systemContent = buildSystemPrompt(
      mode,
      sandboxHTML,
      complexity,
      device,
      userMessage,
    );
    const temperature = mode === "generate" ? 0.2 : 0.3;

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const stream = await client.chat.completions.create({
      model: "deepseek/deepseek-v4-flash",
      messages: [{ role: "system", content: systemContent }, ...messages],
      temperature,
      max_tokens: maxTokens,
      stream: true,
    });

    let fullContent = "";

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || "";
      if (delta) {
        fullContent += delta;
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }

    let parsed = extractJSON(fullContent);
    let code = null;
    let description = "";

    if (
      parsed &&
      typeof parsed.code === "string" &&
      typeof parsed.description === "string"
    ) {
      code = parsed.code;
      description = parsed.description;
    } else {
      code = extractCodeFromRawText(fullContent, mode);
      if (code) {
        description = "Extracted from raw AI response.";
      } else {
        description = fullContent || "Invalid response format.";
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, code, description })}\n\n`);
    res.end();
  } catch (err) {
    console.error("/chat/stream error:", err);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// ============================
//  POST /ask – Page assistant
// ============================
app.post("/ask", async (req, res) => {
  try {
    const { question, sandboxHTML } = req.body;
    if (!question) return res.status(400).json({ reply: "Missing question." });

    const systemMessage = {
      role: "system",
      content: `You are a helpful assistant. The user is viewing a web page whose content is:\n\`\`\`html\n${sandboxHTML || "(empty)"}\n\`\`\`\n\nAnswer the user's question about it. Do NOT include code unless asked.`,
    };

    const completion = await client.chat.completions.create({
      model: "deepseek/deepseek-v4-flash",
      messages: [systemMessage, { role: "user", content: question }],
      temperature: 0.7,
      max_tokens: 800,
    });

    res.json({ reply: completion.choices[0].message.content });
  } catch (err) {
    console.error("/ask error:", err);
    res.status(500).json({ reply: "Sorry, something went wrong." });
  }
});

// --------------- Health check ---------------
app.get("/", (req, res) =>
  res.send("AI Backend v9 (thematic images restored) is running."),
);

// --------------- Start server ---------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
