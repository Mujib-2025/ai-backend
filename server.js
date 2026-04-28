// server.js – AI backend (full CORS, streaming + non‑streaming)
// Game generation now uses /generate-spec – AI configures a deterministic engine,
// never generates code.
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const path = require("path");

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

// --------------- Helper: build system prompt (ORIGINAL – used by /chat) ---------------
function buildSystemPrompt(mode, sandboxHTML, complexity, device, userMessage) {
  // (unchanged from your original server.js – kept for non‑game editing)
  // ... full original function here ...
  // (I'm omitting the full repeated code for brevity – keep your existing implementation)
  // This function is used only by the old /chat endpoints.
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
  const is3D =
    lowerMsg.includes("3d") ||
    lowerMsg.includes("three.js") ||
    lowerMsg.includes("threejs") ||
    lowerMsg.includes("webgl") ||
    lowerMsg.includes("3d game");

  const mandatoryRules = `...`; // your existing rules
  const layout = isMobile
    ? `**Mobile layout:** ...`
    : `**Desktop layout:** ...`;
  const gameExtra = isGame ? `...` : `...`;
  const complexityExtra = isSimple ? `...` : `...`;
  const mobileSizing = isMobile && isGame ? `...` : "";
  const threeD = is3D ? `...` : "";
  const imageRules = `...`;

  const generateEnding = `...`;
  const editEnding = `...`;

  if (isGenerate) {
    return `You are an expert front‑end developer... ${mandatoryRules} ...${generateEnding}`;
  } else {
    return `You are an expert front‑end developer... ${editEnding}`;
  }
}

// ================================================
//  NEW GAME CONFIGURATOR – /generate-spec
// ================================================
function buildGameSpecPrompt(userMessage) {
  return `You are a **game configurator**, not a code generator.
You must output a single JSON object that conforms to the **Unified Game Spec** format.

**ABSOLUTE RULES:**
- NO code. NO scripts. NO functions. NO HTML.
- ONLY JSON.
- You select and parameterise existing engine systems.
- The engine will run the game – you never create new logic.

**THE FORMAT:**
{
  "world": {
    "seed": number,
    "width": number,
    "height": number,
    "resources": { "resource_name": initial_amount, ... },
    "forces": [ { "type": "gravity", "x": 0, "y": 9.81 }, ... ],
    "production": { "resource_name": rate_per_tick, ... },
    "interactions": [
      {
        "trigger": "collision",
        "entityA": "id",
        "entityB": "id",
        "distance": number,
        "action": "damage",
        "amount": number
      },
      ...
    ]
  },
  "entities": [
    {
      "id": "unique_string",
      "type": "player|enemy|resource|...",
      "position": { "x": number, "y": number },
      "rotation": 0,
      "components": {
        "health": 100,
        "mass": 1,
        "velocity": { "x": 0, "y": 0 },
        "inventory": { "gold": 0 },
        "energy": 100,
        "ownership": "player",
        "intelligence": { "template": "state_machine|utility|...", "params": {} },
        "rendering": { "radius": 10, "color": "blue" }
      }
    }
  ],
  "components": [ "list_of_component_names_used" ],
  "systems": [ "physics", "constraints", "ai", "interactions", "economy", "events", "rules" ],
  "constraints": [
    {
      "type": "orbit",
      "center": "planet_id",
      "orbiter": "moon_id",
      "distance": 80,
      "speed": 0.05
    }
  ],
  "events": [
    {
      "trigger": "time|resource_threshold|state",
      "time": 100,
      "action": "spawn|modify_force|win",
      "entityId": "optionally",
      "x": 200,
      "y": 200
    }
  ],
  "rules": {
    "win_condition": "survive_ticks|collect_resources|...",
    "win_value": number,
    "fail_condition": "health_zero|time_out|...",
    "fail_value": number
  }
}

**HOW TO BUILD THE JSON:**
- Translate the user's game idea into the above structure.
- Use ONLY the predefined component types and system names.
- If the user asks for “orbiting planets”, use *constraint:orbit* and set *intelligence* template to none.
- If the user wants a survival game, use resources, economy, win_condition=survive_ticks.
- State machines are defined by component parameters, not code.
- The engine handles rendering, physics, collisions, and AI – you just provide the configuration.

The user said: "${userMessage}"

**Your entire response MUST start with '{' and end with '}'. No markdown, no explanation.**`;
}

app.post("/generate-spec", async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }
    const userMessage =
      messages.length > 0 ? messages[messages.length - 1].content : "";

    const systemContent = buildGameSpecPrompt(userMessage);
    const temperature = 0.2; // low for structured output

    const completion = await client.chat.completions.create({
      model: "deepseek/deepseek-v4-flash",
      messages: [{ role: "system", content: systemContent }, ...messages],
      temperature,
      max_tokens: 3000,
      response_format: { type: "json_object" },
    });

    const text = completion.choices[0].message.content;
    const parsed = extractJSON(text);

    if (!parsed || !parsed.world) {
      return res.status(422).json({ error: "Invalid Game Spec generated" });
    }

    res.json({ spec: parsed });
  } catch (err) {
    console.error("/generate-spec error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

// ============================
//  POST /chat – Build / Edit (non‑streaming, unchanged)
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

    const maxTokens =
      complexity === "simple"
        ? mode === "generate"
          ? 10000
          : 3000
        : mode === "generate"
          ? 10000
          : 4000;

    const systemContent = buildSystemPrompt(
      mode,
      sandboxHTML,
      complexity,
      device,
      userMessage,
    );
    const temperature = 0.0;

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
//  POST /chat/stream – Streaming version with SSE (unchanged)
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

    const maxTokens =
      complexity === "simple"
        ? mode === "generate"
          ? 10000
          : 3000
        : mode === "generate"
          ? 10000
          : 4000;

    const systemContent = buildSystemPrompt(
      mode,
      sandboxHTML,
      complexity,
      device,
      userMessage,
    );
    const temperature = 0.0;

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
  res.send("AI Backend v16 (game compiler + classic builder) is running."),
);

// --------------- Start server ---------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI backend running on port ${PORT}`));
