// netlify/functions/ask.js
const OpenAI = require("openai");

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const { question, sandboxHTML } = JSON.parse(event.body);
    if (!question) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ reply: "Missing question." }),
      };
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemMessage = {
      role: "system",
      content: `You are a helpful assistant. The user is viewing a web page whose content is:\n\`\`\`html\n${sandboxHTML || "(empty)"}\n\`\`\`\n\nAnswer the user's question about it.`,
    };

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [systemMessage, { role: "user", content: question }],
      temperature: 0.7,
      max_tokens: 800,
    });

    const reply = completion.choices[0].message.content;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error("ASK FUNCTION ERROR:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ reply: "Sorry, something went wrong." }),
    };
  }
};
