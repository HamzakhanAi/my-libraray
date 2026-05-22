/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { Sparkles, MessageSquare, BookOpen, VolumeX, Volume2, Highlighter, RefreshCcw, Landmark, Brain, BookmarkCheck, CheckCircle2, XCircle, ArrowRight, BookMarked, HelpCircle } from "lucide-react";
import { Document, Highlight, Bookmark, AIThreadMessage } from "../types";

interface Props {
  document: Document;
  highlights: Highlight[];
  bookmarks: Bookmark[];
  activeParagraphIndex: number;
  activeSentenceIndex: number;
  onJumpTo: (paragraphIndex: number, sentenceIndex: number) => void;
  onRemoveHighlight: (id: string) => void;
  onRemoveBookmark: (id: string) => void;
}

type TabType = "ask" | "summarize" | "highlights" | "quiz" | "vocab";

export default function AISidebar({
  document,
  highlights,
  bookmarks,
  activeParagraphIndex,
  activeSentenceIndex,
  onJumpTo,
  onRemoveHighlight,
  onRemoveBookmark,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabType>("ask");
  const [loading, setLoading] = useState(false);

  // Chat tab state
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<AIThreadMessage[]>([
    {
      id: "welcome",
      role: "model",
      content: "Hello! I am your Lumen learning companion. Ask me any question about the characters, main arguments, definitions, or core themes of this text. I can see what paragraph you're currently focused on!",
      createdAt: new Date().toISOString(),
    },
  ]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Summary tab state
  const [summary, setSummary] = useState<string>("");
  const [summarizedParagraphIndex, setSummarizedParagraphIndex] = useState<number | null>(null);

  // Vocab State (dynamically populated from local double-taps or clicked words)
  const [selectedWord, setSelectedWord] = useState<string>("");
  const [vocabDefinition, setVocabDefinition] = useState<string>("");
  const [savedVocab, setSavedVocab] = useState<{ word: string; definition: string; phrase: string }[]>([]);

  // Quiz tab state
  const [quizPassageIndex, setQuizPassageIndex] = useState<number | null>(null);
  const [quizQuestions, setQuizQuestions] = useState<any[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({}); // qIdx -> selectedOptionIdx
  const [quizSubmitted, setQuizSubmitted] = useState<Record<number, boolean>>({}); // qIdx -> submitted

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const activeParagraphText = document.paragraphs[activeParagraphIndex]?.text || "";
  const activeSentenceText = document.paragraphs[activeParagraphIndex]?.sentences[activeSentenceIndex]?.text || "";

  // 1. Core Chat function
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || loading) return;

    const userMsg: AIThreadMessage = {
      id: Date.now().toString(),
      role: "user",
      content: chatInput,
      createdAt: new Date().toISOString(),
    };

    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookTitle: document.title,
          bookAuthor: document.author,
          textContext: `Active paragraph context: "${activeParagraphText}"\nActive sentence context: "${activeSentenceText}"`,
          question: userMsg.content,
          chatHistory: chatMessages.concat(userMsg),
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setChatMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "model",
          content: data.response,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "model",
          content: `⚠️ Failed to fetch response. Please verify that your GEMINI_API_KEY is configured correctly under Settings > Secrets.\nDetails: ${err.message}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // 2. Core Chapter Summarize function
  const handleSummarizeChapter = async () => {
    setLoading(true);
    setSummary("");
    try {
      // Gather relevant section text (say, the first 6 paragraphs of active index or whole window)
      const currentChapter = document.chapters.find(
        (ch, i) =>
          activeParagraphIndex >= ch.paragraphIndex &&
          (i === document.chapters.length - 1 || activeParagraphIndex < document.chapters[i + 1].paragraphIndex)
      ) || document.chapters[0];

      const paragraphsToSummarize = document.paragraphs
        .slice(currentChapter.paragraphIndex, currentChapter.paragraphIndex + 10)
        .map((p) => p.text)
        .join("\n\n");

      const response = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: paragraphsToSummarize,
          title: currentChapter.title,
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setSummary(data.summary);
      setSummarizedParagraphIndex(activeParagraphIndex);
    } catch (err: any) {
      setSummary(`⚠️ Summarization failed. Make sure your GEMINI_API_KEY is active in Secrets.\nIssue: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 3. Custom Vocab and Definition lookup
  const handleDefineWord = async (wordToQuery: string) => {
    if (!wordToQuery) return;
    setLoading(true);
    setSelectedWord(wordToQuery);
    setVocabDefinition("");

    try {
      const response = await fetch("/api/ai/define", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: wordToQuery,
          context: activeSentenceText,
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setVocabDefinition(data.definition);
    } catch (err: any) {
      setVocabDefinition(`Failed to request definition for this word. ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveVocab = () => {
    if (!selectedWord || !vocabDefinition) return;
    setSavedVocab((prev) => [
      ...prev,
      { word: selectedWord, definition: vocabDefinition, phrase: activeSentenceText },
    ]);
    setSelectedWord("");
    setVocabDefinition("");
  };

  // 4. Generate Section Quiz
  const handleGenerateQuiz = async () => {
    setLoading(true);
    setQuizQuestions([]);
    setQuizAnswers({});
    setQuizSubmitted({});
    try {
      // Grab block text representing active paragraph context window
      const sliceStart = Math.max(0, activeParagraphIndex - 1);
      const sliceEnd = Math.min(document.paragraphs.length, activeParagraphIndex + 3);
      const quizContext = document.paragraphs
        .slice(sliceStart, sliceEnd)
        .map((p) => p.text)
        .join("\n\n");

      const response = await fetch("/api/ai/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: quizContext,
          title: document.title,
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setQuizQuestions(data.quiz || []);
      setQuizPassageIndex(activeParagraphIndex);
    } catch (err: any) {
      setQuizQuestions([{ error: true, message: err.message || "Failed to generate quiz." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-zinc-950 border-l border-gray-200/55 dark:border-white/10 text-gray-800 dark:text-gray-100">
      {/* Sidebar Tabs Hub */}
      <div className="flex border-b border-gray-100 dark:border-white/5 overflow-x-auto select-none no-scrollbar shrink-0 bg-gray-50/50 dark:bg-zinc-900/50">
        {[
          { id: "ask", label: "Ask AI", icon: Sparkles },
          { id: "summarize", label: "Summarize", icon: BookOpen },
          { id: "highlights", label: "Library Logs", icon: Highlighter },
          { id: "vocab", label: "Vocab", icon: Brain },
          { id: "quiz", label: "Smart Quiz", icon: HelpCircle },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`flex-1 min-w-[70px] flex flex-col items-center justify-center gap-1 py-2 px-1 text-[11px] font-medium border-b-2 transition-all ${
                isActive
                  ? "border-teal-500 text-teal-600 dark:text-teal-400 bg-white dark:bg-zinc-950"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 hover:bg-gray-100/50 dark:hover:bg-white/5"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Tab Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ————— TAB 1: ASK AI ————— */}
        {activeTab === "ask" && (
          <div className="flex flex-col h-full space-y-4">
            <div className="text-xs bg-teal-500/5 p-3 rounded-lg border border-teal-500/20 text-teal-700 dark:text-teal-300 leading-snug flex gap-2">
              <Sparkles className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />
              <p>
                As you read or listen, I automatically track and review your focal sentences. Ask me questions like
                <em>"Who is Gregor?"</em>, <em>"Summarize this concept"</em>, or <em>"Explain the background theme"</em>.
              </p>
            </div>

            {/* Chat Box (Scrollable area) */}
            <div className="flex-1 min-h-[220px] max-h-[450px] overflow-y-auto border border-gray-100 dark:border-white/5 rounded-lg p-3 space-y-3 bg-gray-50/30 dark:bg-zinc-900/30">
              {chatMessages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-xs shadow-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-teal-600 text-white rounded-tr-none"
                        : "bg-white dark:bg-zinc-900 border border-gray-100 dark:border-white/5 rounded-tl-none text-gray-800 dark:text-gray-200"
                    }`}
                  >
                    <div className="whitespace-pre-line">{msg.content}</div>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-zinc-900 border border-gray-100 dark:border-white/5 rounded-xl rounded-tl-none px-4 py-3 text-xs text-gray-400 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-teal-500 animate-ping" />
                    Consulting textbook data...
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Prompt input Form */}
            <form onSubmit={handleSendMessage} className="flex gap-1.5 pt-2">
              <input
                type="text"
                placeholder="Ask about this context or book..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="flex-1 bg-gray-100 dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
              <button
                type="submit"
                disabled={loading || !chatInput.trim()}
                className="bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white p-2 rounded-lg transition-colors shadow-sm"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}

        {/* ————— TAB 2: SUMMARIZE ————— */}
        {activeTab === "summarize" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Chapter Summarizer</span>
              <button
                onClick={handleSummarizeChapter}
                disabled={loading}
                className="flex items-center gap-1 text-[11px] font-medium bg-teal-50 text-teal-600 hover:bg-teal-100 dark:bg-teal-950/40 dark:text-teal-400 px-2.5 py-1.5 rounded-lg border border-teal-200/50 dark:border-teal-900/40 transition-all shadow-sm"
              >
                <RefreshCcw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
                {summary ? "Regenerate Summary" : "Generate Core Chapter Summary"}
              </button>
            </div>

            {summary ? (
              <div className="p-4 bg-gray-50 dark:bg-zinc-900/50 rounded-xl border border-gray-100 dark:border-white/5 space-y-3">
                <div className="flex items-center gap-1 text-xs text-teal-600 dark:text-teal-400 font-semibold border-b border-gray-150 dark:border-white/5 pb-2">
                  <BookOpen className="w-4 h-4" />
                  <span>Interactive Chapter takeaways</span>
                </div>
                <div className="text-xs leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-line">
                  {summary}
                </div>
              </div>
            ) : (
              <div className="text-center py-10 text-gray-400 space-y-2">
                <BookOpen className="w-10 h-10 mx-auto text-gray-300 dark:text-zinc-700 stroke-1" />
                <p className="text-xs">No summary compiled yet.</p>
                <p className="text-[10px] text-gray-500">Tap trigger summary above to analyze current passage window.</p>
              </div>
            )}
          </div>
        )}

        {/* ————— TAB 3: HIGHLIGHTS & BOOKMARKS ————— */}
        {activeTab === "highlights" && (
          <div className="space-y-4 text-xs">
            {/* Bookmarks Section */}
            <div>
              <h4 className="font-semibold text-xs border-b border-gray-150 dark:border-white/5 pb-1.5 mb-2 flex items-center gap-1.5">
                <BookMarked className="w-4 h-4 text-teal-500" />
                Active Saved Bookmarks ({bookmarks.length})
              </h4>
              {bookmarks.length === 0 ? (
                <p className="text-[11px] text-gray-400 py-1 italic">No active bookmarks placed yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {bookmarks.map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center justify-between p-2 bg-gray-50 hover:bg-gray-100/80 dark:bg-zinc-900 dark:hover:bg-zinc-800/80 rounded border border-gray-150 dark:border-white/5"
                    >
                      <button
                        onClick={() => onJumpTo(b.paragraphIndex, b.sentenceIndex)}
                        className="text-left font-medium text-teal-600 dark:text-teal-400 truncate flex-1 hover:underline"
                      >
                        {b.label}
                      </button>
                      <button
                        onClick={() => onRemoveBookmark(b.id)}
                        className="text-[10px] text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 px-1.5 py-0.5 rounded transition-all ml-1"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Highlights Section */}
            <div>
              <h4 className="font-semibold text-xs border-b border-gray-150 dark:border-white/5 pb-1.5 mb-2 flex items-center gap-1.5">
                <Highlighter className="w-4 h-4 text-teal-500" />
                Study Highlights ({highlights.length})
              </h4>
              {highlights.length === 0 ? (
                <p className="text-[11px] text-gray-400 py-1 pdf-note italic">No highlights marked.</p>
              ) : (
                <div className="space-y-2">
                  {highlights.map((h) => (
                    <div
                      key={h.id}
                      className="p-2.5 bg-gray-50 dark:bg-zinc-900 border border-gray-150 dark:border-white/5 rounded-lg space-y-1.5"
                    >
                      {(() => {
                        const startParagraph = h.paragraphIndex;
                        const endParagraph = h.endParagraphIndex ?? h.paragraphIndex;
                        const paragraphLabel = startParagraph === endParagraph
                          ? `Para ${startParagraph + 1}`
                          : `Paras ${startParagraph + 1}-${endParagraph + 1}`;

                        return (
                      <div className="flex justify-between items-start gap-1">
                        <span className="text-[10px] font-mono text-gray-400">{paragraphLabel}</span>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => onJumpTo(h.paragraphIndex, h.sentenceIndex)}
                            className="text-[10px] text-teal-600 dark:text-teal-400 hover:underline font-medium"
                          >
                            Jump
                          </button>
                          <button
                            onClick={() => onRemoveHighlight(h.id)}
                            className="text-[10px] text-red-500 hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                        );
                      })()}
                      <p className={`p-1.5 rounded text-[11px] italic leading-snug border-l-2 border-teal-500 bg-white dark:bg-zinc-950 text-gray-700 dark:text-gray-300`}>
                        "{h.text}"
                      </p>
                      {h.note && (
                        <p className="text-[10px] text-gray-505 bg-yellow-500/5 px-2 py-1 rounded border border-yellow-500/10 italic text-yellow-800 dark:text-yellow-400">
                          Note: {h.note}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ————— TAB 4: BRAIN VOCABULARY ————— */}
        {activeTab === "vocab" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-gray-150 dark:border-white/5">
              <Brain className="w-4 h-4 text-teal-500" />
              <h3 className="font-semibold text-xs">Dynamic Vocab Lookup</h3>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] text-gray-500 leading-relaxed">
                Highlight or select a specific word, click <strong>Define</strong>, or enter any word directly to build a custom study dictionary.
              </p>
              
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter a custom word..."
                  value={selectedWord}
                  onChange={(e) => setSelectedWord(e.target.value)}
                  className="flex-1 bg-gray-100 dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded px-2 py-1.5 text-xs focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleDefineWord(selectedWord)}
                  disabled={loading || !selectedWord}
                  className="bg-teal-600 text-white text-xs px-2.5 py-1.5 rounded hover:bg-teal-500 transition-colors disabled:opacity-50 font-medium"
                >
                  Define
                </button>
              </div>
            </div>

            {/* Queried Word Entry result */}
            {vocabDefinition && (
              <div className="p-3 bg-teal-50/20 dark:bg-teal-900/5 border border-teal-500/20 rounded-lg space-y-2">
                <h4 className="font-bold text-sm text-teal-600 dark:text-teal-400 capitalize">{selectedWord}</h4>
                <div className="text-xs whitespace-pre-wrap leading-relaxed text-gray-700 dark:text-gray-300">
                  {vocabDefinition}
                </div>
                <button
                  onClick={handleSaveVocab}
                  className="w-full bg-teal-600 hover:bg-teal-500 text-white text-xs py-1.5 rounded transition-all font-medium"
                >
                  Save to Flashcards Vault
                </button>
              </div>
            )}

            {/* flashcards list */}
            <div className="space-y-2 pt-2 border-t border-gray-150 dark:border-white/5">
              <h4 className="font-semibold text-xs">Personal Flashcards Vault ({savedVocab.length})</h4>
              {savedVocab.length === 0 ? (
                <p className="text-[11px] text-gray-400 italic">Vault is currently empty. Saved words appear as flashcards here.</p>
              ) : (
                <div className="space-y-2.5">
                  {savedVocab.map((v, i) => (
                    <div
                      key={i}
                      className="p-3 bg-gray-50 dark:bg-zinc-900 border border-gray-150 dark:border-white/5 rounded-lg space-y-1"
                    >
                      <div className="flex justify-between">
                        <span className="font-bold text-xs text-teal-600 dark:text-teal-400 capitalize">{v.word}</span>
                        <button
                          onClick={() => setSavedVocab((prev) => prev.filter((_, idx) => idx !== i))}
                          className="text-[10px] text-red-500 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-400 line-clamp-2 italic mb-1">Passage context: "{v.phrase}"</p>
                      <div className="text-[11px] text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-snug pt-1 border-t border-gray-200/50 dark:border-white/5">
                        {v.definition}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ————— TAB 5: SMART COMPREHENSION QUIZ ————— */}
        {activeTab === "quiz" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-gray-150 dark:border-white/5">
              <div className="flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-teal-500" />
                <h3 className="font-semibold text-sm">Smart Study Quiz</h3>
              </div>
              <button
                onClick={handleGenerateQuiz}
                disabled={loading}
                className="text-[11px] font-medium text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-0.5"
              >
                <RefreshCcw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
                {quizQuestions.length > 0 ? "Regenerate" : "Generate Core Quiz"}
              </button>
            </div>

            {loading && (
              <div className="text-center py-10 space-y-3">
                <Brain className="w-8 h-8 text-teal-500 animate-pulse mx-auto" />
                <p className="text-xs text-gray-500">Drafting passage comprehension questions...</p>
              </div>
            )}

            {!loading && quizQuestions.length > 0 && (
              <div className="space-y-6">
                {quizQuestions[0]?.error ? (
                  <p className="text-xs text-amber-500">Could not generate questions. Verify GEMINI_API_KEY is active.</p>
                ) : (
                  quizQuestions.map((q, qIdx) => {
                    const chosen = quizAnswers[qIdx];
                    const isSubmitted = quizSubmitted[qIdx];
                    const correctIdx = q.correctIndex;

                    return (
                      <div
                        key={qIdx}
                        className="bg-gray-50 dark:bg-zinc-900 border border-gray-150 dark:border-white/5 p-4 rounded-xl space-y-3"
                      >
                        <h4 className="font-medium text-xs text-gray-800 dark:text-gray-200 leading-snug">
                          {qIdx + 1}. {q.question}
                        </h4>

                        <div className="space-y-1.5">
                          {q.options.map((opt: string, optIdx: number) => {
                            let optionStyle = "border-gray-200 dark:border-white/5 hover:bg-gray-100 dark:hover:bg-white/5";
                            
                            if (chosen === optIdx) {
                              optionStyle = "border-teal-500 bg-teal-50/10 dark:bg-teal-900/10 text-teal-600 dark:text-teal-400";
                            }
                            if (isSubmitted) {
                              if (optIdx === correctIdx) {
                                optionStyle = "border-green-500 bg-green-50/10 dark:bg-green-950/15 text-green-600 dark:text-green-400 font-semibold";
                              } else if (chosen === optIdx) {
                                optionStyle = "border-red-500 bg-red-50/10 dark:bg-red-955/15 text-red-600 dark:text-red-400";
                              } else {
                                optionStyle = "border-gray-200 dark:border-white/5 opacity-55";
                              }
                            }

                            return (
                              <button
                                key={optIdx}
                                disabled={isSubmitted}
                                onClick={() =>
                                  setQuizAnswers((prev) => ({ ...prev, [qIdx]: optIdx }))
                                }
                                className={`w-full text-left text-xs p-2.5 rounded-lg border leading-tight transition-all ${optionStyle}`}
                              >
                                {opt}
                              </button>
                            );
                          })}
                        </div>

                        {/* Submit Actions / Feedback */}
                        {!isSubmitted ? (
                          <button
                            disabled={chosen === undefined}
                            onClick={() =>
                              setQuizSubmitted((prev) => ({ ...prev, [qIdx]: true }))
                            }
                            className="bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs px-3.5 py-1.5 rounded-lg font-medium transition-colors"
                          >
                            Submit Answer
                          </button>
                        ) : (
                          <div className={`p-2.5 rounded text-[11px] leading-relaxed flex items-start gap-1.5 ${
                            chosen === correctIdx
                              ? "bg-green-500/5 border border-green-500/10 text-green-700 dark:text-green-400"
                              : "bg-red-500/5 border border-red-500/10 text-red-700 dark:text-red-400"
                          }`}>
                            {chosen === correctIdx ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                            )}
                            <div>
                              <div className="font-semibold">{chosen === correctIdx ? "Correct!" : "Incorrect Answer"}</div>
                              <p className="mt-0.5">{q.explanation}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {!loading && quizQuestions.length === 0 && (
              <div className="text-center py-10 text-gray-400 space-y-2">
                <HelpCircle className="w-10 h-10 mx-auto text-gray-300 dark:text-zinc-700 stroke-1" />
                <p className="text-xs">No active study quiz loaded yet.</p>
                <button
                  onClick={handleGenerateQuiz}
                  className="text-xs bg-teal-50 dark:bg-teal-950/20 border border-teal-200/50 text-teal-600 dark:text-teal-400 px-3 py-1.5 rounded-lg font-medium hover:bg-teal-100/50"
                >
                  Create Quiz for current Section
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
