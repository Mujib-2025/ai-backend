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

// --------------- Helper: build system prompt (ULTRA mode added) ---------------
function buildSystemPrompt(mode, sandboxHTML, complexity, device, userMessage) {
  const isGenerate = mode === "generate";
  const isMobile = device === "mobile";

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
    lowerMsg.includes("gltf") ||
    lowerMsg.includes("obj") ||
    lowerMsg.includes("3d game") ||
    lowerMsg.includes("three js");

  // Automatically switch to ultra mode for any game or 3D request
  if (isGame || is3D) {
    complexity = "ultra";
  }

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
  * **NO KEYBOARD:** Do NOT use any text input fields, textareas, contenteditable, or <input> elements. All interaction must be via <button>, canvas, or touch events. Do not set autofocus or call .focus() anywhere.
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
  * **ABSOLUTELY NO INPUT FIELDS:** Do NOT use any <input>, <textarea>, contenteditable, or any element that triggers a keyboard. Use only <button> elements for interaction.
  * If a player name is required, hardcode "Player" or use a <button> to start; never ask for text input.
  * Do not set autofocus or call .focus().
  * Use CSS \`touch-action: manipulation;\` on all interactive elements to prevent zoom.
  * Use \`user-select: none;\` to avoid text selection.
`;
  } else {
    gameInstructions = `- If a standard website, include header, main, footer, etc.`;
  }

  let complexityInstructions = "";
  if (complexity === "simple") {
    complexityInstructions = `- **Simple Mode**: Keep code LINEAR and SHORT, BUT the game/website MUST BE FULLY FUNCTIONAL. Implement all game logic: start, play, win/lose detection, scoring, and a working restart button. No placeholder alerts. Every button must do something. Prioritize working mechanics over styling. If you are low on tokens, make the game logic compact but complete.`;
  } else if (complexity === "advanced") {
    complexityInstructions = `- **Advanced Mode**: Richer styling and animations, but still fully functional.`;
  } else if (complexity === "ultra") {
    complexityInstructions = `- **ULTRA ADVANCED MODE (auto‑activated for games & 3D)**: 
   * Create a **fully polished, production‑ready** game or 3D application.
   * Include **complete game mechanics**, multiple game states (start screen, gameplay, pause, game over, victory), score tracking, smooth CSS/JS animations, and simple sound effects (use Web Audio API oscillators for beeps, or free CDN audio if needed).
   * For 3D: use lighting, shadows (if performance permits), responsive canvas, mobile touch controls, and simple particle effects or textured objects (from picsum).
   * The code must be self‑contained and ready for immediate deployment.
   * Use clean, well‑organised code with brief comments, but keep it within the token budget – prioritise **working game logic over excessive styling**.
   * Guarantee the game is immediately playable and fully functional on both mobile and desktop.`;
  }

  const noPromptAlert =
    "- **NEVER** use `prompt()`, `alert()`, `document.write()`, `confirm()`, or any kind of popup. For feedback, update the DOM. In games, absolutely no <input>, <textarea>, or contenteditable. Use only <button> for actions.";

  const keyboardRule = isGame
    ? `
**📱 MOBILE KEYBOARD PREVENTION (GAMES ONLY):**
- DO NOT include any element that can receive text input: no <input>, no <textarea>, no contenteditable, no [type="text"], no [type="email"], nothing.
- Do not use prompt(), alert(), confirm().
- Do not set autofocus attribute.
- Do not call .focus() anywhere.
- Use only <button> elements for all user interactions.
`
    : "";

  const threeJsRules = is3D
    ? `
### THREE.JS 3D GAME RULES (MUST FOLLOW):
- You are generating a complete 3D game using Three.js in a single HTML file.
- The output must ALWAYS render something visible on first load.

**STRICT RULES:**
1. Must include: scene, camera, renderer, and animate loop.
2. Must attach renderer to document.body (or a container) with appropriate styling.
3. Must always add at least one visible object in the scene (ground, cube, sphere, etc.).
4. Camera must be positioned to see objects immediately.
5. Must include window resize handling (addEventListener('resize', ...)).
6. Only include lights if using non-basic materials.
7. Never rely on external setup beyond Three.js CDN.
8. Avoid errors at all costs.
9. Prefer simple geometry over complex systems.
10. Use mobile-first controls: touch events + mouse/keyboard fallback.
11. If any feature risks breaking rendering, remove it.
12. Must include visible player object and basic interaction.
13. No text input, no keyboard required for gameplay.
14. Output ONLY complete HTML code starting with <!DOCTYPE html>.
`
    : "";

  const imageRules = `
**🖼️ IMAGE RULES (CRITICAL):**
- ALWAYS use absolute, working image URLs starting with "https://".
- NEVER use local file names like "image.png", "/img/hero.jpg", or "./photo.jpg".
- For context‑appropriate images, use: \`https://source.unsplash.com/featured/?{topic}\`
- Or use \`https://picsum.photos/WIDTH/HEIGHT\` for random high‑quality photos.
- Or \`https://via.placeholder.com/WIDTHxHEIGHT?text=TEXT\` for simple placeholders.
`;

  if (isGenerate) {
    return `You are a world‑class web designer and game developer.
Create a **complete, ready‑to‑publish HTML page** that works immediately. The page must be a self‑contained web application or game without any server requirements.

Response: ONLY a JSON object:
{ "code": "<full HTML>", "description": "short summary" }

${layoutInstructions}
${gameInstructions}
${complexityInstructions}
${noPromptAlert}
${keyboardRule}
${threeJsRules}
${imageRules}

**CRITICAL INTERACTIVITY RULES (MUST FOLLOW):**
- Every button, clickable element, or game interaction must have a working JavaScript event listener (addEventListener, inline onclick). No empty or dummy handlers.
- For games: implement **all** game logic: initialization, player interaction, scoring, win/lose conditions, and a visible restart mechanism that resets the game state completely.
- Do NOT use placeholder comments like // TODO or /* implement later */.
- Actions must cause an immediate, visible update in the DOM or canvas.
- **Never use \`onclick="null"\` or empty functions.

**GAME REQUIREMENTS:**
- Start screen (optional but recommended) or immediately playable.
- Clear game area (canvas or DOM grid).
- Score display (using <div> or <span>, NOT input).
- Win/Lose announcement (DOM update).
- Restart button that works.

**HTML STRUCTURE:**
- Use <!DOCTYPE html>.
- Include viewport meta tag for mobile responsiveness.
- Use <button> for all interactive elements; not <input type="button"> or <a>.

Your entire message must start with { and end with }. No markdown, no commentary.`;
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
${complexityInstructions}
${keyboardRule}
${threeJsRules}
${imageRules}

**CRITICAL INTERACTIVITY RULES (MUST FOLLOW):**
- Any added buttons/elements must respond immediately to clicks/touches.
- Implement all requested interactions – no empty handlers.
- If adding a game feature, ensure it is fully playable: add game logic, win conditions, restart if needed.
- If modifying a 3D scene, follow the Three.js rules above.

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
    let {
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
    const lowerMsg = userMessage.toLowerCase();
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
      lowerMsg.includes("webgl");

    // Auto‑switch to ultra for games/3D
    if (isGame || is3D) {
      complexity = "ultra";
    }

    let maxTokens;
    if (complexity === "ultra") {
      maxTokens = mode === "generate" ? 8000 : 2000; // max output limit
    } else if (complexity === "simple") {
      maxTokens = mode === "generate" ? 8000 : 1500;
    } else {
      maxTokens = mode === "generate" ? 8000 : 2000;
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
    let {
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
    const lowerMsg = userMessage.toLowerCase();
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
      lowerMsg.includes("webgl");

    // Auto‑switch to ultra for games/3D
    if (isGame || is3D) {
      complexity = "ultra";
    }

    let maxTokens;
    if (complexity === "ultra") {
      maxTokens = mode === "generate" ? 8000 : 2000;
    } else if (complexity === "simple") {
      maxTokens = mode === "generate" ? 8000 : 1500;
    } else {
      maxTokens = mode === "generate" ? 8000 : 2000;
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
  res.send(
    "AI Backend v12 (Ultra mode auto‑activated for games & 3D) is running.",
  ),
);

// --------------- Start server ---------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
