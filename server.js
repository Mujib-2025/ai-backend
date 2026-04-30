// server.js – Mobile‑only AI backend (Ultra mode, core game mechanics #1, precise edits)
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

// --------------- CORS ---------------
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json({ limit: "5mb" }));

// --------------- OpenAI client ---------------
const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.DEEPSEEK_API_KEY || "missing-api-key",
  defaultHeaders: {
    "HTTP-Referer": process.env.REFERER_URL || "http://localhost:3000",
    "X-Title": "AI Builder",
  },
});

// --------------- Extract JSON ---------------
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

// --------------- Extract HTML/JS ---------------
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

// --------------- System Prompt (Ultra mode, mobile, precise edits) ---------------
function buildSystemPrompt(mode, sandboxHTML, userMessage) {
  const isGenerate = mode === "generate";
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

  const mandatoryRules = `
**MANDATORY RULES – if you break any of these your output is invalid:**

1. NO inline onclick attributes. Use addEventListener in a single <script> at end of <body>.
2. NO <input>, <textarea>, contenteditable.
3. NO alert(), prompt(), confirm(), document.write().
4. Do NOT call .focus() or use autofocus.
5. Every button MUST perform a visible action.
6. ALL functions referenced MUST be defined.
7. No placeholder code, no TODOs, no comments like "implement later".

8. **FULL GAME REQUIREMENT:**
If you generate a game, it MUST include:
- Start state
- Game loop (update + render using requestAnimationFrame if needed)
- Player interaction (touch)
- Game logic (movement, rules, collisions, etc.)
- Score system (visible and updating)
- Win OR lose condition
- Restart button that fully resets the game

9. **The game must be immediately playable on load.**

10. **Before outputting, mentally simulate gameplay.**

11. **CORE MECHANIC REQUIREMENT (TOP PRIORITY):**
The main mechanic of the app/game MUST be implemented and visible.
- Identify the primary mechanic from the user request
- That mechanic MUST exist as working code (not just UI)
- The mechanic MUST update over time or through interaction
- The mechanic MUST affect the game state (position, score, objects, etc.)
If the main mechanic is missing, static, or not functional, the output is INVALID.

12. **NO FAKE IMPLEMENTATIONS:** Do NOT simulate functionality with static visuals.

13. **STATE DRIVEN LOGIC:** All core behavior must be driven by real state variables.

14. **If using external libraries (like Three.js), you MUST use ES modules and <script type="module">.**

15. **STRICT MOBILE VERTICAL RECTANGLE:**
- Portrait (9:16), flex column, no horizontal scroll.
- Use \`touch-action: manipulation; user-select: none;\` on interactive elements.
- Touch‑friendly: buttons ≥ 44px tap target.
- No keyboard controls.
`;

  const layout = `**Mobile layout:** Portrait, no horizontal scroll, use flex column. Keep all content inside a vertical rectangle. Use relative units (vw, vh, %).`;

  const gameExtra = isGame
    ? `**This is a COMPLETE MOBILE GAME.** Must be fully playable from start to finish. Include score, win/lose, restart. Only touch controls.`
    : `**This is a mobile website.** Include header, main content, footer.`;

  const qualityText = `**ULTRA QUALITY:** Write complete, production‑ready code. Every feature requested must be fully implemented. No simplifications.`;

  const mobileSizing = isGame
    ? `**Mobile game sizing:** Use relative units, design for 9:16.`
    : "";

  const threeD = is3D
    ? `**3D game (Three.js):** Use ES modules (<script type="module">). Import like: import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.156.1/build/three.module.js'. Mobile touch only.`
    : "";

  const imageRules = `**Images:** Always use absolute HTTPS URLs (\`https://picsum.photos/400/300\` or \`https://source.unsplash.com/featured/?{topic}\`). Never local paths.`;

  const generateEnding = `**Output format:** ONLY a JSON object: { "code": "<full HTML>", "description": "one-sentence summary" }

**CRITICAL VALIDATION BEFORE OUTPUT:** The main mechanic must be present and functional. The game must run without errors, score must update, win/lose must work, restart must reset everything. Design for mobile portrait.

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

**PRECISE EDIT MODE:** You must carefully read the user's request and modify ONLY the specific part(s) of the existing code that need to be changed. Do not rewrite the entire page unless explicitly requested. Understand the user's intent exactly.

${mandatoryRules}
**Output format:** { "code": "your JavaScript code", "description": "brief summary of what was changed" }`;

  if (isGenerate) {
    return `You are an expert front‑end developer. Write a complete, self‑contained HTML page STRICTLY for mobile portrait.
${mandatoryRules}
${layout}
${gameExtra}
${qualityText}
${mobileSizing}
${threeD}
${imageRules}
${generateEnding}`;
  } else {
    return `You are an expert front‑end developer. Modify the existing sandbox page precisely as requested.
${editEnding}`;
  }
}

// ============================
//  POST /chat – Non‑streaming (Ultra mode)
// ============================
app.post("/chat", async (req, res) => {
  try {
    const { messages, mode = "edit", sandboxHTML = "" } = req.body;
    if (!messages || !Array.isArray(messages))
      return res.status(400).json({ error: "messages array required" });

    const userMessage = messages[messages.length - 1]?.content || "";
    // Ultra tokens – generous limits
    const maxTokens = mode === "generate" ? 10000 : 4000;
    const systemContent = buildSystemPrompt(mode, sandboxHTML, userMessage);

    const completion = await client.chat.completions.create({
      model: "deepseek/deepseek-v4-flash",
      messages: [{ role: "system", content: systemContent }, ...messages],
      temperature: 0.0,
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
      if (code)
        return res.json({ code, description: "Auto‑extracted from response." });
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
//  POST /chat/stream – Streaming (Ultra mode)
// ============================
app.post("/chat/stream", async (req, res) => {
  try {
    const { messages, mode = "edit", sandboxHTML = "" } = req.body;
    if (!messages || !Array.isArray(messages))
      return res.status(400).json({ error: "messages array required" });

    const userMessage = messages[messages.length - 1]?.content || "";
    const maxTokens = mode === "generate" ? 10000 : 4000;
    const systemContent = buildSystemPrompt(mode, sandboxHTML, userMessage);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const stream = await client.chat.completions.create({
      model: "deepseek/deepseek-v4-flash",
      messages: [{ role: "system", content: systemContent }, ...messages],
      temperature: 0.0,
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
      description = code
        ? "Extracted from raw AI response."
        : fullContent || "Invalid response format.";
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
      content: `You are a helpful assistant. The user is viewing a mobile web page:\n\`\`\`html\n${sandboxHTML || "(empty)"}\n\`\`\`\nAnswer the question about it concisely. No code unless asked.`,
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

// Health check
app.get("/", (req, res) =>
  res.send(
    "AI Backend v17 (Ultra mode, mobile‑only, precise edits) is running.",
  ),
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
