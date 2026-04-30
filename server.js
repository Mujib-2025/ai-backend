// server.js – Mobile‑only AI backend (strict touch‑only, flash‑first with Pro last‑chance)
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

// --------------- Extract JSON (strict) ---------------
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

// --------------- Validate generated code (unchanged) ---------------
function validateGeneratedCode(code, userMessage, mode) {
  const errors = [];
  if (!code || typeof code !== "string" || code.trim().length === 0) {
    errors.push("Empty or missing code");
    return errors;
  }
  if (mode === "generate") {
    const lower = code.toLowerCase();
    const lowerMsg = (userMessage || "").toLowerCase();
    const isGame =
      lowerMsg.includes("game") ||
      lowerMsg.includes("play") ||
      lowerMsg.includes("tic") ||
      lowerMsg.includes("snake") ||
      lowerMsg.includes("puzzle");
    if (!lower.includes("<!doctype")) errors.push("Missing DOCTYPE");
    if (!lower.includes("<script")) errors.push("Missing <script> tag");
    if (/\bkeydown\b|\bkeyup\b|\bkeypress\b|\bkeyboard\b/i.test(code)) {
      errors.push("Keyboard controls detected – touch‑only mobile required.");
    }
    if (isGame) {
      if (!lower.includes("addeventlistener"))
        errors.push("No addEventListener");
      if (
        !lower.includes("requestanimationframe") &&
        !lower.includes("setinterval")
      )
        errors.push("No game loop");
      if (!lower.includes("restart") && !lower.includes("reset"))
        errors.push("No restart/reset");
      if (!lower.includes("score")) errors.push("No score variable");
      const functionMatches = code.match(/function\s+\w+/g);
      if (!functionMatches || functionMatches.length < 2)
        errors.push("Fewer than 2 functions");
      if (
        !lower.includes("touchstart") &&
        !lower.includes("touchend") &&
        !lower.includes("click")
      )
        errors.push("No touch/click event");
      const restartBtnRegex =
        /<button[^>]*>[\s\S]*?(?:restart|reset)[\s\S]*?<\/button>/i;
      if (!restartBtnRegex.test(code)) errors.push("No visible restart button");
      const restartLogicIndicators =
        /\bscore\s*=\s*0\b|\bresetGame\b|\bclearInterval\b|\bcancelAnimationFrame\b|\bctx\.clearRect\b|\bgameOver\s*=\s*false\b/i;
      if (
        !/function\s+(restart|reset)\s*\(\)/i.test(code) &&
        !restartLogicIndicators.test(code)
      )
        errors.push("No restart/reset function");
      const eventListenerRegex =
        /addEventListener\s*\(\s*['"](?:click|touchstart|touchend)['"]\s*,\s*(\w+)/g;
      let match;
      const usedFunctions = new Set();
      while ((match = eventListenerRegex.exec(code)) !== null)
        usedFunctions.add(match[1]);
      for (const funcName of usedFunctions) {
        const funcDefRegex = new RegExp(`function\\s+${funcName}\\s*\\(`);
        if (
          !funcDefRegex.test(code) &&
          funcName !== "function" &&
          funcName !== "null"
        )
          errors.push(
            `Event listener references undefined function '${funcName}'`,
          );
      }
    }
  } else {
    if (/\bdocument\./.test(code))
      errors.push("Uses 'document' instead of 'doc'");
    if (code.includes("<!DOCTYPE") || code.includes("<html"))
      errors.push("Edit code appears to be full HTML");
  }
  return errors;
}

// --------------- System Prompt (unchanged) ---------------
function buildSystemPrompt(mode, sandboxHTML, userMessage) {
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

8. **ABSOLUTELY NO KEYBOARD CONTROLS:** Only touch and mouse click events. No keydown, keyup, keypress.

9. **MOBILE TOUCH CONTROLS ONLY:** All interaction via touch (touchstart, touchend) or click.

10. **FULL GAME REQUIREMENT (TOP PRIORITY):**
If this is a game, you MUST include:
- Start state
- Game loop (requestAnimationFrame)
- Player interaction (touch/click)
- Game logic (movement, rules, collisions)
- Score system (visible, updating)
- Win/lose condition
- Restart button that fully resets the game (visible HTML button, calls reset function)

11. Game must be immediately playable on load.

12. **CORE MECHANIC REQUIREMENT:** Main mechanic implemented, updates over time, affects game state.

13. **STATE DRIVEN LOGIC:** All core behavior from real state variables.

14. If using external libraries (Three.js), use ES modules (<script type="module">).

15. **STRICT MOBILE VERTICAL RECTANGLE:** Portrait, flex column, no horizontal scroll. touch-action: manipulation; user-select: none; Buttons ≥ 44px tap target.
`;
  const layout = `Mobile layout: Portrait, no horizontal scroll, flex column, relative units.`;
  const gameExtra = isGame
    ? `COMPLETE MOBILE GAME with touch controls only, no keyboard. Must have score, win/lose, restart.`
    : `Mobile website.`;
  const qualityText = `ULTRA QUALITY: Complete, production‑ready code. Every feature fully implemented.`;
  const mobileSizing = isGame ? `Design for 9:16, relative units.` : "";
  const threeD = is3D
    ? `3D game (Three.js): ES modules, import from 'https://cdn.jsdelivr.net/npm/three@0.156.1/build/three.module.js'. Mobile touch only.`
    : "";
  const imageRules = `Images: Absolute HTTPS URLs (https://picsum.photos/400/300 or https://source.unsplash.com/featured/?{topic}).`;
  const generateEnding = `**Output format:** ONLY a JSON object: { "code": "<full HTML>", "description": "one-sentence summary" }
CRITICAL: Game error-free, touch‑only, working buttons, score, win/lose, visible restart button. No keyboard.
Your entire message must start with { and end with }.`;
  const editEnding = `**How your code is executed:**
\`\`\`
new Function("sandbox", "doc", yourCode)(sandbox, doc);
\`\`\`
You DO NOT need to declare \`doc\`. Just use \`doc\` for DOM.

Current sandbox content:
\`\`\`html
${sandboxHTML || "(empty)"}
\`\`\`

PRECISE EDIT MODE: Modify ONLY the specific part(s) requested. Return JSON with modified JS code and summary.
Output format: { "code": "your JavaScript code", "description": "brief summary" }
Your entire message must start with { and end with }.`;
  if (mode === "generate") {
    return `You are an expert front‑end developer. Write a complete, self‑contained HTML page for a mobile portrait game with TOUCH CONTROLS ONLY. No keyboard.
${mandatoryRules}
${layout}
${gameExtra}
${qualityText}
${mobileSizing}
${threeD}
${imageRules}
${generateEnding}`;
  } else {
    return `You are an expert front‑end developer. Modify the existing sandbox page PRECISELY as requested, using the provided \`doc\` variable.
${editEnding}`;
  }
}

// --------------- Retry‑enabled generation with cost‑efficient model selection ---------------
async function retryGenerate(
  messages,
  mode,
  sandboxHTML,
  userMessage,
  maxRetries = 2, // total 3 attempts (0,1,2)
  useProInitially = false, // if true, start with Pro (used after streaming flash fails)
) {
  let currentMessages = [...messages];
  let finalModel = null;
  let finalAttempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Model selection:
    // - If useProInitially -> Pro from the start (all attempts)
    // - Else use Flash for all attempts except the very last one (attempt === maxRetries)
    let activeModel;
    if (useProInitially) {
      activeModel = "deepseek/deepseek-v4-pro";
    } else {
      activeModel =
        attempt === maxRetries
          ? "deepseek/deepseek-v4-pro"
          : "deepseek/deepseek-v4-flash";
    }

    console.log(
      `Attempt ${attempt + 1}/${maxRetries + 1} using model: ${activeModel}`,
    );

    const systemContent = buildSystemPrompt(mode, sandboxHTML, userMessage);
    const completion = await client.chat.completions.create({
      model: activeModel,
      messages: [
        { role: "system", content: systemContent },
        ...currentMessages,
      ],
      temperature: 0.0,
      max_tokens: mode === "generate" ? 10000 : 4000,
      response_format: { type: "json_object" },
    });

    const text = completion.choices[0].message.content;
    const parsed = extractJSON(text);

    if (
      parsed &&
      typeof parsed.code === "string" &&
      typeof parsed.description === "string"
    ) {
      const errors = validateGeneratedCode(parsed.code, userMessage, mode);
      if (errors.length === 0) {
        finalModel = activeModel;
        finalAttempts = attempt + 1;
        return {
          code: parsed.code,
          description: parsed.description,
          model: finalModel,
          attempts: finalAttempts,
        };
      }

      console.log(
        `Attempt ${attempt + 1} failed with ${activeModel}:`,
        errors.join(", "),
      );
      if (attempt < maxRetries) {
        let correction = `Your previous output was invalid. Issues: ${errors.join("; ")}.`;
        if (mode === "edit") {
          correction += " Remember: use 'doc' instead of 'document'.";
        } else {
          correction +=
            " Fix ALL of them. Use ONLY touch and click events, no keyboard. Ensure restart button exists and resets the game.";
        }
        currentMessages.push({ role: "user", content: correction });
      } else {
        return {
          code: parsed.code,
          description: `⚠️ ${mode === "edit" ? "Edit" : "Game"} may be incomplete after ${attempt + 1} attempts. Issues: ${errors.join("; ")}`,
          model: activeModel,
          attempts: attempt + 1,
        };
      }
    } else {
      console.log(
        `Attempt ${attempt + 1} failed JSON parsing with ${activeModel}`,
      );
      if (attempt < maxRetries) {
        currentMessages.push({
          role: "user",
          content:
            "Your output did not contain valid JSON with 'code' and 'description' fields. Please return ONLY the JSON object as specified.",
        });
      } else {
        const codeMatch =
          text.match(/```html\s*([\s\S]*?)\s*```/) ||
          text.match(/<!DOCTYPE html[\s\S]*/i);
        const jsMatch =
          text.match(/```javascript\s*([\s\S]*?)\s*```/) ||
          text.match(/```\s*([\s\S]*?)```/);
        const fallbackCode =
          mode === "edit"
            ? jsMatch
              ? jsMatch[1]
              : null
            : codeMatch
              ? codeMatch[0]
              : null;
        if (fallbackCode) {
          return {
            code: fallbackCode.trim(),
            description:
              "Extracted code from non‑JSON output (quality not guaranteed).",
            model: activeModel,
            attempts: attempt + 1,
          };
        }
        return {
          code: null,
          description: `Failed to produce valid JSON after ${attempt + 1} attempts with model ${activeModel}.`,
          model: activeModel,
          attempts: attempt + 1,
        };
      }
    }
  }

  return {
    code: null,
    description: "Generation failed.",
    model: finalModel || "unknown",
    attempts: finalAttempts,
  };
}

// ============================
//  POST /chat – Non‑streaming
// ============================
app.post("/chat", async (req, res) => {
  try {
    const { messages, mode = "edit", sandboxHTML = "" } = req.body;
    if (!messages || !Array.isArray(messages))
      return res.status(400).json({ error: "messages array required" });

    const userMessage = messages[messages.length - 1]?.content || "";
    const result = await retryGenerate(
      messages,
      mode,
      sandboxHTML,
      userMessage,
      2, // up to 3 attempts: 2 flash then 1 pro
      false, // start with flash
    );

    const info = ` | ✅ Model: ${result.model}, Attempts: ${result.attempts}`;
    const finalDescription = (result.description || "") + info;
    res.json({ code: result.code, description: finalDescription });
  } catch (err) {
    console.error("/chat error:", err);
    res
      .status(500)
      .json({ code: null, description: "Server error: " + err.message });
  }
});

// ============================
//  POST /chat/stream – Streaming with cost‑efficient fallback
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

    // First attempt: streaming with Flash
    const flashModel = "deepseek/deepseek-v4-flash";
    console.log(`Streaming attempt 1 using ${flashModel}`);
    const stream = await client.chat.completions.create({
      model: flashModel,
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
    let modelUsed = flashModel;
    let totalAttempts = 1;

    if (
      parsed &&
      typeof parsed.code === "string" &&
      typeof parsed.description === "string"
    ) {
      const errors = validateGeneratedCode(parsed.code, userMessage, mode);
      if (errors.length === 0) {
        code = parsed.code;
        description = parsed.description;
      } else {
        // First flash attempt failed – fallback to non‑streaming with 2 more attempts (flash then pro)
        console.log(
          "Streaming flash failed validation, retrying (2 more attempts: flash, then pro)...",
        );
        res.write(
          `data: ${JSON.stringify({ delta: "⚠️ Retrying with Flash, then Pro if needed..." })}\n\n`,
        );

        let correction = `Your previous output was invalid. Issues: ${errors.join("; ")}.`;
        correction +=
          mode === "edit"
            ? " Remember to use 'doc'."
            : " Fix all issues. Use touch controls, no keyboard.";
        const retryMessages = [
          ...messages,
          { role: "user", content: correction },
        ];

        const result = await retryGenerate(
          retryMessages,
          mode,
          sandboxHTML,
          userMessage,
          2, // up to 2 additional attempts (flash, then pro)
          false, // still start with flash for the first retry
        );
        code = result.code || parsed.code;
        description = result.description;
        modelUsed = result.model || "deepseek/deepseek-v4-pro";
        totalAttempts = 1 + (result.attempts || 0);
      }
    } else {
      // JSON parsing failed – fallback same as above
      console.log("Streaming flash JSON parse failed, retrying...");
      res.write(
        `data: ${JSON.stringify({ delta: "⚠️ Fixing output format..." })}\n\n`,
      );

      const retryMessages = [
        ...messages,
        {
          role: "user",
          content:
            "Your output did not contain valid JSON. Please return ONLY the JSON object as specified.",
        },
      ];
      const result = await retryGenerate(
        retryMessages,
        mode,
        sandboxHTML,
        userMessage,
        2,
        false,
      );
      code = result.code;
      description = result.description;
      modelUsed = result.model || "deepseek/deepseek-v4-pro";
      totalAttempts = 1 + (result.attempts || 0);
    }

    const info = ` | ✅ Model: ${modelUsed}, Attempts: ${totalAttempts}`;
    const finalDescription = (description || "") + info;

    res.write(
      `data: ${JSON.stringify({ done: true, code, description: finalDescription })}\n\n`,
    );
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
//  POST /ask – Page assistant (unchanged)
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

app.get("/", (req, res) =>
  res.send("AI Backend v25 (flash‑first, pro last‑chance) is running."),
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
