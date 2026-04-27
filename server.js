// server.js – AI backend for Render (streaming with AI‑generated live status)
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

    // ---------- Prepare system prompt (same as before but for streaming we add special instructions) ----------
    const baseGeneratePrompt = `You are a world‑class web designer and front‑end developer.
You create **complete, production‑ready, multi‑section websites or fully functional games** (HTML, CSS, JS) based on the user's request.

Your final output must be a JSON object:
{
  "code": "<full HTML page from <!DOCTYPE html> to </html>>",
  "description": "a short friendly summary of what you built"
}

Requirements: real content, complete sections, responsive, interactive, SEO, images with absolute URLs.`;

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
- The "code" field must be pure JS, no markdown.`;

    // ---------- STREAMING MODE ----------
    if (stream) {
      // Build the system prompt that tells the model how to output status + code
      let streamingInstructions = "";
      if (mode === "generate") {
        systemContent = `${baseGeneratePrompt}

**Streaming output instructions (IMPORTANT):**
You will output your response as a series of lines.
- Whenever you want to inform the user about what part you are currently working on, output a line EXACTLY like:
  STATUS: your short, human‑readable status update here
- For actual code, output lines prefixed with:
  CODE: the JSON line here
- You may output both STATUS and CODE lines freely as you progress.
- The code inside CODE lines must eventually form the complete, valid JSON object ({"code": "...", "description": "..."}).
- Do NOT use any other prefixes. End with a final CODE line containing the closing brace.
- The STATUS lines should be natural, accurate, and reflect exactly what you are coding at that moment (e.g., "Now writing the hero section HTML", "Adding responsive CSS for the navbar", "Implementing the score‑tracking JavaScript", etc.).
- Status updates should appear roughly every 5‑10 seconds of generated content.
- Keep STATUS messages one sentence, plain text.`;
        temperature = 0.2;
        maxTokens = 6000;
      } else {
        systemContent = `${baseEditPrompt}

**Streaming output instructions (IMPORTANT):**
Same as above: output STATUS: ... lines to describe your current action (e.g., "Selecting the main container", "Creating a new button element", "Adding an event listener for the form"), and CODE: ... lines for the JavaScript code of the final JSON. The final JSON must be formed by all CODE lines together.`;
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

      // Start streaming from OpenAI
      const completion = await client.chat.completions.create({
        model: "deepseek/deepseek-v4-flash",
        messages: [{ role: "system", content: systemContent }, ...messages],
        temperature,
        max_tokens: maxTokens,
        stream: true, // stream enabled
      });

      let fullText = "";
      let buffer = ""; // to reconstruct lines from chunks
      let statusSent = [];

      for await (const part of completion) {
        const content = part.choices[0]?.delta?.content || "";
        if (!content) continue;

        fullText += content;
        // We need to process full lines to detect STATUS/CODE prefixes
        buffer += content;
        while (buffer.includes("\n")) {
          const newlineIdx = buffer.indexOf("\n");
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);

          if (line.startsWith("STATUS: ")) {
            const message = line.substring(8).trim();
            if (message && !statusSent.includes(message)) {
              statusSent.push(message);
              sendSSE({ type: "status", message });
            }
          }
          // CODE lines will be accumulated later; we don't send them separately
        }
      }
      // Process any remaining buffer (might be a partial line without newline)
      if (buffer.startsWith("STATUS: ")) {
        const message = buffer.substring(8).trim();
        if (message && !statusSent.includes(message)) {
          sendSSE({ type: "status", message });
        }
      }

      // Now extract the JSON from the full text.
      // Since the model output lines with STATUS/CODE prefixes, we need to strip those and keep only the CODE parts.
      // Actually, a simpler method: we can just take the fullText and parse it for the JSON object, ignoring the STATUS lines.
      // Because the model will intersperse lines like "STATUS: ..." and "CODE: ...". The final JSON can be reconstructed by concatenating all CODE parts.
      // Let's do that:
      const lines = fullText.split("\n");
      let codeParts = [];
      for (const line of lines) {
        if (line.startsWith("CODE: ")) {
          codeParts.push(line.substring(6)); // remove "CODE: " prefix
        }
      }
      const codeString = codeParts.join("");
      const parsed = extractJSON(codeString);

      if (parsed && parsed.code && parsed.description) {
        sendSSE({
          type: "result",
          code: parsed.code,
          description: parsed.description,
        });
      } else {
        // Fallback: try to parse the entire text as JSON (maybe model ignored instructions)
        const fallback = extractJSON(fullText);
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

    // ---------- NON‑STREAMING MODE (unchanged) ----------
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
  res.send("AI Backend (live status streaming) is running."),
);

// --------------- Start server ---------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
