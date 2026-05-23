/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from "react";
import {
  UploadCloud,
  FileText,
  Plus,
  BookOpen,
  Clock,
  Trash2,
  Sparkles,
  Loader2,
  RefreshCw,
  Headphones,
  X,
  ChevronRight,
  Volume2,
  Zap,
  AlertCircle,
} from "lucide-react";
import { AudioProfile, Document, TextFilterConfig } from "../types";
import { processRawText } from "../data/presets";
import { DEFAULT_KOKORO_VOICE, preloadDocumentAudio } from "../lib/audioMap";
import { motion, AnimatePresence } from "motion/react";

type PdfTextItem = {
  str: string;
  transform: number[];
  width?: number;
  hasEOL?: boolean;
};

let pdfJsPromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
      }
      return pdfjs;
    });
  }
  return pdfJsPromise;
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  return Boolean(item && typeof item === "object" && "str" in item && typeof (item as PdfTextItem).str === "string" && Array.isArray((item as PdfTextItem).transform));
}

function extractPdfLines(items: unknown[]) {
  const positionedItems = items
    .filter(isPdfTextItem)
    .map((item) => ({
      text: item.str,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      width: item.width ?? 0,
    }))
    .filter((item) => item.text.trim());

  const lines: Array<{ y: number; parts: typeof positionedItems }> = [];

  positionedItems
    .sort((left, right) => (Math.abs(right.y - left.y) > 3 ? right.y - left.y : left.x - right.x))
    .forEach((item) => {
      const existingLine = lines.find((line) => Math.abs(line.y - item.y) < 3);
      if (existingLine) {
        existingLine.parts.push(item);
        return;
      }
      lines.push({ y: item.y, parts: [item] });
    });

  return lines
    .sort((left, right) => right.y - left.y)
    .map((line) => {
      const orderedParts = [...line.parts].sort((left, right) => left.x - right.x);
      return orderedParts.reduce((accumulator, part, index) => {
        if (index === 0) return part.text;
        const previousPart = orderedParts[index - 1];
        const previousRightEdge = previousPart.x + previousPart.width;
        const needsSpace = part.x - previousRightEdge > 2 && !/^[,.;:!?)]/.test(part.text);
        return `${accumulator}${needsSpace ? " " : ""}${part.text}`;
      }, "").replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
}

interface Props {
  books: Document[];
  onSelectBook: (id: string) => void;
  onUploadBook: (book: Document) => void;
  onRemoveBook: (id: string) => void;
  onUpdateStatus: (bookId: string, status: "unprocessed" | "processing" | "ready" | "failed") => void;
  onUpdateAudioProfile: (bookId: string, audioProfile: AudioProfile | null) => void;
  textFilters: TextFilterConfig;
}

export default function LibraryView({ books, onSelectBook, onUploadBook, onRemoveBook, onUpdateStatus, onUpdateAudioProfile, textFilters }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [showPasteForm, setShowPasteForm] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customAuthor, setCustomAuthor] = useState("");
  const [customText, setCustomText] = useState("");
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [synthesisProgress, setSynthesisProgress] = useState<Record<string, { step: string; pct: number }>>({});

  const handleTriggerSynthesis = async (bookId: string) => {
    const book = books.find((item) => item.id === bookId);
    if (!book) return;

    onUpdateStatus(bookId, "processing");
    setSynthesisProgress((prev) => ({
      ...prev,
      [bookId]: { step: "Preparing narration cache...", pct: 2 },
    }));

    try {
      const result = await preloadDocumentAudio({
        document: book,
        voiceId: DEFAULT_KOKORO_VOICE,
        textFilters,
        onProgress: ({ pct, step }) => {
          setSynthesisProgress((prev) => ({
            ...prev,
            [bookId]: { step, pct },
          }));
        },
      });

      onUpdateAudioProfile(bookId, {
        voiceId: result.voiceId,
        generatedAt: new Date().toISOString(),
        segmentCount: result.segmentCount,
          textFilterKey: result.textFilterKey,
      });
      onUpdateStatus(bookId, "ready");
    } catch (err: any) {
      console.error("Whole-book preload failed:", err);
      onUpdateStatus(bookId, "failed");
    } finally {
      setSynthesisProgress((prev) => {
        const next = { ...prev };
        delete next[bookId];
        return next;
      });
    }
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await handleFileLoad(files[0]);
    }
  }, []);

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await handleFileLoad(files[0]);
    }
  }, []);

  const handleFileLoad = async (file: File) => {
    setUploadProgress(`Processing "${file.name}"...`);
    try {
      if (file.type === "text/plain" || file.name.endsWith(".txt") || file.name.endsWith(".md") || file.type === "text/markdown") {
        const text = await file.text();
        const cleanTitle = file.name.replace(/\.[^/.]+$/, "");
        const newBook = processRawText(cleanTitle, "Local File Import", text);
        newBook.processingStatus = "unprocessed";
        onUploadBook(newBook);
        setUploadProgress(null);
      } else if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
        const text = await parsePDFFallback(file);
        const cleanTitle = file.name.replace(/\.[^/.]+$/, "");
        const newBook = processRawText(cleanTitle, "PDF Research Scan", text);
        newBook.processingStatus = "unprocessed";
        onUploadBook(newBook);
        setUploadProgress(null);
      } else {
        alert("Unsupported file type! Please drop .txt, .md, or .pdf files.");
        setUploadProgress(null);
      }
    } catch (err: any) {
      console.error(err);
      setUploadProgress(`Error: ${err.message}`);
      setTimeout(() => setUploadProgress(null), 3000);
    }
  };

  const parsePDFFallback = async (file: File): Promise<string> => {
    const pdfjs = await loadPdfJs();
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      useWorkerFetch: false,
    });

    const pdf = await loadingTask.promise;
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setUploadProgress(`Extracting text from "${file.name}" (page ${pageNumber} of ${pdf.numPages})...`);
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const lines = extractPdfLines(textContent.items as unknown[]);
      if (lines.length > 0) {
        pageTexts.push(lines.join("\n"));
      }
    }

    const text = pageTexts
      .join("\n\n")
      .replace(/-\n(?=[a-z])/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!text) {
      throw new Error("This PDF does not contain readable text. Scanned image PDFs are not supported yet.");
    }
    return text;
  };

  const handlePasteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTitle.trim() || !customText.trim()) return;
    const author = customAuthor.trim() || "Dynamic Paste Import";
    const newBook = processRawText(customTitle, author, customText);
    newBook.processingStatus = "unprocessed";
    onUploadBook(newBook);
    setCustomTitle("");
    setCustomAuthor("");
    setCustomText("");
    setShowPasteForm(false);
  };

  // Refined cover palette — no AI slop colors
  const COVER_PALETTES = [
    { bg: "#C4A882", text: "#3D2E1E", accent: "#8B7355" },      // Warm sand
    { bg: "#6B8E6B", text: "#1A2E1A", accent: "#4A6B4A" },      // Forest moss
    { bg: "#8B7D7B", text: "#2A2220", accent: "#6B5D5B" },      // Warm slate
    { bg: "#B8907A", text: "#3D2820", accent: "#9A7060" },      // Terracotta clay
    { bg: "#7A8B9A", text: "#1E2830", accent: "#5A6B7A" },      // Cool stone
    { bg: "#A89080", text: "#2E2420", accent: "#8A7060" },      // Taupe
    { bg: "#6B7B6B", text: "#1A221A", accent: "#4A5A4A" },      // Sage
    { bg: "#9A8A7A", text: "#2A221A", accent: "#7A6A5A" },      // Driftwood
  ];

  const getCoverPalette = (title: string) => {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = ((hash << 5) - hash) + title.charCodeAt(i);
      hash |= 0;
    }
    return COVER_PALETTES[Math.abs(hash) % COVER_PALETTES.length];
  };

  const renderCover = (book: Document) => {
    const palette = getCoverPalette(book.title);
    const initials = book.title.substring(0, 2).toUpperCase();
    const audioStatus = book.processingStatus || "unprocessed";

    return (
      <div
        className="w-full aspect-[3/4] rounded-xl flex flex-col justify-between p-4 flex-shrink-0 relative overflow-hidden group-hover:shadow-lg transition-all duration-500"
        style={{ backgroundColor: palette.bg, color: palette.text }}
      >
        <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-10 -mr-10 -mt-10"
          style={{ backgroundColor: palette.accent }} />
        <div className="absolute bottom-0 left-0 w-20 h-20 rounded-full opacity-10 -ml-6 -mb-6"
          style={{ backgroundColor: palette.accent }} />

        <div className="flex justify-between items-start select-none z-10">
          <span className="text-[9px] uppercase tracking-[0.15em] font-mono opacity-50 font-medium">
            Lumen
          </span>
          <StatusBadge status={audioStatus} />
        </div>

        <div className="space-y-1 z-10">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-serif font-bold mb-3"
            style={{ backgroundColor: `${palette.accent}30`, color: palette.text }}
          >
            {initials}
          </div>
          <h4 className="font-serif font-bold text-base leading-tight line-clamp-3">{book.title}</h4>
          <p className="text-[11px] opacity-70 font-sans truncate">{book.author}</p>
        </div>

        <div className="flex justify-between items-center text-[10px] font-mono border-t opacity-40 pt-2 z-10"
          style={{ borderColor: palette.accent }}>
          <span>{book.wordCount.toLocaleString()} words</span>
          <span>{book.durationMinutes}m</span>
        </div>
      </div>
    );
  };

  const StatusBadge = ({ status }: { status: string }) => {
    if (status === "unprocessed") {
      return (
        <span className="px-2 py-0.5 rounded-full text-[8px] font-medium bg-black/10 backdrop-blur-sm">
          Text
        </span>
      );
    }
    if (status === "processing") {
      return (
        <span className="px-2 py-0.5 rounded-full text-[8px] font-medium bg-black/10 backdrop-blur-sm animate-pulse flex items-center gap-1">
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
          Syncing
        </span>
      );
    }
    if (status === "failed") {
      return (
        <span className="px-2 py-0.5 rounded-full text-[8px] font-medium bg-red-900/20 text-red-900 backdrop-blur-sm flex items-center gap-1">
          <AlertCircle className="w-2.5 h-2.5" />
          Retry
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-[8px] font-medium bg-black/10 backdrop-blur-sm flex items-center gap-1">
        <Zap className="w-2.5 h-2.5" />
        Ready
      </span>
    );
  };

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative pt-16 pb-12 px-4 sm:px-6 lg:px-8 overflow-hidden">
        <div className="max-w-5xl mx-auto text-center relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium mb-6 border"
              style={{
                backgroundColor: "var(--accent-subtle)",
                borderColor: "var(--accent-border)",
                color: "var(--accent)"
              }}>
              <Headphones className="w-3 h-3" />
              Text-to-Speech Library
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.4, 0, 0.2, 1] }}
            className="text-4xl sm:text-5xl lg:text-6xl font-serif font-bold tracking-tight mb-5"
            style={{ color: "var(--ink-primary)" }}
          >
            Your personal
            <br />
            <span style={{ color: "var(--accent)" }}>reading sanctuary</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="text-base sm:text-lg max-w-xl mx-auto leading-relaxed"
            style={{ color: "var(--ink-secondary)" }}
          >
            Drop in papers, novels, or text clippings. Lumen builds beautiful narrated experiences for focused reading and listening.
          </motion.p>
        </div>
      </section>

      {/* Upload Zone */}
      <section className="px-4 sm:px-6 lg:px-8 pb-16">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* Main Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className="relative rounded-2xl border-2 border-dashed transition-all duration-300 overflow-hidden"
              style={{
                borderColor: dragOver ? "var(--accent)" : "var(--border-strong)",
                backgroundColor: dragOver ? "var(--accent-subtle)" : "var(--surface-elevated)",
                transform: dragOver ? "scale(1.01)" : "scale(1)",
              }}
            >
              <input
                type="file"
                id="file-ingest"
                accept=".txt,.pdf,.md"
                onChange={handleFileInputChange}
                className="absolute inset-0 opacity-0 cursor-pointer z-20"
              />

              <div className="py-12 px-6 text-center">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 transition-all duration-300"
                  style={{
                    backgroundColor: dragOver ? "var(--accent)" : "var(--accent-subtle)",
                    color: dragOver ? "#fff" : "var(--accent)",
                  }}
                >
                  <UploadCloud className="w-7 h-7" />
                </div>
                <h3 className="font-semibold text-base mb-1" style={{ color: "var(--ink-primary)" }}>
                  {dragOver ? "Drop your file here" : "Drag & drop your files"}
                </h3>
                <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
                  Supports .txt, .md, and .pdf documents
                </p>

                {/* Divider with "or" */}
                <div className="flex items-center gap-4 my-6 max-w-xs mx-auto">
                  <div className="flex-1 h-px" style={{ backgroundColor: "var(--border-default)" }} />
                  <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>or</span>
                  <div className="flex-1 h-px" style={{ backgroundColor: "var(--border-default)" }} />
                </div>

                {/* Paste button */}
                <button
                  onClick={() => setShowPasteForm(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border"
                  style={{
                    backgroundColor: "var(--surface-page)",
                    borderColor: "var(--border-strong)",
                    color: "var(--ink-primary)",
                  }}
                >
                  <FileText className="w-4 h-4" style={{ color: "var(--accent)" }} />
                  Paste text directly
                  <ChevronRight className="w-3.5 h-3.5" style={{ color: "var(--ink-muted)" }} />
                </button>
              </div>

              {/* Upload progress overlay */}
              <AnimatePresence>
                {uploadProgress && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-30 flex items-center justify-center backdrop-blur-md"
                    style={{ backgroundColor: "var(--surface-elevated)", opacity: 0.97 }}
                  >
                    <div className="text-center space-y-3">
                      <div className="relative">
                        <div className="w-10 h-10 rounded-full border-2 animate-spin"
                          style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                      </div>
                      <p className="text-sm font-medium" style={{ color: "var(--ink-primary)" }}>
                        {uploadProgress}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Paste Form Modal */}
      <AnimatePresence>
        {showPasteForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
            onClick={() => setShowPasteForm(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="w-full max-w-lg rounded-2xl p-6 shadow-2xl"
              style={{ backgroundColor: "var(--surface-elevated)", border: "1px solid var(--border-default)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-semibold text-base" style={{ color: "var(--ink-primary)" }}>
                  Add text clipping
                </h3>
                <button
                  onClick={() => setShowPasteForm(false)}
                  className="p-1.5 rounded-lg transition-colors"
                  style={{ color: "var(--ink-muted)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--surface-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handlePasteSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-medium uppercase tracking-wider mb-1.5 block" style={{ color: "var(--ink-muted)" }}>
                      Title *
                    </label>
                    <input
                      type="text"
                      placeholder="Article or book title"
                      required
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl text-sm border transition-all focus:outline-none"
                      style={{
                        backgroundColor: "var(--surface-page)",
                        borderColor: "var(--border-strong)",
                        color: "var(--ink-primary)",
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium uppercase tracking-wider mb-1.5 block" style={{ color: "var(--ink-muted)" }}>
                      Author
                    </label>
                    <input
                      type="text"
                      placeholder="Optional"
                      value={customAuthor}
                      onChange={(e) => setCustomAuthor(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl text-sm border transition-all focus:outline-none"
                      style={{
                        backgroundColor: "var(--surface-page)",
                        borderColor: "var(--border-strong)",
                        color: "var(--ink-primary)",
                      }}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wider mb-1.5 block" style={{ color: "var(--ink-muted)" }}>
                    Content *
                  </label>
                  <textarea
                    placeholder="Paste your text here..."
                    required
                    rows={6}
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm border transition-all focus:outline-none resize-none"
                    style={{
                      backgroundColor: "var(--surface-page)",
                      borderColor: "var(--border-strong)",
                      color: "var(--ink-primary)",
                    }}
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowPasteForm(false)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all"
                    style={{
                      backgroundColor: "transparent",
                      borderColor: "var(--border-strong)",
                      color: "var(--ink-secondary)",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all flex items-center justify-center gap-2"
                    style={{ backgroundColor: "var(--accent)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--accent-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--accent)")}
                  >
                    <Plus className="w-4 h-4" />
                    Add to Library
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Library Shelf */}
      <section className="px-4 sm:px-6 lg:px-8 pb-24">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="flex items-center justify-between mb-8"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
              >
                <BookOpen className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-semibold text-lg" style={{ color: "var(--ink-primary)" }}>
                  Library
                </h2>
                <p className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
                  {books.length} {books.length === 1 ? "book" : "books"}
                </p>
              </div>
            </div>
          </motion.div>

          {books.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="rounded-2xl border border-dashed py-20 text-center"
              style={{ borderColor: "var(--border-strong)", backgroundColor: "var(--surface-elevated)" }}
            >
              <BookOpen className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--ink-muted)", opacity: 0.5 }} />
              <p className="text-sm font-medium mb-1" style={{ color: "var(--ink-secondary)" }}>
                Your library is empty
              </p>
              <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                Drop a file above or paste text to get started
              </p>
            </motion.div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
              {books.map((book, index) => {
                const totalItems = book.paragraphs.length;
                const progressIdx = book.progress.paragraphIndex || 0;
                const percent = totalItems > 0 ? Math.round((progressIdx / totalItems) * 100) : 0;
                const audioStatus = book.processingStatus || "unprocessed";

                return (
                  <motion.div
                    key={book.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.05 * Math.min(index, 10), ease: [0.4, 0, 0.2, 1] }}
                    className="group"
                  >
                    <div
                      className="rounded-2xl p-2.5 transition-all duration-300 cursor-pointer"
                      style={{
                        backgroundColor: "var(--surface-elevated)",
                        border: `1px solid var(--border-default)`,
                        boxShadow: `0 1px 3px var(--shadow-color)`,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "var(--border-strong)";
                        e.currentTarget.style.transform = "translateY(-3px)";
                        e.currentTarget.style.boxShadow = `0 8px 24px var(--shadow-elevated)`;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "var(--border-default)";
                        e.currentTarget.style.transform = "translateY(0)";
                        e.currentTarget.style.boxShadow = `0 1px 3px var(--shadow-color)`;
                      }}
                      onClick={() => {
                        if (audioStatus === "processing") return;
                        onSelectBook(book.id);
                      }}
                    >
                      {renderCover(book)}

                      <div className="mt-3 space-y-2.5 px-1">
                        {/* Progress */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="flex items-center gap-1 font-medium" style={{ color: "var(--ink-muted)" }}>
                              <Clock className="w-3 h-3" />
                              {book.durationMinutes} min
                            </span>
                            <span className="font-mono font-medium" style={{ color: "var(--ink-muted)" }}>
                              {percent}%
                            </span>
                          </div>
                          <div className="w-full h-1 rounded-full overflow-hidden" style={{ backgroundColor: "var(--surface-hover)" }}>
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${percent}%`,
                                backgroundColor: "var(--accent)",
                                opacity: percent > 0 ? 1 : 0.3,
                              }}
                            />
                          </div>
                        </div>

                        {/* Audio actions */}
                        {audioStatus === "unprocessed" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTriggerSynthesis(book.id);
                            }}
                            className="w-full py-2 px-3 rounded-xl text-[11px] font-semibold transition-all duration-200 flex items-center justify-center gap-1.5"
                            style={{
                              backgroundColor: "var(--accent-subtle)",
                              color: "var(--accent)",
                              border: `1px solid var(--accent-border)`,
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = "var(--accent)";
                              e.currentTarget.style.color = "#fff";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = "var(--accent-subtle)";
                              e.currentTarget.style.color = "var(--accent)";
                            }}
                          >
                            <Volume2 className="w-3 h-3" />
                            Generate Audio
                          </button>
                        )}

                        {audioStatus === "failed" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTriggerSynthesis(book.id);
                            }}
                            className="w-full py-2 px-3 rounded-xl text-[11px] font-semibold transition-all duration-200 flex items-center justify-center gap-1.5"
                            style={{
                              backgroundColor: "rgba(184, 84, 80, 0.08)",
                              color: "var(--status-failed)",
                              border: "1px solid rgba(184, 84, 80, 0.2)",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = "var(--status-failed)";
                              e.currentTarget.style.color = "#fff";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = "rgba(184, 84, 80, 0.08)";
                              e.currentTarget.style.color = "var(--status-failed)";
                            }}
                          >
                            <AlertCircle className="w-3 h-3" />
                            Retry Audio
                          </button>
                        )}

                        {audioStatus === "ready" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTriggerSynthesis(book.id);
                            }}
                            className="w-full py-2 px-3 rounded-xl text-[11px] font-semibold transition-all duration-200 flex items-center justify-center gap-1.5 border"
                            style={{
                              backgroundColor: "transparent",
                              borderColor: "var(--border-default)",
                              color: "var(--ink-secondary)",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = "var(--surface-hover)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = "transparent";
                            }}
                          >
                            <RefreshCw className="w-3 h-3" />
                            Rebuild Audio
                          </button>
                        )}

                        {audioStatus === "processing" && (
                          <div
                            className="py-2 px-3 rounded-xl space-y-1"
                            style={{
                              backgroundColor: "var(--accent-subtle)",
                              border: `1px solid var(--accent-border)`,
                            }}
                          >
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: "var(--accent)" }}>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>{synthesisProgress[book.id]?.pct || 0}% complete</span>
                            </div>
                            <p className="text-[9px] font-mono truncate" style={{ color: "var(--ink-muted)" }}>
                              {synthesisProgress[book.id]?.step || "In queue..."}
                            </p>
                          </div>
                        )}

                        {/* Bottom row: open + delete */}
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[10px] font-semibold flex items-center gap-1" style={{ color: "var(--accent)" }}>
                            <BookOpen className="w-3 h-3" />
                            {audioStatus === "ready" ? "Read & Listen" : "Read"}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm("Archive this book from your library?")) {
                                onRemoveBook(book.id);
                              }
                            }}
                            className="p-1.5 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                            style={{ color: "var(--ink-muted)" }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = "rgba(184, 84, 80, 0.08)";
                              e.currentTarget.style.color = "var(--status-failed)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = "transparent";
                              e.currentTarget.style.color = "var(--ink-muted)";
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
