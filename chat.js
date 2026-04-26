// netlify/functions/chat.js
const OpenAI = require("openai");

function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    let cleaned = text
      .replace(/```json\s*([\s\S]*?)\s*```/g, "$1")
      .replace(/```html\s*([\s\S]*?)\s*```/g, "$1")
      .replace(/```javascript\s*([\s\S]*?)\s*```/g, "$1")
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

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const {
      messages,
      mode = "full",
      featuresAdded = [],
      siteTopic = "",
    } = JSON.parse(event.body);
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // -------- MODE: FULL (base page) --------
    if (mode === "full") {
      const systemContent = `You are a world-class web designer. Create a complete, beautiful, responsive HTML page based on the user's request.

Rules:
- Include all necessary tags (doctype, head, body, viewport meta).
- Use modern CSS (grid, flexbox, gradients, shadows) and subtle animations.
- Images: absolute URLs like "https://picsum.photos/400/300". No local paths.
- Make it visually appealing.

Return JSON: { "code": "<full HTML>", "description": "short summary" }`;

      const completion = await client.chat.completions.create({
        model: "deepseek-v4-flash",
        messages: [{ role: "system", content: systemContent }, ...messages],
        temperature: 0.3,
        max_tokens: 6000,
        response_format: { type: "json_object" },
      });

      const parsed = extractJSON(completion.choices[0].message.content);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          code: parsed?.code || null,
          description: parsed?.description || "Page created.",
        }),
      };
    }

    // -------- MODE: INCREMENTAL (create one feature) --------
    if (mode === "incremental") {
      const systemContent = `You are a senior front-end developer. You enhance a web page by writing a **single, small** piece of JavaScript that adds exactly ONE new feature to the iframe's document.

What already exists (DO NOT re-add):
${featuresAdded.length ? featuresAdded.map((f, i) => `${i + 1}. ${f}`).join("\n") : "(nothing yet)"}

Original site theme: "${siteTopic}"

Your code will be executed inside: **iframe.contentWindow.eval(code)**.

RULES:
- Use ONLY plain, stable DOM methods (document.createElement, appendChild, querySelector, etc.).
- **Always check if elements exist** before using them. If missing, create them safely.
- Never use external libraries, alert, or document.write.
- For images, use absolute URLs: "https://picsum.photos/WIDTH/HEIGHT" or "https://via.placeholder.com/WIDTHxHEIGHT".
- Keep the code **under 60 lines**. Pure JS, no markdown.
- Wrap in (function() { ... })(); for isolation.
- Avoid complex template literals; use string concatenation.

Return JSON: { "code": "the JavaScript code", "description": "one sentence summary" }`;

      const completion = await client.chat.completions.create({
        model: "deepseek-v4-flash",
        messages: [{ role: "system", content: systemContent }, ...messages],
        temperature: 0.1,
        max_tokens: 1200,
        response_format: { type: "json_object" },
      });

      const parsed = extractJSON(completion.choices[0].message.content);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          code: parsed?.code || null,
          description: parsed?.description || "No description.",
        }),
      };
    }

    // -------- MODE: REVIEW (fix one existing feature) --------
    if (mode === "review") {
      // featuresAdded now contains descriptions of features that were supposedly added.
      // The user message will contain the specific feature description that needs to be checked.
      const featureToReview = messages[0]?.content || "";

      const systemContent = `You are an expert front-end debugger. The web page is supposed to have the following feature, but it may be missing, broken, or incomplete:

"${featureToReview}"

Other features already present (DO NOT touch them):
${
  featuresAdded
    .filter((f) => !f.includes(featureToReview))
    .map((f, i) => `${i + 1}. ${f}`)
    .join("\n") || "(none)"
}

Site theme: "${siteTopic}"

Your task:
- Write a **small JavaScript snippet** that **adds or fixes** the described feature so it works correctly and looks good.
- Only add missing DOM elements, correct broken IDs/classes, fix logic, etc.
- Do NOT remove or break any other part of the page.
- Use safe DOM methods, check for existence of elements.
- Keep code under 60 lines, no markdown, wrap in IIFE.

Return JSON: { "code": "the JavaScript fix", "description": "what was fixed" }`;

      const completion = await client.chat.completions.create({
        model: "deepseek-v4-flash",
        messages: [{ role: "system", content: systemContent }, ...messages],
        temperature: 0.1,
        max_tokens: 1200,
        response_format: { type: "json_object" },
      });

      const parsed = extractJSON(completion.choices[0].message.content);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          code: parsed?.code || null,
          description: parsed?.description || "No fix generated.",
        }),
      };
    }

    // Fallback
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid mode" }),
    };
  } catch (err) {
    console.error("CHAT FUNCTION ERROR:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ code: null, description: "Server error." }),
    };
  }
};
