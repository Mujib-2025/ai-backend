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

// --------------- Helper: build system prompt ---------------
function buildSystemPrompt(mode, sandboxHTML, complexity, device) {
  const isGenerate = mode === "generate";
  const isMobile = device === "mobile";
  const isSimple = complexity === "simple";

  let deviceGuidelines = "";
  if (isMobile) {
    deviceGuidelines = `
**DEVICE TARGET: MOBILE (strict)**
- Design for a vertical single‑column layout. The page must not scroll horizontally.
- Use 'max-width: 100%; overflow-x: hidden;' on the body / main container.
- All interactive elements must have minimum touch targets of 44x44px.
- No hover‑only interactions – use click/active states instead.
- Font sizes should be legible on small screens (16px minimum for body text).
- The layout should feel like a native mobile experience, not a scaled‑down desktop page.
- Use flex‑box or grid with 'flex-wrap: wrap' only if absolutely necessary, avoid creating wide content.
`;
  } else {
    deviceGuidelines = `
**DEVICE TARGET: DESKTOP**
- Optimise for wider screens (1024px+), mouse interactions, and hover effects.
- Use responsive design that still adapts to smaller viewports, but the primary focus is desktop.
`;
  }

  let complexityGuidelines = "";
  if (isSimple) {
    complexityGuidelines = `
**QUALITY: SIMPLE MODE**
- Generate a **lightweight, minimal** page. Use only essential CSS and clean, short JS.
- **BUT:** All requested functionality MUST work perfectly. Game logic, buttons, form handling – everything must be fully operational.
- Prioritise working code over decoration. Fancy animations or extra sections may be omitted.
- Keep total code concise – aim for the smallest possible size while remaining functional.
`;
  }

  if (isGenerate) {
    return `You are a world‑class web designer and front‑end developer.
You create **complete, production‑ready, multi‑section websites or fully functional games** (HTML, CSS, JS) based on the user's request.

Your response must be a single JSON object with this exact structure and nothing else:
{
  "code": "<full HTML page from <!DOCTYPE html> to </html>>",
  "description": "a short, friendly summary of what you built"
}

**CRITICAL:** Your entire message must start with { and end with }. No introductory text, no markdown fences, no commentary. Just the raw JSON.

${deviceGuidelines}
${complexityGuidelines}

**ABSOLUTE REQUIREMENTS** (the page must be ready to publish immediately):
- **Real content:** No "Lorem Ipsum", no placeholders. Write genuine, unique text for every section.
- **Complete website structure:** Include a proper <header> (with logo and navigation), a <main> area with several meaningful sections (hero, features, about, services/projects, contact, footer), and a well‑styled <footer>.
- **Working navigation:** Internal links (href="#section") must scroll smoothly; external links (if any) must use valid placeholders like "#".
- **Responsive design:** Use modern CSS (grid/flexbox, media queries) so the layout works perfectly on mobile, tablet, and desktop, but with primary focus on the device target.
- **Interactive elements:** Buttons, forms, sliders, or cards must have functional event handlers. For a game, include game logic, scoring, win/loss conditions, restart, and appropriate UI.
- **SEO basics:** Add a descriptive <title>, <meta name="description">, and semantic HTML5 tags.
- **Images:** Only absolute URLs from services like \`https://picsum.photos/WIDTH/HEIGHT\` or \`https://images.unsplash.com/photo-ID?w=WIDTH&h=HEIGHT\`. No local paths.
- **Performance:** Keep total size under ${isSimple ? 3000 : 6000} tokens.

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

${deviceGuidelines}
${complexityGuidelines}

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

    // Increased token budgets for simple mode to allow functionality
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
  res.send("AI Backend v5 (mobile strict + simple functional) is running."),
);

// --------------- Start server ---------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
