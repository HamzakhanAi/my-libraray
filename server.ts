/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;

// Initialize GoogleGenAI client
const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({
  apiKey: apiKey,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", mode: process.env.NODE_ENV || "development" });
});

// 1. Text-To-Speech API with Kokoro open synthesis engine and fallback pipelines
app.post("/api/tts", async (req, res) => {
  try {
    const { text, voiceName } = req.body;
    
    if (!text || text.trim() === "") {
      return res.status(400).json({ error: "Text is required for TTS" });
    }

    const targetVoice = voiceName || "af_sarah";
    let audioBase64 = "";
    const errorLog: string[] = [];

    // Attempt 1: Active open-source Kokoro Space endpoints
    const endpoints = [
      "https://amsc-kokoro-tts.hf.space/v1/audio/speech",
      "https://g94-kokoro-82m.hf.space/v1/audio/speech",
      "https://gauss-st-kokoro-tts-api.hf.space/v1/audio/speech",
      "https://hexgrad-kokoro-82m.hf.space/v1/audio/speech",
    ];

    for (const url of endpoints) {
      try {
        console.log(`[TTS] Attempting Kokoro fallback on: ${url} (Voice: ${targetVoice})`);
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "kokoro",
            input: text.trim(),
            voice: targetVoice,
            response_format: "wav",
            speed: 1.0,
          }),
        });

        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          audioBase64 = buffer.toString("base64");
          console.log(`[TTS] Sourced successfully from Kokoro Space: ${url}`);
          return res.json({ audio: audioBase64 });
        } else {
          const errText = await response.text().catch(() => "");
          errorLog.push(`${url} [status ${response.status}]: ${errText.substring(0, 100)}`);
        }
      } catch (err: any) {
        errorLog.push(`${url} [connection error]: ${err.message || err}`);
      }
    }

    // Attempt 3: Gradio API predict interface fallback
    try {
      const gradioUrl = "https://g94-kokoro-82m.hf.space/api/predict";
      console.log(`[TTS] Attempting Gradio fallback predict at: ${gradioUrl}`);
      const response = await fetch(gradioUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: [
            text.trim(),
            targetVoice,
            1.0, // speed
            "en-us",
          ],
        }),
      });

      if (response.ok) {
        const resJson: any = await response.json();
        if (resJson && resJson.data && resJson.data[0]) {
          const item = resJson.data[0];
          if (typeof item === "string" && item.startsWith("data:audio/")) {
            const parts = item.split(",");
            audioBase64 = parts[1] || parts[0];
          } else if (item && typeof item === "object") {
            if (item.data && typeof item.data === "string") {
              const parts = item.data.split(",");
              audioBase64 = parts[1] || parts[0];
            } else if (item.name) {
              const fileUrl = `https://g94-kokoro-82m.hf.space/file=${item.name}`;
              const fileRes = await fetch(fileUrl);
              if (fileRes.ok) {
                const arrBuf = await fileRes.arrayBuffer();
                audioBase64 = Buffer.from(arrBuf).toString("base64");
              }
            }
          }
        }
      }
    } catch (err: any) {
      errorLog.push(`Gradio fallback error: ${err.message || err}`);
    }

    if (!audioBase64) {
      console.error("[TTS] All server-side generation mechanisms exhausted. Tracelog:", errorLog);
      return res.status(502).json({
        error: "Server-side TTS generation exhausted",
        details: errorLog.join(" | "),
      });
    }

    res.json({ audio: audioBase64 });
  } catch (err: any) {
    console.error("Critical server-side TTS endpoint crash:", err);
    res.status(500).json({ error: err.message || "Error generating speech with server-side TTS" });
  }
});

// 2. Interactive "Ask the book" / AI Query API
app.post("/api/ai/ask", async (req, res) => {
  try {
    const { bookTitle, bookAuthor, textContext, question, chatHistory } = req.body;

    if (!question) {
      return res.status(400).json({ error: "Question is required" });
    }

    // Prepare message history
    const systemInstruction = `You are Lumen Reader, an expert academic tutor and insightful reading companion.
You are helping the user study the book "${bookTitle}" by ${bookAuthor}.
Refer explicitly to the following contextual passage from the book if relevant, but draw on your wider literary/historical expertise to explain references.
Always answer gracefully, pairing academic precision with accessible guidance.

CURRENT PASSAGE CONTEXT:
"""
${textContext || "No dynamic context provided. Focus on general book themes."}
"""`;

    // Map history to contents
    const contents: any[] = [];
    if (chatHistory && Array.isArray(chatHistory)) {
      chatHistory.forEach((msg: any) => {
        contents.push({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.content }]
        });
      });
    }
    
    // Add current user prompt
    contents.push({
      role: "user",
      parts: [{ text: question }]
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents,
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    res.json({ response: response.text });
  } catch (err: any) {
    console.error("AI Ask error:", err);
    res.status(500).json({ error: err.message || "Error communicating with AI" });
  }
});

// 3. Chapter Summarization API
app.post("/api/ai/summarize", async (req, res) => {
  try {
    const { text, title } = req.body;

    if (!text || text.trim() === "") {
      return res.status(400).json({ error: "Text is required for summarization" });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Draft a high-fidelity summary of this chapter/passage titled "${title || 'Untitled'}". 
Include the main narrative thrust, three core key takeaways, and a list of key terms/characters introduced. Keep it structured and visually clean.`,
      config: {
        systemInstruction: "You are a professional educational editor designed to extract reading insights.",
        temperature: 0.3,
      },
    });

    res.json({ summary: response.text });
  } catch (err: any) {
    console.error("AI Summarize error:", err);
    res.status(500).json({ error: err.message || "Error generating summary" });
  }
});

// 4. Define and Vocab Builder API
app.post("/api/ai/define", async (req, res) => {
  try {
    const { word, context } = req.body;

    if (!word) {
      return res.status(400).json({ error: "Word is required" });
    }

    const prompt = `Analyze the word/phrase "${word}" within this exact sentence-context: "${context || 'No context supplied.'}".
Provide a concise dictionary-style entry including:
1. Word Class (noun, verb, etc.)
2. A simplified phonetics guide
3. A clear contextual definition (how it is used in this passage)
4. A simple synonyms list
5. A fresh example sentence using the word.

Make your response look elegant and strictly formatted as a clean, brief bulleted list.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are an elite lexicographer and reading support tool.",
        temperature: 0.2,
      },
    });

    res.json({ definition: response.text });
  } catch (err: any) {
    console.error("AI Define error:", err);
    res.status(500).json({ error: err.message || "Error generating definition" });
  }
});

// 5. Generate Section Quiz API
app.post("/api/ai/quiz", async (req, res) => {
  try {
    const { text, title } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Passage context is required for quiz rendering" });
    }

    const prompt = `Based on the following book chapter snippet:
"""
${text}
"""

Generate exactly 3 high-quality multiple choice comprehension study questions.
Return the questions strictly as a JSON array matching this format:
[
  {
    "question": "The question string",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctIndex": 0,
    "explanation": "Brief context on why this is correct."
  }
]`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.4,
      },
    });

    const quizText = response.text || "[]";
    const quizData = JSON.parse(quizText);
    res.json({ quiz: quizData });
  } catch (err: any) {
    console.error("AI Quiz error:", err);
    res.status(500).json({ error: err.message || "Error generating quiz questions" });
  }
});


// Express static / Vite asset pipelines
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Lumen Reader server running on port ${PORT}`);
  });
}

startServer();
