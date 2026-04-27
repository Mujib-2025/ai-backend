// server.js – AI backend for Render (streaming with code‑derived live status)
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

// --------------- Generate a meaningful status from partial code ---------------
function codeStatus(code) {
  if (!code || code.length < 20) return "Starting to build…";

  // Try to guess the type
  const isHTML = /<!doctype html|<html|<head|<body/i.test(code);
  const isJS =
    !isHTML && /\bfunction\b|\bconst\b|\blet\b|\bdocument\./.test(code);

  if (isHTML) {
    // Look for the last meaningful HTML element that was opened
    const tagMatches = code.match(/<(\w+)(\s[^>]*)?>/g);
    if (tagMatches) {
      const lastTag = tagMatches[tagMatches.length - 1].match(/<(\w+)/)[1];
      // Map tags to friendly descriptions
      const tagMap = {
        header: "header with navigation",
        nav: "navigation bar",
        section: "content section",
        div: "layout container",
        main: "main content area",
        footer: "footer",
        form: "form",
        button: "button",
        img: "image",
        h1: "heading",
        h2: "heading",
        p: "text paragraph",
        ul: "list",
        table: "table",
        script: "JavaScript",
        style: "CSS styles",
      };
      const desc = tagMap[lastTag] || lastTag;
      return `Building <${lastTag}> (${desc})…`;
    }
    // If can't identify, check CSS
    if (code.includes("{") && code.includes("}")) return "Writing CSS styles…";
    return "Structuring HTML…";
  }

  if (isJS) {
    if (code.includes("addEventListener")) return "Adding event listeners…";
    if (code.includes("createElement")) return "Creating new DOM elements…";
    if (code.includes("querySelector")) return "Selecting page elements…";
    if (code.includes("function")) return "Writing JavaScript functions…";
    if (code.includes("game") || code.includes("board"))
      return "Implementing game logic…";
    return "Writing JavaScript code…";
  }

  // Fallback
  return "Generating code…";
}

// ============================
//  POST /chat – Build / Edit
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

    // ---------- System prompts (same as before) ----------
    const baseGeneratePrompt = `You are a world‑class web designer and front‑end developer.
You create **complete, production‑ready, multi‑section websites or fully functional games** (HTML, CSS, JS) based on the user's request.

Your output must be a JSON object:
{
  "code": "<full HTML page from <!DOCTYPE html> to </html>>",
  "description": "a short friendly summary of what you built"
}

Requirements: real content, complete sections, responsive, interactive, SEO-friendly, images with absolute URLs.`;

    const baseEditPrompt = `You are an expert front‑end developer. The user is working on a web page inside a sandbox.
The current page content is:

\`\`\`html
${sandboxHTML || "(empty)"}
\`\`\`

Your task: **write a JavaScript snippet that modifies or extends the sandbox**.
- Use document.getElementById('sandbox-iframe') and its contentDocument.
- Preserve existing elements, use stable DOM methods.
- For images, absolute URLs like https://picsum.photos/400/300.
- Return a JSON object: {"code": "the JavaScript", "description": "what you did"}.
- The "code" field must be pure JS (no markdown).`;

    // ---------- STREAMING BRANCH (improved) ----------
    if (stream) {
      if (mode === "generate") {
        systemContent = `${baseGeneratePrompt}\n\nReturn ONLY the JSON object. No markdown.`;
        temperature = 0.2;
        maxTokens = 6000;
      } else {
        systemContent = `${baseEditPrompt}\n\nReturn ONLY the JSON object. No markdown.`;
        temperature = 0.3;
        maxTokens = 1500;
      }

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendSSE = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

      let lastStatus = "AI is starting…";
      sendSSE({ type: "status", message: lastStatus });

      // Start streaming with JSON object format
      const completion = await client.chat.completions.create({
        model: "deepseek/deepseek-v4-flash",
        messages: [{ role: "system", content: systemContent }, ...messages],
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        stream: true,
      });

      let accumulatedJSON = "";
      let codeSoFar = "";
      let lastStatusSent = "";

      // Heartbeat to update status every 3 seconds (in case code hasn't changed)
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) {
          const status = codeStatus(codeSoFar);
          if (status !== lastStatusSent) {
            lastStatusSent = status;
            sendSSE({ type: "status", message: status });
          }
        } else {
          clearInterval(heartbeat);
        }
      }, 3000);

      for await (const part of completion) {
        const content = part.choices[0]?.delta?.content || "";
        if (content) {
          accumulatedJSON += content;

          // Try to parse partial JSON to extract the "code" field so far
          try {
            const partial = JSON.parse(accumulatedJSON);
            if (partial.code && partial.code !== codeSoFar) {
              codeSoFar = partial.code;
              const newStatus = codeStatus(codeSoFar);
              if (newStatus !== lastStatusSent) {
                lastStatusSent = newStatus;
                sendSSE({ type: "status", message: newStatus });
              }
            }
          } catch (e) {
            // JSON not fully formed yet – ignore
          }
        }
      }

      clearInterval(heartbeat);

      // Final parse
      const finalParsed = extractJSON(accumulatedJSON);
      if (finalParsed && finalParsed.code && finalParsed.description) {
        sendSSE({
          type: "result",
          code: finalParsed.code,
          description: finalParsed.description,
        });
      } else {
        // Fallback: maybe the JSON was complete but extractJSON failed; try original accumulated
        const fallback = extractJSON(accumulatedJSON);
        if (fallback && fallback.code && fallback.description) {
          sendSSE({
            type: "result",
            code: fallback.code,
            description: fallback.description,
          });
        } else {
          sendSSE({
            type: "result",
            code: null,
            description: "Could not generate valid code.",
          });
        }
      }

      res.end();
      return;
    }

    // ---------- NON‑STREAMING BRANCH (unchanged) ----------
    if (mode === "generate") {
      systemContent = `${baseGeneratePrompt}\n\nReturn only the JSON object. No markdown.`;
      temperature = 0.2;
      maxTokens = 6000;
    } else {
      systemContent = `${baseEditPrompt}\n\nReturn only the JSON object. No markdown.`;
      temperature = 0.3;
      maxTokens = 1500;
    }

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
      content: `You are a helpful assistant. The user is viewing a web page:\n\`\`\`html\n${sandboxHTML || "(empty)"}\n\`\`\`\n\nAnswer the user's question clearly.`,
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
  res.send("AI Backend (live code‑derived status) is running."),
);

// --------------- Start server ---------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
