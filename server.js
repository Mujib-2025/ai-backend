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

// --------------- Helper: build system prompt (RADICALLY SIMPLIFIED) ---------------
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

  // --- Base rules for every request ---
  const baseRules = `
**Non‑negotiable rules:**
- NEVER use \`prompt()\`, \`alert()\`, \`document.write()\`, or \`confirm()\`. Show everything in the DOM.
- NEVER use \`<input>\`, \`<textarea>\`, \`contenteditable\` (that would open the keyboard on mobile). Use only \`<button>\`.
- Do NOT call \`.focus()\` or set \`autofocus\`.
- Use \`touch-action: manipulation;\` and \`user-select: none;\` on interactive elements.
`;

  // --- Layout instructions ---
  let layoutInstructions = isMobile
    ? `**Mobile layout (strict):** Single vertical column, no horizontal scroll. Use percentages/flex. Touch targets at least 44×44px. **Do NOT add any text input (**no keyboard**).** All interaction through buttons or canvas.`
    : `**Desktop layout:** Responsive with secondary mobile support.`;

  // --- Game specific ---
  let gameInstructions = isGame
    ? `**YOU ARE BUILDING A GAME.** The page must be a single gameplay screen – no header/footer. Include a score display (DOM <div> or <span>), win/lose announcement, and a fully working restart button.`
    : `**This is a website.** Include typical sections: header, main, footer.`;

  // --- Complexity ---
  let complexityInstructions = isSimple
    ? `**Simple mode:** Keep code compact BUT **fully functional**. Implement ALL game logic – scoring, win/loss, restart. No placeholder comments like "// TODO".`
    : `**Advanced mode:** Richer styling and animations, still fully functional.`;

  // --- Mobile game sizing (only when mobile + game) ---
  let mobileGameSizing = "";
  if (isMobile && isGame) {
    mobileGameSizing = `
**Mobile game sizing:**
- Design for a **9:16** portrait aspect ratio (base 1080×1920, scale to 720×1280).
- Keep critical UI (score, buttons, canvas) inside a **5‑10% safe margin** from the screen edges.
- Use \`vw\`, \`vh\`, or relative units so everything scales.
`;
  }

  // --- 3D/Three.js rules ---
  let threeJsRules = "";
  if (is3D) {
    threeJsRules = `
**Three.js 3D game – MUST FOLLOW:**
1. Include scene, camera, renderer, animate loop.
2. Append renderer to body (or a container) – fill the screen.
3. At least one visible object (e.g., a ground cube).
4. Camera placed to see the objects immediately.
5. Window resize handler.
6. Lights only if using non‑basic materials.
7. Use Three.js from CDN (no build tools).
8. Avoid undefined variables; prefer simple geometries.
9. **Mobile‑first controls:** use touch events (touchstart/move/end) + mouse fallback.
10. **No text input. No keyboard.** Use on‑screen buttons or touch gestures.
11. If something might break rendering, remove it.
12. Output **only** the complete HTML code, starting with \`<!DOCTYPE html>\`.
`;
  }

  // --- Image rules ---
  const imageRules = `**Images:** Use absolute HTTPS URLs (e.g., https://picsum.photos/400/300 or https://source.unsplash.com/featured/?{topic}). Never local paths.`;

  // --- Final interaction rules ---
  const interactionRules = `
**CRITICAL – EVERY BUTTON MUST WORK:**
- Every clickable element must have a real JavaScript handler (addEventListener or inline onclick) that does something visible.
- For games: implement **full game loop** – initial state, player interaction, score update, win/lose check, restart.
- Before outputting, mentally run through the code: clicking every button must produce an immediate, visible effect.
- No empty functions, no \`onclick="null"\`.
`;

  if (isGenerate) {
    return `You are a world‑class front‑end developer and game creator.
Generate a **complete, ready‑to‑publish HTML page** that works immediately.

**Response format:** JSON object with EXACTLY this structure:
{ "code": "<full HTML>", "description": "one‑sentence summary" }

${baseRules}
${layoutInstructions}
${gameInstructions}
${complexityInstructions}
${mobileGameSizing}
${threeJsRules}
${imageRules}
${interactionRules}

Your entire message must begin with \`{\` and end with \`}\`. No markdown, no commentary.
`;
  } else {
    // ---------- EDIT MODE ----------
    return `You are an expert front‑end developer.
The sandbox currently contains a web page. You must write a **JavaScript snippet** that, when executed, modifies the page to match the user’s request.

**How your code will be run:**
The system will execute it as \`new Function("sandbox", yourCode)(sandboxElement)\`.
The parameter \`sandbox\` is the container DIV. To access the iframe content:

\`\`\`
const iframe = sandbox.querySelector('iframe#sandbox-iframe');
const doc = iframe ? iframe.contentDocument : document;
\`\`\`

Use \`doc\` to manipulate the DOM. If there is no iframe, fall back to \`sandbox\`.

**Current sandbox content:**
\`\`\`html
${sandboxHTML || "(empty)"}
\`\`\`

${baseRules}
${layoutInstructions}
${gameInstructions}
${complexityInstructions}
${mobileGameSizing}
${threeJsRules}
${imageRules}
${interactionRules}

**Response format:** JSON object:
{ "code": "your JavaScript code", "description": "one‑sentence summary" }

Start with \`{\` and end with \`}\`. No markdown, no backticks.
`;
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

    // Higher token limits to accommodate complete logic
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
    const temperature = mode === "generate" ? 0.1 : 0.2;

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
    const temperature = mode === "generate" ? 0.1 : 0.2;

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
  res.send("AI Backend v13 (radical fix: working buttons, edit mode fixed)."),
);

// --------------- Start server ---------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
