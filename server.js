// server.js – AI backend for Render (streaming real-time status, JSON enforced)
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

// ---------- Real-time status inference ----------
function inferStatus(textSoFar) {
  // Infer current building phase based on partial code content
  const t = textSoFar.toLowerCase();
  if (t.includes("<!doctype html") || t.includes("<html"))
    return "Structuring HTML document…";
  if (t.includes("<head>")) return "Setting up metadata and links…";
  if (
    t.includes("<style>") ||
    t.includes("style>") ||
    t.includes("font-family")
  )
    return "Adding CSS styling…";
  if (t.includes("</style>")) return "Styling almost complete…";
  if (t.includes("<body")) return "Building body layout…";
  if (t.includes("<header") || t.includes("<nav"))
    return "Crafting header and navigation…";
  if (t.includes("<section") || t.includes("<main"))
    return "Assembling page sections…";
  if (t.includes("<footer")) return "Finishing footer…";
  if (t.includes("<script>") || t.includes("function "))
    return "Implementing JavaScript logic…";
  if (t.includes("</script>")) return "Finalizing scripts…";
  if (t.includes("</html>")) return "Wrapping up…";
  // For game / interactive elements
  if (t.includes("game") || t.includes("board") || t.includes("score"))
    return "Building game mechanics…";
  if (t.includes("addEventListener") || t.includes("onclick"))
    return "Hooking up event listeners…";
  // Default
  return "Generating code…";
}

// ============================
//  POST /chat – Build / Edit (with optional SSE streaming)
// ============================
app.post("/chat", async (req, res) => {
  try {
    const {
      messages,
      mode = "edit",
      sandboxHTML = "",
      stream = false,
    } = req.body;
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

Requirements (the page must be ready to publish immediately):
- Real content: No "Lorem Ipsum", no placeholders. Write genuine, unique text for every section.
- Complete website structure: header, navigation, several meaningful sections, footer.
- Working navigation, responsive design (mobile, tablet, desktop), interactive elements.
- For games: full game logic, scoring, win/loss, restart.
- SEO basics: descriptive title, meta description, semantic tags.
- Images: absolute URLs (e.g., https://picsum.photos/…).
- Performance: keep code under 6000 tokens.

Return **only** the JSON object. No markdown.`;
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

Your response must be a single JSON object:
{"code": "the JavaScript code", "description": "one sentence summary of what was done"}

- The "code" field must contain only executable JavaScript (no markdown, no HTML wrapping).
- The "description" is for the log; make it short and human‑friendly.

Return **only** the JSON object.`;
      temperature = 0.3;
      maxTokens = 1500;
    }

    // ---------- STREAMING BRANCH ----------
    if (stream) {
      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // helpful for nginx/proxy
      });

      const sendSSE = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      let fullText = "";
      let lastStatus = "Starting…";
      sendSSE({ type: "status", message: lastStatus });

      // Use OpenAI streaming
      const completion = await client.chat.completions.create({
        model: "deepseek/deepseek-v4-flash",
        messages: [{ role: "system", content: systemContent }, ...messages],
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        stream: true, // enable streaming
      });

      // Periodic heartbeat (every 8 sec) to keep UI fresh
      const heartbeat = setInterval(() => {
        // Only send if connection is still open
        if (!res.writableEnded) {
          sendSSE({ type: "status", message: lastStatus });
        } else {
          clearInterval(heartbeat);
        }
      }, 8000);

      // Process stream chunks
      for await (const part of completion) {
        const content = part.choices[0]?.delta?.content || "";
        if (content) {
          fullText += content;
          const newStatus = inferStatus(fullText);
          if (newStatus !== lastStatus) {
            lastStatus = newStatus;
            sendSSE({ type: "status", message: lastStatus });
          }
        }
      }

      clearInterval(heartbeat);

      // Parse the final JSON and send result
      const parsed = extractJSON(fullText);
      if (parsed && parsed.code && parsed.description) {
        sendSSE({
          type: "result",
          code: parsed.code,
          description: parsed.description,
        });
      } else {
        // In case parsing fails, still send the raw text as description
        sendSSE({
          type: "result",
          code: null,
          description: fullText || "Could not generate a valid response.",
        });
      }

      res.end();
      return;
    }

    // ---------- NON‑STREAMING BRANCH (original behavior) ----------
    const completion = await client.chat.completions.create({
      model: "deepseek/deepseek-v4-flash",
      messages: [{ role: "system", content: systemContent }, ...messages],
      temperature,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      stream: false,
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
    if (!res.headersSent) {
      res
        .status(500)
        .json({ code: null, description: "Server error: " + err.message });
    }
  }
});

// ============================
//  POST /ask – Page assistant (unchanged, but safe)
// ============================
app.post("/ask", async (req, res) => {
  try {
    const { question, sandboxHTML } = req.body;
    if (!question) {
      return res.status(400).json({ reply: "Missing question." });
    }

    const systemMessage = {
      role: "system",
      content: `You are a helpful assistant. The user is viewing a web page whose content is:\n\`\`\`html\n${sandboxHTML || "(empty)"}\n\`\`\`\n\nAnswer the user's question about it. Keep answers clear and concise.`,
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
app.get("/", (req, res) => res.send("AI Backend (streaming) is running."));

// --------------- Start server ---------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
