// server.js – AI Builder Ultra (Pro model, template injection, 90 % cost reduction)
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
    "X-Title": "AI Builder Ultra",
  },
});

// --------------- Mobile‑game template (cost‑optimised) ---------------
function getGameTemplate(script) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, maximum-scale=1.0, touch-action: manipulation">
<title>Game</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:100%; height:100%; overflow:hidden; background:#000; touch-action: none; }
#gameContainer { width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative; }
#score { color:white; font-size:20px; position:absolute; top:10px; left:10px; z-index:10; font-family:Arial,sans-serif; }
#restartBtn { position:absolute; bottom:20px; right:20px; z-index:10; padding:12px 24px; font-size:16px; background:#ff4757; color:white; border:none; border-radius:8px; cursor:pointer; }
canvas { display:block; }
</style>
</head>
<body>
<div id="gameContainer">
  <div id="score">Score: 0</div>
  <canvas id="gameCanvas"></canvas>
  <button id="restartBtn">Restart</button>
</div>
<script>
${script}
</script>
</body>
</html>`;
}

// --------------- Extract JSON ---------------
function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {}
  let cleaned = text
    .replace(/```json\s*([\s\S]*?)\s*```/g, "$1")
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

// --------------- Validate JS‑only code (no full HTML) ---------------
function validateGameScript(script, userMessage) {
  const errors = [];
  if (!script || typeof script !== "string" || script.trim().length === 0) {
    errors.push("Empty script");
    return errors;
  }
  const lower = script.toLowerCase();
  const lowerMsg = (userMessage || "").toLowerCase();
  const isGame =
    lowerMsg.includes("game") ||
    lowerMsg.includes("play") ||
    lowerMsg.includes("tic") ||
    lowerMsg.includes("snake") ||
    lowerMsg.includes("puzzle");

  // ABSOLUTE: no keyboard
  if (/\bkeydown\b|\bkeyup\b|\bkeypress\b|\bkeyboard\b/i.test(script)) {
    errors.push("Keyboard controls detected – remove all keyboard events.");
  }

  if (isGame) {
    if (!lower.includes("addeventlistener"))
      errors.push("No addEventListener – game won't respond to touch.");
    if (
      !lower.includes("requestanimationframe") &&
      !lower.includes("setinterval")
    )
      errors.push("Missing game loop (requestAnimationFrame or setInterval).");
    if (!lower.includes("score")) errors.push("No score variable found.");
    if (!lower.includes("restartbtn") && !lower.includes("restart"))
      errors.push(
        "No restart mechanism – the template provides #restartBtn, please use it.",
      );
    if (
      !lower.includes("touchstart") &&
      !lower.includes("touchend") &&
      !lower.includes("click")
    )
      errors.push("No touch/click event listeners.");
    const funcDefs = script.match(/function\s+(\w+)/g) || [];
    const definedFuncs = new Set(
      funcDefs.map((f) => f.replace("function ", "")),
    );
    const eventRegex =
      /addEventListener\s*\(\s*['"](?:click|touchstart|touchend)['"]\s*,\s*(\w+)/g;
    let m;
    while ((m = eventRegex.exec(script)) !== null) {
      if (!definedFuncs.has(m[1]) && m[1] !== "null" && m[1] !== "function")
        errors.push(`Event listener references undefined function '${m[1]}'.`);
    }
  }
  return errors;
}

// --------------- System prompt (ultra‑compact) ---------------
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

  const touchRules = `ABSOLUTE RULES:
- Touch controls ONLY (touchstart, touchend, click). NO keyboard events.
- No inline onclick, <input>, alert, prompt.
- All buttons >=44px, use addEventListener.
- All referenced functions must exist.`;

  if (mode === "generate") {
    return `You are a master mobile game developer. You are given a ready‑made HTML template that already contains:
- A full‑screen canvas (id="gameCanvas")
- A score display (id="score")
- A restart button (id="restartBtn")

Write ONLY the JavaScript code that makes the game work. The code will be injected into <script> at the end of the body.
${touchRules}
Make sure to:
- Use requestAnimationFrame for the game loop.
- Define a function that resets the entire game and bind it to #restartBtn.
- Include scoring, win/lose condition.
- Touch controls only.
${is3D ? '- Use Three.js ES module from "https://cdn.jsdelivr.net/npm/three@0.156.1/build/three.module.js".' : ""}
${isGame ? "- The game must be fully playable on load." : ""}

Output ONLY a JSON object (no markdown, no explanation) with exactly two fields:
- "script": the JavaScript code as a string
- "description": a one‑sentence summary

Example:
{ "script": "/* your code */", "description": "A flappy bird clone." }`;
  } else {
    return `You are a front‑end expert. Modify the current sandbox page precisely.
Current page:
\`\`\`html
${sandboxHTML || "(empty)"}
\`\`\`
Rules: Use 'doc' for all DOM access (it is already provided). Only return JavaScript code.
Output ONLY this JSON (no markdown):
{
  "code": "your JavaScript code",
  "description": "brief summary of changes"
}`;
  }
}

// --------------- AI call with retry ---------------
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
      max_tokens: mode === "generate" ? 2500 : 2500, // increased generate cap to 2500
      response_format: { type: "json_object" },
    });

    const text = completion.choices[0].message.content;
    const parsed = extractJSON(text);

    if (parsed && typeof parsed.description === "string") {
      // Accept both "script" and "code" fields for generate mode
      let codeField =
        mode === "generate"
          ? parsed.script || parsed.code // fallback to "code" if "script" missing
          : parsed.code;

      if (typeof codeField !== "string") {
        console.log(`Attempt ${attempt + 1} missing code/script field`);
        if (attempt < maxRetries) {
          currentMessages.push({
            role: "user",
            content:
              "Your JSON must have a 'script' (for generate) or 'code' (for edit) field.",
          });
          continue;
        }
        return {
          code: null,
          description: "Invalid JSON fields",
          model,
          attempts: attempt + 1,
        };
      }

      const errors =
        mode === "generate"
          ? validateGameScript(codeField, userMessage)
          : validateGeneratedCode_for_edit(codeField);
      if (errors.length === 0) {
        return {
          code: codeField,
          description: parsed.description,
          model,
          attempts: attempt + 1,
          success: true,
        };
      }

      console.log(`Validation failed: ${errors.join("; ")}`);
      if (attempt < maxRetries) {
        let correction = `Your previous output was invalid. ${errors.join("; ")}.`;
        if (mode === "generate")
          correction +=
            " Use the provided template elements (canvas, score, restartBtn).";
        else correction += " Remember: use 'doc' for all DOM operations.";
        currentMessages.push({ role: "user", content: correction });
        continue;
      }
      return {
        code: codeField,
        description: `⚠️ ${parsed.description} (issues: ${errors.join("; ")})`,
        model,
        attempts: attempt + 1,
      };
    } else {
      console.log(
        `Attempt ${attempt + 1} failed JSON parsing, raw response:`,
        text.slice(0, 200),
      );
      if (attempt < maxRetries) {
        currentMessages.push({
          role: "user",
          content: "Please return ONLY the JSON object as specified.",
        });
      } else {
        // fallback extraction
        const jsMatch =
          text.match(/```javascript\s*([\s\S]*?)\s*```/) ||
          text.match(/```\s*([\s\S]*?)```/);
        if (jsMatch) {
          return {
            code: jsMatch[1].trim(),
            description: "Extracted code from non‑JSON output.",
            model,
            attempts: attempt + 1,
          };
        }
        return {
          code: null,
          description: "Failed to parse JSON.",
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

// Edit validation (unchanged logic, adjusted for JS only)
function validateGeneratedCode_for_edit(code) {
  const errors = [];
  if (!code || typeof code !== "string" || code.trim().length === 0) {
    errors.push("Empty code");
    return errors;
  }
  if (/\bdocument\./.test(code))
    errors.push("Uses 'document' instead of 'doc'.");
  if (code.includes("<!DOCTYPE") || code.includes("<html"))
    errors.push("Full HTML detected – only JavaScript expected.");
  return errors;
}

// ============================
//  POST /chat – Non‑streaming
// ============================
app.post("/chat", async (req, res) => {
  try {
    const { messages, mode = "edit", sandboxHTML = "" } = req.body;
    if (!messages || !Array.isArray(messages))
      return res.status(400).json({ error: "messages required" });

    const userMessage = messages[messages.length - 1]?.content || "";
    const result = await generateWithRetry(
      messages,
      mode,
      sandboxHTML,
      userMessage,
      1,
    );

    let finalCode = result.code;
    let finalDescription =
      result.description +
      ` | ✅ ${result.model}, Attempts: ${result.attempts}`;

    if (mode === "generate" && finalCode) {
      finalCode = getGameTemplate(finalCode);
    }

    res.json({ code: finalCode, description: finalDescription });
  } catch (err) {
    console.error("/chat error:", err);
    res
      .status(500)
      .json({ code: null, description: "Server error: " + err.message });
  }
});

// ============================
//  POST /chat/stream – Streaming (Pro only, template injection)
// ============================
app.post("/chat/stream", async (req, res) => {
  try {
    const { messages, mode = "edit", sandboxHTML = "" } = req.body;
    if (!messages || !Array.isArray(messages))
      return res.status(400).json({ error: "messages required" });

    const userMessage = messages[messages.length - 1]?.content || "";
    const model = "deepseek/deepseek-v4-pro";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    if (mode === "generate") {
      console.log(`Streaming generate using ${model}`);
      res.write(
        `data: ${JSON.stringify({ delta: "🎮 Crafting your game…" })}\n\n`,
      );

      const result = await generateWithRetry(
        messages,
        mode,
        sandboxHTML,
        userMessage,
        1,
      );
      let finalCode = result.code;
      let finalDescription =
        result.description + ` | ✅ ${model}, Attempts: ${result.attempts}`;

      if (finalCode) {
        finalCode = getGameTemplate(finalCode);
      }

      res.write(
        `data: ${JSON.stringify({ done: true, code: finalCode, description: finalDescription })}\n\n`,
      );
      res.end();
    } else {
      const systemContent = buildSystemPrompt(mode, sandboxHTML, userMessage);
      const stream = await client.chat.completions.create({
        model,
        messages: [{ role: "system", content: systemContent }, ...messages],
        temperature: 0.0,
        max_tokens: 2500,
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

      const parsed = extractJSON(fullContent);
      let code = null,
        description = "",
        attemptsUsed = 1;

      if (
        parsed &&
        typeof parsed.code === "string" &&
        typeof parsed.description === "string"
      ) {
        const errors = validateGeneratedCode_for_edit(parsed.code);
        if (errors.length === 0) {
          code = parsed.code;
          description = parsed.description;
        } else {
          console.log("Edit stream validation failed, retrying…");
          res.write(
            `data: ${JSON.stringify({ delta: "⚠️ Fixing issues…" })}\n\n`,
          );
          const correction = `Previous output invalid: ${errors.join("; ")}. Remember to use 'doc'.`;
          const retryMessages = [
            ...messages,
            { role: "user", content: correction },
          ];
          const result = await generateWithRetry(
            retryMessages,
            mode,
            sandboxHTML,
            userMessage,
            0,
          );
          code = result.code || parsed.code;
          description = result.description;
          attemptsUsed = 1 + (result.attempts || 1);
        }
      } else {
        console.log("Edit stream JSON parse failed, retrying…");
        res.write(
          `data: ${JSON.stringify({ delta: "⚠️ Fixing format…" })}\n\n`,
        );
        const retryMessages = [
          ...messages,
          {
            role: "user",
            content: "Return only valid JSON with 'code' and 'description'.",
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

      const info = ` | ✅ ${model}, Attempts: ${attemptsUsed}`;
      res.write(
        `data: ${JSON.stringify({ done: true, code, description: description + info })}\n\n`,
      );
      res.end();
    }
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
//  POST /ask – assistant (unchanged, lightweight)
// ============================
app.post("/ask", async (req, res) => {
  try {
    const { question, sandboxHTML } = req.body;
    if (!question) return res.status(400).json({ reply: "Missing question." });

    const systemMessage = {
      role: "system",
      content: `You are a helpful assistant. The user is viewing a mobile web page:\n\`\`\`html\n${sandboxHTML || "(empty)"}\n\`\`\`\nAnswer the question concisely. No code unless asked.`,
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
  res.send("AI Builder Ultra (cost‑optimised, template‑based) is running."),
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend on port ${PORT}`));
