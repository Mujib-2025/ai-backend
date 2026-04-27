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

// --------------- Helper: build system prompt (ADVANCED ONLY + CONTEXT IMAGES) ---------------
function buildSystemPrompt(mode, sandboxHTML, device, userMessage) {
  const isGenerate = mode === "generate";
  const isMobile = device === "mobile";

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
  * The entire page must be a **single vertical column** that fits a phone screen without any horizontal scrolling.
  * Use \`max-width: 100vw; overflow-x: hidden; box-sizing: border-box;\` on body and all containers.
  * No fixed widths; all widths in percentages or \`100%\`.
  * Avoid CSS Grid with large fixed columns; use flexbox column.
  * Touch targets at least 44×44px.
  * **Absolutely no horizontal scrollbars.**
`;
  } else {
    layoutInstructions = `- **Desktop layout** - responsive, secondary mobile support.`;
  }

  let gameInstructions = "";
  if (isGame) {
    gameInstructions = `
- **YOU ARE BUILDING A GAME, NOT A MULTI‑SECTION WEBSITE.**
  * The entire page must be a **single gameplay screen** – no header, navigation, or sections like “home”, “contact”, “about”.
  * Only the game itself (canvas, board, buttons, score, restart) should exist.
  * The layout must be clean and focused on the game mechanics.
  * **DO NOT use any input fields, textareas, prompt(), or contenteditable.** These would pop up the mobile keyboard, which destroys the game experience.
  * Disable user‑select and focus outlines where possible to prevent accidental keyboard.
`;
  } else {
    gameInstructions = `- If a standard website, include header, main, footer, etc.`;
  }

  const noPromptAlert =
    "- **NEVER** use `prompt()`, `alert()`, `document.write()`, `<input>`, `<textarea>`, or `contenteditable` unless the user explicitly asks for a form. For games, strictly avoid them.";

  // ---------- IMAGE INSTRUCTIONS (context-sensitive) ----------
  const imageInstructions = `
**IMAGE REQUIREMENTS (extremely important):**
- Always use **context-relevant real images** from a free stock service.
- Use the format: \`https://source.unsplash.com/featured/?{DESCRIPTIVE_KEYWORD}/{WIDTH}x{HEIGHT}\`
  * Replace {DESCRIPTIVE_KEYWORD} with a word that matches the **content/theme** of the image (e.g., “nature”, “office”, “food”, “game”, “space”, “tic-tac-toe”).
  * Examples:
    - For a restaurant site: \`https://source.unsplash.com/featured/?food/800x600\`
    - For a travel agency: \`https://source.unsplash.com/featured/?travel/1200x800\`
    - For a game background: \`https://source.unsplash.com/featured/?game,playful/400x300\`
  * You can also use multiple keywords separated by commas for variety.
- **Never** use placeholder images like “https://via.placeholder.com/...” or random Lorem Picsum with no seed.
- If the user mentions explicit image topics, use exactly those topics as keywords.
- Guarantee every image is unique and topical by adjusting the keywords appropriately.
`;

  if (isGenerate) {
    return `You are a world‑class web designer.
Create a **complete, ready‑to‑publish HTML page**.

Response: ONLY a JSON object:
{ "code": "<full HTML>", "description": "short summary" }

${layoutInstructions}
${gameInstructions}
${noPromptAlert}
${imageInstructions}

**CRITICAL INTERACTIVITY RULES (MUST FOLLOW):**
- If your page contains **any buttons, clickable elements, or game interactions**, you MUST add actual JavaScript event listeners (addEventListener, onclick, etc.) that make them fully functional.
- For games: implement **all** game logic, scoring, win/lose conditions, and a restart mechanism.
- **No placeholder alerts** – actions must visibly update the page.
- Test your code mentally: clicking a button must produce an immediate, visible effect.
- **Never use onclick="null" or empty handlers.**

**REQUIREMENTS**:
- Real content, no lorem ipsum.
- Images: use the context-sensitive unsplash URLs as described.
- Your entire message must start with { and end with }. No markdown, no commentary.`;
  } else {
    return `You are an expert front‑end developer.
The current sandbox page:
\`\`\`html
${sandboxHTML || "(empty)"}
\`\`\`

Write a **JavaScript snippet** that runs inside the sandbox to fulfill the user's request.
- Always access the iframe’s document via:
    const iframe = document.getElementById('sandbox-iframe');
    const doc = iframe.contentDocument;
- Use stable DOM methods only.
${noPromptAlert}
${layoutInstructions}
${gameInstructions}
${imageInstructions}

**CRITICAL INTERACTIVITY RULES (MUST FOLLOW):**
- Any added buttons/elements must respond immediately to clicks/touches.
- Implement all requested interactions – no empty handlers.

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
      device = "desktop",
    } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    const userMessage =
      messages.length > 0 ? messages[messages.length - 1].content : "";

    // Advanced‑only token limits
    const maxTokens = mode === "generate" ? 6000 : 2000;

    const systemContent = buildSystemPrompt(
      mode,
      sandboxHTML,
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
      device = "desktop",
    } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    const userMessage =
      messages.length > 0 ? messages[messages.length - 1].content : "";

    // Advanced‑only token limits
    const maxTokens = mode === "generate" ? 6000 : 2000;

    const systemContent = buildSystemPrompt(
      mode,
      sandboxHTML,
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
      content: `You are a helpful assistant. The user is viewing a web page whose content is:\n\`\`\`html\n${sandboxHTML || "(empty)"}\n\`\`\`\n\nAnswer the user's question about it. Do NOT include any code in your answer unless explicitly asked; provide clear, concise explanations.`,
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
  res.send("AI Backend v9 (advanced only + context images) is running."),
);

// --------------- Start server ---------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
