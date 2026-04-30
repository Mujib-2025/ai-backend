// server.js – Mobile‑only AI backend (strict game enforcement, precise edit with doc validation)
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

// --------------- Validate generated code (mode‑aware) ---------------
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
    }
  } else {
    // Edit mode: check for incorrect usage of document instead of doc
    if (/\bdocument\./.test(code)) {
      errors.push(
        "Uses 'document' instead of the provided 'doc' variable. All DOM access must go through 'doc'.",
      );
    }
    // Basic sanity: code must not be HTML (should be pure JS)
    if (code.includes("<!DOCTYPE") || code.includes("<html")) {
      errors.push(
        "Edit code appears to be full HTML – only JavaScript is expected.",
      );
    }
  }

  return errors;
}

// --------------- System Prompt (Ultra mode, mobile, game enforcement) ---------------
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

8. **FULL GAME REQUIREMENT (TOP PRIORITY):**
If this is a game, you MUST include:
- Start state (game initializes correctly)
- Game loop (update + render using requestAnimationFrame)
- Player interaction (touch – use touchstart/touchend or click)
- Game logic (movement, rules, collisions)
- Score system (visible and updating)
- Win OR lose condition
- Restart button that fully resets the game

9. The game must be immediately playable on load.

10. **CORE MECHANIC REQUIREMENT:**
The main mechanic MUST be implemented and visible. It must update over time and affect game state (position, score, objects). No fake UI.

11. **STATE DRIVEN LOGIC:** All core behavior must be driven by real state variables that change during execution.

12. If using external libraries (like Three.js), use ES modules and <script type="module">.

13. **STRICT MOBILE VERTICAL RECTANGLE:** Portrait, flex column, no horizontal scroll. Use touch-action: manipulation; user-select: none; on interactive elements. Buttons ≥ 44px tap target. No keyboard controls.

14.**TOUCH EVENTS:** All interactive elements MUST respond to touch (touchstart/click). Use both if needed for mobile.
`;

  const layout = `Mobile layout: Portrait, no horizontal scroll, use flex column. Keep all content inside a vertical rectangle. Use relative units.`;

  const gameExtra = isGame
    ? `This is a COMPLETE MOBILE GAME. Only touch controls. Must be fully playable, with score, win/lose, restart.`
    : `This is a mobile website. Include header, main content, footer.`;

  const qualityText = `ULTRA QUALITY: Write complete, production‑ready code. Every feature requested must be fully implemented. No simplifications.`;

  const mobileSizing = isGame
    ? `Mobile game sizing: Use relative units, design for 9:16.`
    : "";

  const threeD = is3D
    ? `3D game (Three.js): Use ES modules (<script type="module">). Import like: import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.156.1/build/three.module.js'. Mobile touch only.`
    : "";

  const imageRules = `Images: Always use absolute HTTPS URLs (https://picsum.photos/400/300 or https://source.unsplash.com/featured/?{topic}). Never local paths.`;

  const generateEnding = `**Output format:** ONLY a JSON object: { "code": "<full HTML>", "description": "one-sentence summary" }

CRITICAL VALIDATION BEFORE OUTPUT: The game must be error-free, have working buttons, score update, win/lose, and restart. Design for mobile portrait.

Your entire message must start with { and end with }. No markdown or explanation.`;

  const editEnding = `**How your code is executed:**
\`\`\`
new Function("sandbox", yourCode)(sandboxElement)
\`\`\`
The parameter sandbox is the container DIV. To access the iframe content:
\`\`\`
const iframe = sandbox.querySelector('iframe#sandbox-iframe');
const doc = iframe ? iframe.contentDocument : sandbox.ownerDocument;
\`\`\`
You MUST use \`doc\` for ALL DOM manipulations (querySelector, getElementById, etc.). NEVER use \`document\` directly – it will point to the wrong page and break everything.

Current sandbox content:
\`\`\`html
${sandboxHTML || "(empty)"}
\`\`\`

**PRECISE EDIT MODE:** You MUST only modify the specific part(s) requested by the user. Read the user's request carefully. Do NOT rewrite the whole page. Return a JSON object with the modified JavaScript code (only the script that needs to be changed) and a brief summary of the change.

Output format: { "code": "your JavaScript code", "description": "brief summary of change" }

Your entire message must start with { and end with }. No markdown or explanation.`;

  if (mode === "generate") {
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
    return `You are an expert front‑end developer. Modify the existing sandbox page PRECISELY as requested, using the provided \`doc\` variable for all DOM access.
${editEnding}`;
  }
}

// --------------- Retry‑enabled generation (non‑streaming) ---------------
async function retryGenerate(
  messages,
  mode,
  sandboxHTML,
  userMessage,
  maxRetries = 2,
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

      console.log(
        `Attempt ${attempt + 1} failed validation:`,
        errors.join(", "),
      );
      if (attempt < maxRetries) {
        // Build a correction message specific to the mode
        let correction = `Your previous output was invalid. The following issues were found: ${errors.join("; ")}.`;
        if (mode === "edit") {
          correction +=
            " Remember: you MUST use the provided 'doc' variable for all DOM access, not 'document'. Use doc.querySelector, doc.getElementById, etc.";
        } else {
          correction +=
            " Fix ALL of them and return a complete, playable page. Make sure all buttons work via touch events, game loop exists, score, and restart.";
        }
        currentMessages.push({ role: "user", content: correction });
      } else {
        // Max retries – still return code with warning
        return {
          code: parsed.code,
          description: `⚠️ ${mode === "edit" ? "Edit" : "Game"} may be incomplete after ${maxRetries + 1} attempts. Issues: ${errors.join("; ")}`,
        };
      }
    } else {
      console.log(`Attempt ${attempt + 1} failed JSON parsing`);
      if (attempt < maxRetries) {
        currentMessages.push({
          role: "user",
          content:
            "Your output did not contain valid JSON with 'code' and 'description' fields. Return ONLY the JSON object as specified.",
        });
      } else {
        // Last attempt – fallback extraction only as last resort
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
          };
        }
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
//  POST /chat – Non‑streaming
// ============================
app.post("/chat", async (req, res) => {
  try {
    const { messages, mode = "edit", sandboxHTML = "" } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    const userMessage = messages[messages.length - 1]?.content || "";
    const result = await retryGenerate(
      messages,
      mode,
      sandboxHTML,
      userMessage,
      2,
    );
    res.json(result);
  } catch (err) {
    console.error("/chat error:", err);
    res
      .status(500)
      .json({ code: null, description: "Server error: " + err.message });
  }
});

// ============================
//  POST /chat/stream – Streaming with retry fallback
// ============================
app.post("/chat/stream", async (req, res) => {
  try {
    const { messages, mode = "edit", sandboxHTML = "" } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    const userMessage = messages[messages.length - 1]?.content || "";
    const maxTokens = mode === "generate" ? 10000 : 4000;
    const systemContent = buildSystemPrompt(mode, sandboxHTML, userMessage);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // First attempt: streaming
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
        console.log("Streaming result failed validation, retrying...");
        res.write(
          `data: ${JSON.stringify({ delta: "⚠️ Fixing issues..." })}\n\n`,
        );

        let correction = `Your previous output was invalid. The following issues were found: ${errors.join("; ")}.`;
        if (mode === "edit") {
          correction +=
            " Remember to use 'doc' for all DOM operations, not 'document'.";
        } else {
          correction +=
            " Fix ALL of them and return a complete, playable page.";
        }
        const retryMessages = [
          ...messages,
          { role: "user", content: correction },
        ];

        const result = await retryGenerate(
          retryMessages,
          mode,
          sandboxHTML,
          userMessage,
          1,
        );
        code = result.code || parsed.code;
        description = result.description;
      }
    } else {
      console.log("Streaming result failed JSON, retrying...");
      res.write(
        `data: ${JSON.stringify({ delta: "⚠️ Fixing output format..." })}\n\n`,
      );

      const retryMessages = [
        ...messages,
        {
          role: "user",
          content:
            "Your output did not contain valid JSON with 'code' and 'description' fields. Return ONLY the JSON object as specified.",
        },
      ];
      const result = await retryGenerate(
        retryMessages,
        mode,
        sandboxHTML,
        userMessage,
        1,
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

// Health check
app.get("/", (req, res) =>
  res.send("AI Backend v21 (edit mode fixes, doc enforcement) is running."),
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
