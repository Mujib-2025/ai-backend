// server.js – AI backend for Render (full CORS, streaming + regular)
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

// ============================
//  POST /chat – Build / Edit (non-streaming fallback)
// ============================
app.post("/chat", async (req, res) => {
  try {
    const { messages, mode = "edit", sandboxHTML = "" } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    let systemContent, temperature, maxTokens;

    if (mode === "generate") {
      systemContent = `You are a world‑class web designer and front‑end developer.
You create **complete, production‑ready, multi‑section websites or fully functional games** (HTML, CSS, JS) based on the user's request.

Your output must be a single JSON object with the following structure:
{
  "code": "<full HTML page from <!DOCTYPE html> to </html>>",
  "description": "a short, friendly summary of what you built"
}

**ABSOLUTE REQUIREMENTS** (the page must be ready to publish immediately):
- **Real content:** No "Lorem Ipsum", no placeholders. Write genuine, unique text for every section.
- **Complete website structure:** Include a proper <header> (with logo and navigation), a <main> area with several meaningful sections (hero, features, about, services/projects, contact, footer), and a well‑styled <footer>.
- **Working navigation:** Internal links (href="#section") must scroll smoothly; external links (if any) must use valid placeholders like "#".
- **Responsive design:** Use modern CSS (grid/flexbox, media queries) so the layout works perfectly on mobile, tablet, and desktop.
- **Interactive elements:** Buttons, forms, sliders, or cards must have functional event handlers. For a game, include game logic, scoring, win/loss conditions, restart, and appropriate UI.
- **SEO basics:** Add a descriptive <title>, <meta name="description">, and semantic HTML5 tags.
- **Images:** Only absolute URLs from services like \`https://picsum.photos/WIDTH/HEIGHT\` or \`https://images.unsplash.com/photo-ID?w=WIDTH&h=HEIGHT\`. No local paths.
- **Performance:** Keep total size under 6000 tokens (the code may be longer than usual – that's okay).

Example for a game: a fully playable Tic‑Tac‑Toe with player/computer turns, score tracking, and a reset button.
Example for a portfolio site: hero image, about, skills, projects, contact form, and a sticky navbar.

Return **only** the JSON object. Do NOT wrap it in markdown.`;
      temperature = 0.2;
      maxTokens = 6000;
    } else {
      systemContent = `You are an expert front‑end developer. The user is working on a web page inside a sandbox.
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

**Your response must be a single JSON object:**
{"code": "the JavaScript code", "description": "one sentence summary of what was done"}

- The "code" field must contain only executable JavaScript (no markdown, no HTML wrapping). Do NOT include \`\`\`javascript fences.
- The "description" is for the log; make it short and human‑friendly.

Return **only** the JSON object.`;
      temperature = 0.3;
      maxTokens = 1500;
    }

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
    const { messages, mode = "edit", sandboxHTML = "" } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    // Same prompts as non-streaming, but without response_format (streaming doesn't support it)
    let systemContent, temperature, maxTokens;

    if (mode === "generate") {
      systemContent = `You are a world‑class web designer and front‑end developer.
You create **complete, production‑ready, multi‑section websites or fully functional games** (HTML, CSS, JS) based on the user's request.

Your output must be a single JSON object with the following structure:
{
  "code": "<full HTML page from <!DOCTYPE html> to </html>>",
  "description": "a short, friendly summary of what you built"
}

**ABSOLUTE REQUIREMENTS** (the page must be ready to publish immediately):
- **Real content:** No "Lorem Ipsum", no placeholders. Write genuine, unique text for every section.
- **Complete website structure:** Include a proper <header> (with logo and navigation), a <main> area with several meaningful sections (hero, features, about, services/projects, contact, footer), and a well‑styled <footer>.
- **Working navigation:** Internal links (href="#section") must scroll smoothly; external links (if any) must use valid placeholders like "#".
- **Responsive design:** Use modern CSS (grid/flexbox, media queries) so the layout works perfectly on mobile, tablet, and desktop.
- **Interactive elements:** Buttons, forms, sliders, or cards must have functional event handlers. For a game, include game logic, scoring, win/loss conditions, restart, and appropriate UI.
- **SEO basics:** Add a descriptive <title>, <meta name="description">, and semantic HTML5 tags.
- **Images:** Only absolute URLs from services like \`https://picsum.photos/WIDTH/HEIGHT\` or \`https://images.unsplash.com/photo-ID?w=WIDTH&h=HEIGHT\`. No local paths.
- **Performance:** Keep total size under 6000 tokens (the code may be longer than usual – that's okay).

Return **only** the JSON object. Do NOT wrap it in markdown.`;
      temperature = 0.2;
      maxTokens = 6000;
    } else {
      systemContent = `You are an expert front‑end developer. The user is working on a web page inside a sandbox.
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

**Your response must be a single JSON object:**
{"code": "the JavaScript code", "description": "one sentence summary of what was done"}

- The "code" field must contain only executable JavaScript (no markdown, no HTML wrapping). Do NOT include \`\`\`javascript fences.
- The "description" is for the log; make it short and human‑friendly.

Return **only** the JSON object.`;
      temperature = 0.3;
      maxTokens = 1500;
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const stream = await client.chat.completions.create({
      model: "deepseek/deepseek-v4-flash",
      messages: [{ role: "system", content: systemContent }, ...messages],
      temperature,
      max_tokens: maxTokens,
      stream: true, // <-- enable streaming
    });

    let fullContent = "";

    // Send progress events while streaming
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || "";
      if (delta) {
        fullContent += delta;
        // Send progress event with the new delta
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }

    // When the stream ends, parse the result
    const parsed = extractJSON(fullContent);
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
      description = fullContent || "Invalid response format.";
    }

    // Send final done event
    res.write(`data: ${JSON.stringify({ done: true, code, description })}\n\n`);
    res.end();
  } catch (err) {
    console.error("/chat/stream error:", err);
    // If headers already sent, we can't change them. Try to send an error event.
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
    if (!question) {
      return res.status(400).json({ reply: "Missing question." });
    }

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
app.get("/", (req, res) => res.send("AI Backend v2 (streaming) is running."));

// --------------- Start server ---------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
