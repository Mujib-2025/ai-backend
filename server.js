// server.js – Mobile‑only AI backend (strict touch‑only, no keyboard, 3 retries)
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

// --------------- Validate generated code (stricter touch‑only enforcement) ---------------
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

    // ---------- ABSOLUTE RULE: NO KEYBOARD ----------
    if (/\bkeydown\b|\bkeyup\b|\bkeypress\b|\bkeyboard\b/i.test(code)) {
      errors.push(
        "Keyboard controls detected – touch‑only mobile required. Remove all keyboard event listeners.",
      );
    }

    if (isGame) {
      if (!lower.includes("addeventlistener"))
        errors.push(
          "No addEventListener – interactive elements will not work on mobile",
        );
      if (
        !lower.includes("requestanimationframe") &&
        !lower.includes("setinterval")
      )
        errors.push("No game loop (requestAnimationFrame or setInterval)");
      if (!lower.includes("restart") && !lower.includes("reset"))
        errors.push("No restart/reset functionality");
      if (!lower.includes("score")) errors.push("No score variable or display");
      const functionMatches = code.match(/function\s+\w+/g);
      if (!functionMatches || functionMatches.length < 2)
        errors.push("Fewer than 2 functions – game logic may be incomplete");
      if (
        !lower.includes("touchstart") &&
        !lower.includes("touchend") &&
        !lower.includes("click")
      )
        errors.push(
          "No touch/click event handlers – buttons won't work on mobile",
        );

      // Restart button visible in HTML
      const restartBtnRegex =
        /<button[^>]*>[\s\S]*?(?:restart|reset)[\s\S]*?<\/button>/i;
      if (!restartBtnRegex.test(code)) {
        errors.push("No visible restart/reset button found in HTML");
      }

      // Restart function that resets game state
      const restartLogicIndicators =
        /\bscore\s*=\s*0\b|\bresetGame\b|\bclearInterval\b|\bcancelAnimationFrame\b|\bctx\.clearRect\b|\bgameOver\s*=\s*false\b/i;
      if (
        !/function\s+(restart|reset)\s*\(\)/i.test(code) &&
        !restartLogicIndicators.test(code)
      ) {
        errors.push("No restart/reset function that resets game state");
      }

      // Event listeners must reference defined functions
      const eventListenerRegex =
        /addEventListener\s*\(\s*['"](?:click|touchstart|touchend)['"]\s*,\s*(\w+)/g;
      let match;
      const usedFunctions = new Set();
      while ((match = eventListenerRegex.exec(code)) !== null) {
        usedFunctions.add(match[1]);
      }
      for (const funcName of usedFunctions) {
        const funcDefRegex = new RegExp(`function\\s+${funcName}\\s*\\(`);
        if (
          !funcDefRegex.test(code) &&
          funcName !== "function" &&
          funcName !== "null"
        ) {
          errors.push(
            `Event listener references function '${funcName}' which is not defined`,
          );
        }
      }
    }
  } else {
    // Edit mode: check for incorrect usage of document instead of doc
    if (/\bdocument\./.test(code)) {
      errors.push(
        "Uses 'document' instead of the provided 'doc' variable. All DOM access must go through 'doc'.",
      );
    }
    if (code.includes("<!DOCTYPE") || code.includes("<html")) {
      errors.push(
        "Edit code appears to be full HTML – only JavaScript is expected.",
      );
    }
  }

  return errors;
}

// --------------- System Prompt (Stronger touch‑only focus) ---------------
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

8. **ABSOLUTELY NO KEYBOARD CONTROLS:** This is a mobile‑only game. Do NOT use keydown, keyup, keypress, or any keyboard events. Only touch and mouse click events are allowed.

9. **MOBILE TOUCH CONTROLS ONLY:** All player interaction must be via touch (touchstart, touchend) or click. Use event listeners for these. Do not mention keyboard controls anywhere in the code.

10. **FULL GAME REQUIREMENT (TOP PRIORITY):**
If this is a game, you MUST include:
- Start state
- Game loop (update + render using requestAnimationFrame)
- Player interaction (touch – use touchstart/touchend or click)
- Game logic (movement, rules, collisions)
- Score system (visible and updating)
- Win OR lose condition
- Restart button that fully resets the game (visible in HTML, calls a function that resets all variables, score, canvas, intervals)

11. The game must be immediately playable on load.

12. **CORE MECHANIC REQUIREMENT:**
The main mechanic MUST be implemented and visible. It must update over time and affect game state (position, score, objects). No fake UI.

13. **STATE DRIVEN LOGIC:** All core behavior must be driven by real state variables that change during execution.

14. If using external libraries (like Three.js), use ES modules and <script type="module">.

15. **STRICT MOBILE VERTICAL RECTANGLE:** Portrait, flex column, no horizontal scroll. Use touch-action: manipulation; user-select: none; on interactive elements. Buttons ≥ 44px tap target.
`;

  const layout = `Mobile layout: Portrait, no horizontal scroll, use flex column. Keep all content inside a vertical rectangle. Use relative units.`;

  const gameExtra = isGame
    ? `This is a COMPLETE MOBILE GAME WITH TOUCH CONTROLS ONLY. No keyboard. Must be fully playable, with score, win/lose, restart.`
    : `This is a mobile website. Include header, main content, footer.`;

  const qualityText = `ULTRA QUALITY: Write complete, production‑ready code. Every feature fully implemented.`;

  const mobileSizing = isGame
    ? `Mobile game sizing: Use relative units, design for 9:16.`
    : "";

  const threeD = is3D
    ? `3D game (Three.js): Use ES modules, import from 'https://cdn.jsdelivr.net/npm/three@0.156.1/build/three.module.js'. Mobile touch only. No keyboard.`
    : "";

  const imageRules = `Images: Always use absolute HTTPS URLs (https://picsum.photos/400/300 or https://source.unsplash.com/featured/?{topic}). Never local paths.`;

  const generateEnding = `**Output format:** ONLY a JSON object: { "code": "<full HTML>", "description": "one-sentence summary" }

CRITICAL: The game must be error-free, touch‑only, with working buttons, score update, win/lose, and a visible restart button. No keyboard events.

Your entire message must start with { and end with }. No markdown or explanation.`;

  const editEnding = `**How your code is executed:**
\`\`\`
new Function("sandbox", "doc", yourCode)(sandbox, doc);
\`\`\`
You DO NOT need to declare or compute \`doc\`. It is already available as a parameter.
Just use \`doc\` directly for any DOM manipulation.

Current sandbox content:
\`\`\`html
${sandboxHTML || "(empty)"}
\`\`\`

PRECISE EDIT MODE: Modify ONLY the specific part(s) requested. Return a JSON object with the modified JavaScript code and a brief summary.

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
    return `You are an expert front‑end developer. Modify the existing sandbox page precisely as requested, using the provided \`doc\` variable.
${editEnding}`;
  }
}

// --------------- Retry‑enabled generation (non‑streaming) ---------------
async function retryGenerate(
  messages,
  mode,
  sandboxHTML,
  userMessage,
  maxRetries = 3,
) {
  let currentMessages = [...messages];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const systemContent = buildSystemPrompt(mode, sandboxHTML, userMessage);
    const completion = await client.chat.completions.create({
      model: "deepseek/deepseek-v4-flash",
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
        return { code: parsed.code, description: parsed.description };
      }

      console.log(`Attempt ${attempt + 1} failed:`, errors.join(", "));
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
          description: `⚠️ ${mode === "edit" ? "Edit" : "Game"} may be incomplete after ${maxRetries + 1} attempts. Issues: ${errors.join("; ")}`,
        };
      }
    } else {
      console.log(`Attempt ${attempt + 1} JSON parse failed`);
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
        if (fallbackCode)
          return {
            code: fallbackCode.trim(),
            description:
              "Extracted code from non‑JSON output (quality not guaranteed).",
          };
        return {
          code: null,
          description: "Failed to produce valid JSON after multiple attempts.",
        };
      }
    }
  }
  return { code: null, description: "Generation failed." };
}

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
      3,
    );
    res.json(result);
  } catch (err) {
    console.error("/chat error:", err);
    res
      .status(500)
      .json({ code: null, description: "Server error: " + err.message });
  }
});

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
      const errors = validateGeneratedCode(parsed.code, userMessage, mode);
      if (errors.length === 0) {
        code = parsed.code;
        description = parsed.description;
      } else {
        console.log("Stream failed validation, retrying...");
        res.write(
          `data: ${JSON.stringify({ delta: "⚠️ Fixing issues..." })}\n\n`,
        );
        let correction = `Your previous output was invalid. Issues: ${errors.join("; ")}.`;
        if (mode === "edit") correction += " Use 'doc' instead of 'document'.";
        else correction += " Fix all issues. No keyboard controls, touch only.";
        const retryMessages = [
          ...messages,
          { role: "user", content: correction },
        ];
        const result = await retryGenerate(
          retryMessages,
          mode,
          sandboxHTML,
          userMessage,
          3,
        );
        code = result.code || parsed.code;
        description = result.description;
      }
    } else {
      console.log("Stream JSON parse failed, retrying...");
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
        3,
      );
      code = result.code;
      description = result.description;
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
  res.send("AI Backend v23 (touch‑only enforcement, no keyboard) is running."),
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
