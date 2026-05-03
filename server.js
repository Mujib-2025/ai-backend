// server.js – Mobile‑only AI backend (Pro model only, 2 attempts max, touch‑only enforcement)
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

    // ABSOLUTE RULE: NO KEYBOARD
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
    if (/\bdocument\./.test(code)) {
      errors.push(
        "Uses 'document' instead of 'doc'. All DOM access must go through 'doc'.",
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

// --------------- System Prompt (CONDENSED, same strict rules) ---------------
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
    lowerMsg.includes("webgl");

  const touchOnly = `
**MANDATORY TOUCH‑ONLY RULES (violations = invalid):**
- NO keyboard events (keydown, keyup, keypress). Only touchstart, touchend, click.
- NO inline onclick, <input>, textarea, contenteditable, alert(), prompt(), document.write().
- NO autofocus or .focus().
- All buttons ≥44px tap target, use addEventListener, perform visible action.
- Every function referenced from event listeners MUST exist.
- Images: absolute HTTPS URLs only (picsum.photos or source.unsplash.com).
- Mobile portrait, flex column, no horizontal scroll. touch-action:manipulation; user-select:none.
`;

  const gameSection = isGame
    ? `
**GAME REQUIREMENTS (complete, playable on load):**
- Fully implemented game with start state, requestAnimationFrame loop, score display, win/lose condition, and touch controls.
- Visible restart button that completely resets all variables, score, canvas, intervals.
- Game logic, movement, collisions, core mechanic all working.
${is3D ? '- 3D: use Three.js ES module from "https://cdn.jsdelivr.net/npm/three@0.156.1/build/three.module.js".' : ""}
`
    : "";

  if (mode === "generate") {
    return `You are an expert mobile game developer. Write a complete, self-contained HTML game.
${touchOnly}
${gameSection}
Layout: Portrait, relative units, no horizontal overflow.

**Output a JSON object only:**
{ "code": "<full HTML>", "description": "one-sentence summary" }
Start with { and end with }. No markdown.`;
  } else {
    return `You are an expert front‑end developer. Modify the existing sandbox page precisely.
Current sandbox:
\`\`\`html
${sandboxHTML || "(empty)"}
\`\`\`
**Rules:**
- Use 'doc' (already provided) for all DOM access. Never use 'document'.
- Only return JavaScript code.
**Output a JSON object only:**
{ "code": "your JavaScript", "description": "brief summary" }
Start with { and end with }.`;
  }
}

// --------------- Generate with Pro model, max 2 attempts ---------------
async function generateWithRetry(
  messages,
  mode,
  sandboxHTML,
  userMessage,
  maxRetries = 1,
) {
  let currentMessages = [...messages];
  const model = "deepseek/deepseek-v4-pro";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    console.log(`Attempt ${attempt + 1}/${maxRetries + 1} using ${model}`);

    const systemContent = buildSystemPrompt(mode, sandboxHTML, userMessage);
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemContent },
        ...currentMessages,
      ],
      temperature: 0.0,
      max_tokens: mode === "generate" ? 8000 : 2500, // reduced caps
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
        return {
          code: parsed.code,
          description: parsed.description,
          model,
          attempts: attempt + 1,
          success: true,
        };
      }

      console.log(
        `Attempt ${attempt + 1} failed validation:`,
        errors.join(", "),
      );
      if (attempt < maxRetries) {
        let correction = `Your previous output was invalid. Issues: ${errors.join("; ")}.`;
        if (mode === "edit") {
          correction +=
            " Remember: use 'doc' instead of 'document'." + userMessage;
        } else {
          correction +=
            " Fix ALL of them. Use ONLY touch and click events, no keyboard. Ensure restart button exists and resets the game.";
        }
        currentMessages.push({ role: "user", content: correction });
      } else {
        // Max retries reached – return last code with warning
        return {
          code: parsed.code,
          description: `⚠️ ${mode === "edit" ? "Edit" : "Game"} may be incomplete after ${attempt + 1} attempts. Issues: ${errors.join("; ")}`,
          model,
          attempts: attempt + 1,
        };
      }
    } else {
      console.log(`Attempt ${attempt + 1} failed JSON parsing`);
      if (attempt < maxRetries) {
        currentMessages.push({
          role: "user",
          content:
            "Your output did not contain valid JSON with 'code' and 'description' fields. Please return ONLY the JSON object as specified.",
        });
      } else {
        // Last resort fallback extraction
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
            model,
            attempts: attempt + 1,
          };
        }
        return {
          code: null,
          description: `Failed to produce valid JSON after ${attempt + 1} attempts.`,
          model,
          attempts: attempt + 1,
        };
      }
    }
  }

  return {
    code: null,
    description: "Generation failed.",
    model,
    attempts: maxRetries + 1,
  };
}

// ============================
//  POST /chat – Non‑streaming
// ============================
app.post("/chat", async (req, res) => {
  try {
    const { messages, mode = "edit", sandboxHTML = "" } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    const userMessage = messages[messages.length - 1]?.content || "";
    const result = await generateWithRetry(
      messages,
      mode,
      sandboxHTML,
      userMessage,
      1,
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
//  POST /chat/stream – Streaming (Pro only)
// ============================
app.post("/chat/stream", async (req, res) => {
  try {
    const { messages, mode = "edit", sandboxHTML = "" } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    const userMessage = messages[messages.length - 1]?.content || "";
    const systemContent = buildSystemPrompt(mode, sandboxHTML, userMessage);
    const model = "deepseek/deepseek-v4-pro";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // First attempt: streaming with Pro
    console.log(`Streaming attempt 1 using ${model}`);
    const stream = await client.chat.completions.create({
      model,
      messages: [{ role: "system", content: systemContent }, ...messages],
      temperature: 0.0,
      max_tokens: mode === "generate" ? 8000 : 2500, // reduced caps for stream too
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
    let attemptsUsed = 1;

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
        console.log("Streaming result failed validation, retrying...");
        res.write(
          `data: ${JSON.stringify({ delta: "⚠️ Fixing issues..." })}\n\n`,
        );

        let correction = `Your previous output was invalid. Issues: ${errors.join("; ")}.`;
        if (mode === "edit") {
          correction += " Remember to use 'doc' for all DOM operations.";
        } else {
          correction +=
            " Fix all issues. Use touch controls only, no keyboard.";
        }
        const retryMessages = [
          ...messages,
          { role: "user", content: correction },
        ];

        const result = await generateWithRetry(
          retryMessages,
          mode,
          sandboxHTML,
          userMessage,
          0, // only one more attempt (total max 2 steps)
        );
        code = result.code || parsed.code;
        description = result.description;
        attemptsUsed = 1 + (result.attempts || 1);
      }
    } else {
      console.log("Streaming JSON parse failed, retrying...");
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
      const result = await generateWithRetry(
        retryMessages,
        mode,
        sandboxHTML,
        userMessage,
        0,
      );
      code = result.code;
      description = result.description;
      attemptsUsed = 1 + (result.attempts || 1);
    }

    const info = ` | ✅ Model: ${model}, Attempts: ${attemptsUsed}`;
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
      model: "deepseek/deepseek-v4-pro",
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
    "AI Backend v25 (Pro only, 2 attempts max, cost‑optimized) is running.",
  ),
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
