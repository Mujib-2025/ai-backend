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

// --------------- Helper: build system prompt (FORCED FUNCTIONAL) ---------------
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

  const is3D =
    lowerMsg.includes("3d") ||
    lowerMsg.includes("three.js") ||
    lowerMsg.includes("threejs") ||
    lowerMsg.includes("webgl") ||
    lowerMsg.includes("3d game");

  // ---------- ABSOLUTE RULES (short, clear, mandatory) ----------
  const mandatoryRules = `
**MANDATORY RULES – if you break any of these your output is invalid:**
1. **NO inline onclick attributes.** Do NOT use \`onclick="..."\` in HTML tags. Attach all click handlers using \`addEventListener\` inside a single \`<script>\` block at the end of \`<body>\`. Make sure every function that handles an event is defined in that same script.
2. **NO \`<input>\`, \`<textarea>\`, \`contenteditable\`** – these open the mobile keyboard. Use only \`<button>\` for actions.
3. **NO \`prompt()\`, \`alert()\`, \`confirm()\`, \`document.write()\`** – never use them.
4. **Do NOT call \`.focus()\`** or set \`autofocus\`.
5. Every button must perform a visible action (change DOM, update score, move a piece, etc.). If a button exists, it **must** work.
6. **For games:** implement the full game loop – start, play, score, win/lose, restart. No placeholder functions.
7. **Before outputting, mentally test every interactive element.** If any function is missing or undefined, fix it.
`;

  // ---------- layout / game / 3d extensions ----------
  const layout = isMobile
    ? `**Mobile layout:** Portrait, no horizontal scroll, use flex column. Use \`touch-action: manipulation; user-select: none;\` on interactive elements. Keep UI inside a 5‑10% safe margin.`
    : `**Desktop layout:** responsive, supported on mobile too.`;

  const gameExtra = isGame
    ? `**This is a game.** Single game screen, no header/footer. Score and restart button must be present and working.`
    : `**This is a website.** Include header, main content, footer.`;

  const complexityExtra = isSimple
    ? `**Simple mode:** Keep code compact but **fully functional**. No styling fluff – all functionality must work.`
    : `**Advanced mode:** Polished styling and animations, but still fully functional.`;

  const mobileSizing =
    isMobile && isGame
      ? `**Mobile game sizing:** Design for 9:16 (1080×1920), scale to 720×1280. Use relative units.`
      : "";

  const threeD = is3D
    ? `**3D game (Three.js):** Include scene, camera, renderer, animate loop. Append renderer to body. Use touch events for mobile. No keyboard. Simple geometry. Import Three.js from CDN: \`https://cdn.jsdelivr.net/npm/three@0.156.1/build/three.min.js\`.`
    : "";

  const imageRules = `**Images:** Always use absolute HTTPS URLs (\`https://picsum.photos/400/300\` or \`https://source.unsplash.com/featured/?{topic}\`). Never local paths.`;

  const generateEnding = `**Output format:** ONLY a JSON object:
{ "code": "<full HTML>", "description": "one‑sentence summary" }
Your entire message must start with \`{\` and end with \`}\`. No markdown or explanation.`;

  const editEnding = `**How your code is executed:**
\`\`\`
new Function("sandbox", yourCode)(sandboxElement)
\`\`\`
The parameter \`sandbox\` is the container DIV. To access the iframe content:
\`\`\`
const iframe = sandbox.querySelector('iframe#sandbox-iframe');
const doc = iframe ? iframe.contentDocument : sandbox.ownerDocument;
\`\`\`
Use \`doc\` for all DOM changes.

**Current sandbox content:**
\`\`\`html
${sandboxHTML || "(empty)"}
\`\`\`

${mandatoryRules}
**Output format:** { "code": "your JavaScript code", "description": "brief summary" }`;

  if (isGenerate) {
    return `You are a front‑end expert. Write a complete, self‑contained HTML page.
${mandatoryRules}
${layout}
${gameExtra}
${complexityExtra}
${mobileSizing}
${threeD}
${imageRules}
${generateEnding}`;
  } else {
    return `You are a front‑end expert. Write JavaScript that modifies the sandbox page.
${editEnding}`;
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

    const maxTokens =
      complexity === "simple"
        ? mode === "generate"
          ? 10000
          : 3000
        : mode === "generate"
          ? 10000
          : 4000;

    const systemContent = buildSystemPrompt(
      mode,
      sandboxHTML,
      complexity,
      device,
      userMessage,
    );
    const temperature = 0.0; // deterministic as possible

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

    const maxTokens =
      complexity === "simple"
        ? mode === "generate"
          ? 10000
          : 3000
        : mode === "generate"
          ? 10000
          : 4000;

    const systemContent = buildSystemPrompt(
      mode,
      sandboxHTML,
      complexity,
      device,
      userMessage,
    );
    const temperature = 0.0;

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
  res.send("AI Backend v14 (forced addEventListener – no broken onclick)."),
);

// --------------- Start server ---------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
