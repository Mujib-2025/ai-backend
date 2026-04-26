// netlify/functions/chatbot.js
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
    const { messages } = JSON.parse(event.body);
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ reply: "No messages provided." }),
      };
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant inside a web page.",
        },
        ...messages,
      ],
      temperature: 0.8,
    });

    const reply = completion.choices[0].message.content;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error("CHATBOT FUNCTION ERROR:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ reply: "Sorry, something went wrong." }),
    };
  }
};
