// server.js – AI backend for Render (full CORS, streaming + non‑streaming, debug pass)
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

// --------------- Helper: build system prompt ---------------
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

  let layoutInstructions = "";
  if (isMobile) {
    layoutInstructions = `
- **CRITICAL: STRICT MOBILE VERTICAL LAYOUT**
  * The page MUST be a single vertical column fitting a phone screen (375-414px wide target). No horizontal scrolling whatsoever.
  * Use \`max-width: 100vw; overflow-x: hidden; box-sizing: border-box;\` on body and all containers.
  * Absolutely NO fixed pixel widths wider than the viewport. Use percentages or \`100%\`.
  * Avoid CSS Grid with large fixed columns; use flexbox with \`flex-direction: column\`.
  * All images and iframes must be \`max-width: 100%\`.
  * Touch targets must be at least 44×44px.
  * No hover‑dependent interactions – use click/active events only.
  * Never use \`:hover\` for critical functionality.
`;
  } else {
    layoutInstructions = `
- **DESKTOP LAYOUT**: Optimize for wide screens (1024px+). Use mouse interactions (hover, pointer) and responsive design that still works on smaller viewports, but desktop is the primary target.
`;
  }

  let gameInstructions = "";
  if (isGame) {
    gameInstructions = `
- **YOU ARE BUILDING A GAME, NOT A WEBSITE.**
  * The entire page must be a single gameplay screen – no header, no navigation, no sections like “home”, “contact”, “about”.
  * Only the game itself (canvas, board, buttons, score, restart) should exist.
  * Keep the layout minimal and focused.
`;
  } else {
    gameInstructions = `
- **If the request is for a standard website**, include a proper <header>, <main> with sections (hero, features, about, contact, footer), and navigation.
`;
  }

  let complexityInstructions = isSimple
    ? `- **Simple Mode**: Keep code minimal but fully functional. Skip decorative extras, but all game logic/interactions must work perfectly.`
    : `- **Advanced Mode**: Feel free to add richer styling and animations while keeping everything working.`;

  if (isGenerate) {
    return `You are a world‑class web designer and front‑end developer.
You create **complete, production‑ready HTML pages** based on the user's request.

Your response must be a single JSON object with this exact structure and nothing else:
{
  "code": "<full HTML page from <!DOCTYPE html> to </html>>",
  "description": "a short, friendly summary of what you built"
}

**CRITICAL:** Your entire message must start with { and end with }. No introductory text, no markdown fences, no commentary. Just the raw JSON.

${layoutInstructions}

${gameInstructions}

${complexityInstructions}

**ABSOLUTE REQUIREMENTS** (the page must be ready to publish immediately):
- **Real content:** No "Lorem Ipsum", no placeholders. Write genuine, unique text for every section if applicable.
- Images: Only absolute URLs from services like \`https://picsum.photos/WIDTH/HEIGHT\`. No local paths.
- SEO basics: Add a descriptive <title> and <meta name="description">.

Remember: return ONLY the JSON object, no markdown wrapping.`;
  } else {
    return `You are an expert front‑end developer. The user is working on a web page inside a sandbox.
The current page content is:

\`\`\`html
${sandboxHTML || "(empty)"}
\`\`\`

Your task: **write a JavaScript snippet that modifies or extends the sandbox** to fulfill the user's request.
- The JavaScript will run inside the sandbox (which contains an iframe with id "sandbox-iframe").
  To access the page inside, always use:
    const iframe = document.getElementById('sandbox-iframe');
    const doc = iframe.contentDocument;
  and then manipulate the iframe's document.
- Preserve all existing elements unless the user explicitly asks to remove/replace something.
- Use only stable DOM methods (querySelector, createElement, appendChild, classList, etc.).
- Do NOT use alert, prompt, or document.write.
- For images, use absolute URLs like \`https://picsum.photos/400/300\`. Never local paths.

${layoutInstructions}

${gameInstructions}

${complexityInstructions}

**Your response must be a single JSON object with this exact structure and nothing else:**
{"code": "the JavaScript code", "description": "one sentence summary of what was done"}

**CRITICAL:** Your entire message must start with { and end with }. No markdown fences, no introductory text, just the raw JSON.
The "code" field must contain only executable JavaScript (no \`\`\`javascript fences, no extra wrapping).`;
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

    let maxTokens;
    if (complexity === "simple") {
      maxTokens = mode === "generate" ? 3000 : 1000;
    } else {
      maxTokens = mode === "generate" ? 6000 : 2000;
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

    let maxTokens;
    if (complexity === "simple") {
      maxTokens = mode === "generate" ? 3000 : 1000;
    } else {
      maxTokens = mode === "generate" ? 6000 : 2000;
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
//  POST /debug – Review & fix generated code
// ============================
app.post("/debug", async (req, res) => {
  try {
    const { code, mode, device, originalRequest } = req.body;
    if (!code) return res.status(400).json({ error: "code required" });

    const isMobile = device === "mobile";
    const deviceTarget = isMobile
      ? "mobile (strict vertical layout, no hover, touch‑friendly)"
      : "desktop (wide screens, mouse interactions)";

    const systemContent = `You are a senior QA engineer and front‑end fixer.
You are given a piece of code (${mode === "generate" ? "full HTML page" : "JavaScript snippet"}) that was generated for a **${deviceTarget}** experience.

Original request: "${originalRequest || "not provided"}"

Your job:
1. Carefully review the code for any bugs, missing functionality, or elements that do not properly respect the device target.
2. For mobile: ensure absolutely no hover‑dependent interactions, no horizontal overflow, all touch targets are large, layout is single column.
3. For desktop: ensure hover effects work, layout is appropriate for wide screens.
4. Fix any broken game logic, CSS issues, missing event handlers, or non‑functional parts.
5. Do NOT redesign the page; only fix what is broken or non‑compliant.

Return a JSON object: { "code": "<fixed code>", "description": "short summary of changes" }.
If nothing needed fixing, return the original code with description "No issues found."
Your entire message must start with { and end with }. No markdown.`;

    const completion = await client.chat.completions.create({
      model: "deepseek/deepseek-v4-flash",
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: code },
      ],
      temperature: 0.1,
      max_tokens: mode === "generate" ? 6000 : 2000,
      response_format: { type: "json_object" },
    });

    const text = completion.choices[0].message.content;
    const parsed = extractJSON(text);

    if (parsed && typeof parsed.code === "string") {
      return res.json({
        code: parsed.code,
        description: parsed.description || "Debug complete.",
      });
    } else {
      // Fallback: return original
      return res.json({
        code,
        description: "Debug skipped (invalid AI response).",
      });
    }
  } catch (err) {
    console.error("/debug error:", err);
    // If debug fails, return original code so the user can still see something
    return res.json({
      code: req.body.code || "",
      description: "Debug failed, using original.",
    });
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
  res.send("AI Backend v7 (strict device + debug pass) is running."),
);

// --------------- Start server ---------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
