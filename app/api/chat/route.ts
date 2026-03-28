import { generateText } from "ai";
import { google } from "@ai-sdk/google";

export async function POST(request: Request) {
  try {
    const { messages, systemPrompt } = await request.json();

    const { text } = await generateText({
      model: google("gemini-2.0-flash"),
      messages,
      system: systemPrompt,
    });

    return Response.json({ success: true, text }, { status: 200 });
  } catch (error: any) {
    console.error("Chat Error:", error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
