/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { randomUUID } from "crypto";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const hostHeader = req.headers.host;
  const isLocalIpOrigin = req.hostname === "127.0.0.1";
  const shouldNormalizeOrigin = (req.method === "GET" || req.method === "HEAD") && !req.path.startsWith("/api/");

  if (!hostHeader || !isLocalIpOrigin || !shouldNormalizeOrigin) {
    next();
    return;
  }

  const normalizedHost = hostHeader.replace(/^127\.0\.0\.1(?=[:]|$)/, "localhost");
  res.redirect(307, `${req.protocol}://${normalizedHost}${req.originalUrl}`);
});

const PORT = Number(process.env.PORT || 3000);

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

type KokoroSegmentRequest = {
  id: string;
  text: string;
};

type KokoroSegmentResult = {
  id: string;
  audio: string;
};

type KokoroPendingRequest = {
  resolve: (results: KokoroSegmentResult[]) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

const DEFAULT_KOKORO_VOICE = "af_sarah";
const KOKORO_WORKER_PATH = path.join(process.cwd(), "scripts", "kokoro_worker.py");
const KOKORO_PYTHON_BIN = process.env.KOKORO_PYTHON_BIN || process.env.PYTHON_PATH || "python3";
const KOKORO_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

let kokoroWorker: ChildProcessWithoutNullStreams | null = null;
let kokoroBootPromise: Promise<void> | null = null;
let kokoroStdoutBuffer = "";

const kokoroPendingRequests = new Map<string, KokoroPendingRequest>();

function rejectAllKokoroPendingRequests(error: Error) {
  for (const [requestId, pending] of kokoroPendingRequests.entries()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
    kokoroPendingRequests.delete(requestId);
  }
}

function resetKokoroWorkerState() {
  kokoroWorker = null;
  kokoroStdoutBuffer = "";
}

function handleKokoroWorkerLine(line: string, onReady?: () => void) {
  let payload: any;

  try {
    payload = JSON.parse(line);
  } catch {
    console.log(`[Kokoro worker stdout] ${line}`);
    return;
  }

  if (payload?.event === "ready") {
    onReady?.();
    return;
  }

  const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
  if (!requestId) {
    return;
  }

  const pending = kokoroPendingRequests.get(requestId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeout);
  kokoroPendingRequests.delete(requestId);

  if (!payload.ok) {
    pending.reject(new Error(payload.error || "Kokoro synthesis failed."));
    return;
  }

  pending.resolve(Array.isArray(payload.results) ? payload.results : []);
}

function startKokoroWorker() {
  if (kokoroWorker && !kokoroWorker.killed) {
    return Promise.resolve();
  }

  if (kokoroBootPromise) {
    return kokoroBootPromise;
  }

  kokoroBootPromise = new Promise<void>((resolve, reject) => {
    const child = spawn(KOKORO_PYTHON_BIN, [KOKORO_WORKER_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTORCH_ENABLE_MPS_FALLBACK: process.env.PYTORCH_ENABLE_MPS_FALLBACK || "1",
      },
    });

    kokoroWorker = child;
    kokoroStdoutBuffer = "";

    let workerReady = false;
    let stderrLog = "";

    const markReady = () => {
      if (workerReady) {
        return;
      }
      workerReady = true;
      resolve();
    };

    const failBoot = (message: string) => {
      if (workerReady) {
        return;
      }
      workerReady = true;
      reject(new Error(message));
    };

    child.stdout.on("data", (chunk) => {
      kokoroStdoutBuffer += chunk.toString();

      let lineBreakIndex = kokoroStdoutBuffer.indexOf("\n");
      while (lineBreakIndex !== -1) {
        const line = kokoroStdoutBuffer.slice(0, lineBreakIndex).trim();
        kokoroStdoutBuffer = kokoroStdoutBuffer.slice(lineBreakIndex + 1);

        if (line) {
          handleKokoroWorkerLine(line, markReady);
        }

        lineBreakIndex = kokoroStdoutBuffer.indexOf("\n");
      }
    });

    child.stderr.on("data", (chunk) => {
      const message = chunk.toString();
      stderrLog += message;
      console.error(`[Kokoro worker stderr] ${message.trim()}`);
    });

    child.once("error", (error) => {
      resetKokoroWorkerState();
      rejectAllKokoroPendingRequests(error);
      failBoot(`Failed to start Kokoro worker with ${KOKORO_PYTHON_BIN}: ${error.message}`);
    });

    child.once("exit", (code, signal) => {
      const reason = `Kokoro worker exited (code: ${code ?? "null"}, signal: ${signal ?? "none"})${stderrLog ? `\n${stderrLog.trim()}` : ""}`;
      resetKokoroWorkerState();
      rejectAllKokoroPendingRequests(new Error(reason));
      failBoot(reason);
    });
  }).finally(() => {
    kokoroBootPromise = null;
  });

  return kokoroBootPromise;
}

async function synthesizeWithKokoro(segments: KokoroSegmentRequest[], voiceName = DEFAULT_KOKORO_VOICE, speed = 1) {
  await startKokoroWorker();

  if (!kokoroWorker) {
    throw new Error("Kokoro worker is unavailable.");
  }

  return new Promise<KokoroSegmentResult[]>((resolve, reject) => {
    const requestId = randomUUID();
    const timeout = setTimeout(() => {
      kokoroPendingRequests.delete(requestId);
      reject(new Error("Kokoro synthesis timed out."));
    }, KOKORO_REQUEST_TIMEOUT_MS);

    kokoroPendingRequests.set(requestId, {
      resolve,
      reject,
      timeout,
    });

    const payload = JSON.stringify({
      requestId,
      voiceName,
      speed,
      segments,
    });

    kokoroWorker.stdin.write(`${payload}\n`, (error) => {
      if (!error) {
        return;
      }

      clearTimeout(timeout);
      kokoroPendingRequests.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", mode: process.env.NODE_ENV || "development" });
});

// 1. Text-To-Speech API backed only by local hexgrad/kokoro
app.post("/api/tts", async (req, res) => {
  try {
    const { text, voiceName, speed } = req.body;

    if (!text || text.trim() === "") {
      return res.status(400).json({ error: "Text is required for TTS" });
    }

    const targetVoice = typeof voiceName === "string" && voiceName.trim() ? voiceName.trim() : DEFAULT_KOKORO_VOICE;
    const targetSpeed = typeof speed === "number" && Number.isFinite(speed) ? speed : 1;
    const [result] = await synthesizeWithKokoro([
      {
        id: "segment-0",
        text: text.trim(),
      },
    ], targetVoice, targetSpeed);

    if (!result?.audio) {
      return res.status(502).json({ error: "Kokoro did not return audio." });
    }

    res.json({
      audio: result.audio,
      engine: "hexgrad/kokoro",
      voiceName: targetVoice,
    });
  } catch (err: any) {
    console.error("Critical server-side TTS endpoint crash:", err);
    res.status(500).json({ error: err.message || "Error generating speech with Kokoro" });
  }
});

app.post("/api/tts/batch", async (req, res) => {
  try {
    const { segments, voiceName, speed } = req.body;

    if (!Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ error: "At least one segment is required for batch TTS." });
    }

    const normalizedSegments = segments
      .map((segment: any) => ({
        id: String(segment?.id ?? "").trim(),
        text: String(segment?.text ?? "").trim(),
      }))
      .filter((segment: KokoroSegmentRequest) => segment.id && segment.text);

    if (normalizedSegments.length === 0) {
      return res.status(400).json({ error: "Each batch segment must include an id and text." });
    }

    const targetVoice = typeof voiceName === "string" && voiceName.trim() ? voiceName.trim() : DEFAULT_KOKORO_VOICE;
    const targetSpeed = typeof speed === "number" && Number.isFinite(speed) ? speed : 1;
    const results = await synthesizeWithKokoro(normalizedSegments, targetVoice, targetSpeed);

    res.json({
      audios: results,
      engine: "hexgrad/kokoro",
      voiceName: targetVoice,
    });
  } catch (err: any) {
    console.error("Critical batch TTS endpoint crash:", err);
    res.status(500).json({ error: err.message || "Error generating batch speech with Kokoro" });
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
    const { createServer: createViteServer } = await import("vite");
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
