// server.js – AI backend for Render (full CORS, no timeout)
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
    // Remove markdown code fences
    let cleaned = text
      .replace(/```json\s*([\s\S]*?)\s*```/g, "$1")
      .replace(/```html\s*([\s\S]*?)\s*```/g, "$1")
      .replace(/```javascript\s*([\s\S]*?)\s*```/g, "$1")
      .trim();
    // Try to extract the first JSON object
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      cleaned = cleaned.substring(start, end + 1);
      try {
        return JSON.parse(cleaned);
      } catch (e2) {
        // Try replacing single quotes
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
//  POST /chat – Build / Edit
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
You create **complete, modern, fully responsive** HTML pages (including CSS and JavaScript) based on the user's request.

Your response must be a valid JSON object:
{
  "code": "<full HTML page (from <!DOCTYPE html> to </html>)>",
  "description": "a short, friendly summary of what you built"
}

Keep the HTML efficient (under 2500 tokens). Use clean, production‑ready code.

🖼️ **IMAGE RULES (CRITICAL)**:
- ALWAYS use absolute, working image URLs starting with "https://".
- NEVER use local file names like "image.png", "/img/hero.jpg", or "./photo.jpg".
- Use real placeholder services:
    - "https://picsum.photos/WIDTH/HEIGHT" (random photo)
    - "https://images.unsplash.com/photo-ID?w=WIDTH&h=HEIGHT" (specific photo)
    - "https://via.placeholder.com/WIDTHxHEIGHT?text=TEXT" (colored placeholder)
- All images must be directly viewable in a browser.
`;
      temperature = 0.3;
      maxTokens = 2500;
    } else {
      systemContent = `You are an expert front‑end developer. The user is working on a web page inside a sandbox.
The current content is:

\`\`\`html
${sandboxHTML || "(empty)"}
\`\`\`

Your task: **modify or extend** the existing page using JavaScript DOM code.
- Preserve all existing elements unless the user explicitly asks to remove/replace something.
- Use standard methods (querySelector, createElement, appendChild, innerHTML on specific containers).
- The code will run inside the sandbox (which may contain an iframe with id "sandbox-iframe").
  If the content is inside that iframe, you must access it via:
    const iframe = document.getElementById('sandbox-iframe');
    const doc = iframe.contentDocument;
  and then manipulate the iframe's document.
- Never use alert, prompt, or document.write.

🖼️ **IMAGE RULES**:
- When adding an image, use an absolute "https://" URL.
- Use "https://picsum.photos/400/300" or "https://via.placeholder.com/400x300?text=Image" as a placeholder.
- NEVER use local file paths like "image.png" or "./image.jpg".

- Return ONLY a JSON object: {"code": "...", "description": "..."}
- The "code" field must be executable JavaScript (no markdown inside the string).`;
      temperature = 0.5;
      maxTokens = 1500;
    }

    const completion = await client.chat.completions.create({
      model: "deepseek/deepseek-v4-flash", // "deepseek/deepseek-chat" also works
      messages: [{ role: "system", content: systemContent }, ...messages],
      temperature,
      max_tokens: maxTokens,
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
//  POST /ask – Page assistant
// ============================
app.post("/ask", async (req, res) => {
  try {
    const { question, sandboxHTML } = req.body;
    if (!question) {
      return res.status(400).json({ reply: "Missing question." });
    }

    const systemMessage = {
      role: "system",
      content: `You are a helpful assistant. The user is viewing a web page whose content is:\n\`\`\`html\n${sandboxHTML || "(empty)"}\n\`\`\`\n\nAnswer the user's question about it.`,
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

// --------------- Health check (optional) ---------------
app.get("/", (req, res) => res.send("AI Backend is running."));

// --------------- Start server ---------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
