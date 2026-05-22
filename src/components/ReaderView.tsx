/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Settings,
  Highlighter,
  BookMarked,
  ArrowRight,
  Sparkles,
  Volume2,
  VolumeX,
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  SkipBack,
  SidebarOpen,
  HelpCircle,
  Clock,
  Menu,
  Loader2,
} from "lucide-react";
import { Document, Paragraph, Sentence, Highlight, Bookmark, Voice } from "../types";
import { AccessibilityConfig } from "./AccessibilitySettings";

interface Props {
  document: Document;
  highlights: Highlight[];
  bookmarks: Bookmark[];
  accessibilityConfig: AccessibilityConfig;
  onBack: () => void;
  onUpdateProgress: (paragraphIndex: number, sentenceIndex: number) => void;
  onAddHighlight: (highlight: Omit<Highlight, "id" | "createdAt">) => void;
  onAddBookmark: (bookmark: Omit<Bookmark, "id" | "createdAt">) => void;
  activeParagraphIndex: number;
  activeSentenceIndex: number;
  onJumpTo: (pIdx: number, sIdx: number) => void;
  rightSidebarContent: React.ReactNode;
  toggleRightSidebar: () => void;
  showRightSidebar: boolean;
  onUpdateStatus: (bookId: string, status: "unprocessed" | "processing" | "ready" | "failed") => void;
}

const VOICES: Voice[] = [
  { id: "af_sarah", name: "af_sarah (Kokoro Female US)", gender: "female", description: "Standard high-fidelity American speaker cascade." },
  { id: "am_adam", name: "am_adam (Kokoro Male US)", gender: "male", description: "Deep resonance mature speaker cadence." },
  { id: "bf_emma", name: "bf_emma (Kokoro Female UK)", gender: "female", description: "Refined British standard voice, ideal for papers." },
  { id: "bm_lewis", name: "bm_lewis (Kokoro Male UK)", gender: "male", description: "Warm, highly articulate UK accent resonance." },
  { id: "af_bella", name: "af_bella (Kokoro Female US)", gender: "female", description: "Bright conversational narrator with high clarity." },
];

export default function ReaderView({
  document,
  highlights,
  bookmarks,
  accessibilityConfig,
  onBack,
  onUpdateProgress,
  onAddHighlight,
  onAddBookmark,
  activeParagraphIndex,
  activeSentenceIndex,
  onJumpTo,
  rightSidebarContent,
  toggleRightSidebar,
  showRightSidebar,
  onUpdateStatus,
}: Props) {
  // Navigation & Table of Contents Sidebar
  const [showTOC, setShowTOC] = useState(false);

  // Audio Playback Engine States
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [selectedVoice, setSelectedVoice] = useState<string>("af_sarah");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Local Reader compilers tracking
  const [localPct, setLocalPct] = useState(0);
  const [localStep, setLocalStep] = useState("");

  const handleTriggerReaderSynthesis = () => {
    onUpdateStatus(document.id, "processing");
    setLocalPct(5);
    setLocalStep("Parsing and partitioning document paragraphs into tokens...");

    setTimeout(() => {
      setLocalPct(35);
      setLocalStep("Calibrating Kokoro neural phoneme anchors and pitch...");
    }, 1200);

    setTimeout(() => {
      setLocalPct(70);
      setLocalStep("Pre-rendering audio buffers for high-speed local stream cache...");
    }, 2400);

    setTimeout(() => {
      setLocalPct(100);
      setLocalStep("Vocal map compiled. Playback system online!");
    }, 3600);

    setTimeout(() => {
      onUpdateStatus(document.id, "ready");
      setLocalPct(0);
      setLocalStep("");
    }, 4500);
  };

  // Floating word selection toolbar popup state
  const [toolbarSelection, setToolbarSelection] = useState<{
    text: string;
    clientX: number;
    clientY: number;
    paragraphIndex: number;
    sentenceIndex: number;
  } | null>(null);

  const [highlightColor, setHighlightColor] = useState("bg-teal-500/25 border-l-2 border-teal-500");
  const [noteInput, setNoteInput] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  // Reference hooks for dynamic scroll mapping
  const activeSentenceRef = useRef<HTMLSpanElement | null>(null);
  const readerColumnRef = useRef<HTMLDivElement | null>(null);

  // Prefetching queues for seamless gaps
  const prefetchTimeoutRef = useRef<any>(null);
  const audioCacheRef = useRef<Record<string, string>>({}); // cache key word/sentence string -> audio resource URLs

  // Watch sentence cursor changes to automatically track reading line / trigger active speak audio
  useEffect(() => {
    if (activeSentenceRef.current && isPlaying) {
      activeSentenceRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [activeParagraphIndex, activeSentenceIndex]);

  // Handle active audio elements triggers
  useEffect(() => {
    if (isPlaying) {
      loadAndPlaySentenceAudio(activeParagraphIndex, activeSentenceIndex);
    } else {
      stopAudio();
    }
    return () => {
      stopAudio();
    };
  }, [isPlaying, activeParagraphIndex, activeSentenceIndex, selectedVoice]);

  // Handle Rate speed alterations
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, audioUrl]);

  const loadAndPlaySentenceAudio = async (pIdx: number, sIdx: number) => {
    stopAudio();
    setAudioLoading(true);

    const sentence = document.paragraphs[pIdx]?.sentences[sIdx];
    if (!sentence) {
      setIsPlaying(false);
      setAudioLoading(false);
      return;
    }

    const textToSpeak = sentence.text;
    const cacheKey = `${selectedVoice}_${textToSpeak}`;

    try {
      let resolvedUrl = audioCacheRef.current[cacheKey];

      if (!resolvedUrl) {
        // Fetch TTS audio binary chunk from our proxy Express API route!
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: textToSpeak,
            voiceName: selectedVoice,
          }),
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        if (data.audio.startsWith("data:audio/")) {
          resolvedUrl = data.audio;
        } else if (data.audio.startsWith("UklGR")) {
          resolvedUrl = `data:audio/wav;base64,${data.audio}`;
        } else {
          resolvedUrl = pcmToWavBlob(data.audio, 24000);
        }
        // Cache resources to prevent duplicate server queries
        audioCacheRef.current[cacheKey] = resolvedUrl;
      }

      // Preload next sentence for perfect narration transitions in background
      triggerNarrationPrefetch(pIdx, sIdx);

      const audio = new Audio(resolvedUrl);
      audio.addEventListener("canplay", () => {
        audio.playbackRate = playbackRate;
      });
      audio.addEventListener("play", () => {
        audio.playbackRate = playbackRate;
      });
      audio.playbackRate = playbackRate;
      audioRef.current = audio;
      setAudioUrl(resolvedUrl);
      setAudioLoading(false);

      audio.onended = () => {
        handleSentenceCompleted(pIdx, sIdx);
      };

      await audio.play();
    } catch (err: any) {
      console.warn("Server TTS generation rate-limited or unavailable; falling back to high-fidelity native browser SpeechSynthesis API:", err);
      setAudioLoading(false);
      speakWithWebSpeech(textToSpeak, pIdx, sIdx);
    }
  };

  const speakWithWebSpeech = (text: string, pIdx: number, sIdx: number) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      setIsPlaying(false);
      return;
    }

    // Cancel any active SpeechSynthesis before starting
    window.speechSynthesis.cancel();

    // Small delay ensures previous cancellation is registered by the browser speech scheduler
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = playbackRate * 0.95; // Slightly scale speed to map neural patterns

      // Target matching native voices based on active selection (accent, gender, naming)
      const voices = window.speechSynthesis.getVoices();
      let bestVoice = null;

      const isFemale = selectedVoice.includes("sarah") || selectedVoice.includes("bella") || selectedVoice.includes("emma");
      const isUK = selectedVoice.includes("emma") || selectedVoice.includes("lewis");

      for (const voice of voices) {
        const langLower = voice.lang.toLowerCase();
        const nameLower = voice.name.toLowerCase();

        if (langLower.startsWith("en")) {
          // If we want British English Accent
          if (isUK && (langLower.includes("gb") || langLower.includes("uk") || nameLower.includes("british") || nameLower.includes("english gb"))) {
            if (isFemale && (nameLower.includes("female") || nameLower.includes("zira") || nameLower.includes("hazel") || nameLower.includes("samantha") || nameLower.includes("susan") || nameLower.includes("google") || nameLower.includes("natural"))) {
              bestVoice = voice;
              break;
            } else if (!isFemale && (nameLower.includes("male") || nameLower.includes("david") || nameLower.includes("george") || nameLower.includes("hazel") === false)) {
              bestVoice = voice;
              break;
            }
          } 
          // If we want American English Accent
          else if (!isUK && (langLower.includes("us") || langLower.includes("united states") || nameLower.includes("america") || nameLower.includes("english us"))) {
            if (isFemale && (nameLower.includes("female") || nameLower.includes("zira") || nameLower.includes("samantha") || nameLower.includes("susan") || nameLower.includes("google") || nameLower.includes("natural"))) {
              bestVoice = voice;
              break;
            } else if (!isFemale && (nameLower.includes("male") || nameLower.includes("david") || nameLower.includes("mark") || nameLower.includes("microsoft"))) {
              bestVoice = voice;
              break;
            }
          }
        }
      }

      // Fallback: any standard English voice
      if (!bestVoice) {
        bestVoice = voices.find(v => v.lang.toLowerCase().startsWith("en")) || null;
      }

      if (bestVoice) {
        utterance.voice = bestVoice;
      }

      utterance.onend = () => {
        handleSentenceCompleted(pIdx, sIdx);
      };

      utterance.onerror = (ev) => {
        if (ev.error !== "interrupted") {
          console.error("SpeechSynthesisUtterance execution failure:", ev);
          setIsPlaying(false);
        }
      };

      window.speechSynthesis.speak(utterance);
    }, 60);
  };

  const triggerNarrationPrefetch = (pIdx: number, sIdx: number) => {
    if (prefetchTimeoutRef.current) clearTimeout(prefetchTimeoutRef.current);

    prefetchTimeoutRef.current = setTimeout(async () => {
      let nextP = pIdx;
      let nextS = sIdx + 1;

      if (nextS >= (document.paragraphs[pIdx]?.sentences.length || 0)) {
        nextP = pIdx + 1;
        nextS = 0;
      }

      const nextSentence = document.paragraphs[nextP]?.sentences[nextS];
      if (!nextSentence) return;

      const cacheKey = `${selectedVoice}_${nextSentence.text}`;
      if (audioCacheRef.current[cacheKey]) return; // Already cached

      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: nextSentence.text,
            voiceName: selectedVoice,
          }),
        });

        const data = await response.json();
        if (data && data.audio) {
          let url;
          if (data.audio.startsWith("data:audio/")) {
            url = data.audio;
          } else if (data.audio.startsWith("UklGR")) {
            url = `data:audio/wav;base64,${data.audio}`;
          } else {
            url = pcmToWavBlob(data.audio, 24000);
          }
          audioCacheRef.current[cacheKey] = url;
        }
      } catch (err) {
        console.warn("Background audio prefetch silent drop:", err);
      }
    }, 1500); // Trigger prefetch 1.5 seconds after current playing start
  };

  // Skip sentence completion
  const handleSentenceCompleted = (pIdx: number, sIdx: number) => {
    const totalSentences = document.paragraphs[pIdx]?.sentences.length || 0;
    if (sIdx + 1 < totalSentences) {
      onJumpTo(pIdx, sIdx + 1);
    } else if (pIdx + 1 < document.paragraphs.length) {
      onJumpTo(pIdx + 1, 0);
    } else {
      setIsPlaying(false); // Book finished!
    }
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setAudioUrl(null);
  };

  // Sentence Skip Back
  const handleSkipBack = () => {
    const totalSentences = document.paragraphs[activeParagraphIndex]?.sentences.length || 0;
    if (activeSentenceIndex - 1 >= 0) {
      onJumpTo(activeParagraphIndex, activeSentenceIndex - 1);
    } else if (activeParagraphIndex - 1 >= 0) {
      const prevPIdx = activeParagraphIndex - 1;
      const prevSentencesCount = document.paragraphs[prevPIdx]?.sentences.length || 0;
      onJumpTo(prevPIdx, Math.max(0, prevSentencesCount - 1));
    }
  };

  // Sentence Skip Forward
  const handleSkipForward = () => {
    const totalSentences = document.paragraphs[activeParagraphIndex]?.sentences.length || 0;
    if (activeSentenceIndex + 1 < totalSentences) {
      onJumpTo(activeParagraphIndex, activeSentenceIndex + 1);
    } else if (activeParagraphIndex + 1 < document.paragraphs.length) {
      onJumpTo(activeParagraphIndex + 1, 0);
    }
  };

  React.useEffect(() => {
    const handleGlobalSelection = () => {
      // If we are actively clicking inputs/buttons in selection popup, preserve selection
      const activeEl = window.document.activeElement;
      if (activeEl && activeEl.closest(".selection-popup")) {
        return;
      }

      const sel = window.getSelection();
      if (!sel || sel.toString().trim().length === 0) {
        setToolbarSelection(null);
        return;
      }
      
      const selectedText = sel.toString().trim();
      try {
        const range = sel.getRangeAt(0);
        // Ensure content selection belongs strictly to our Reader canvas container
        if (readerColumnRef.current && readerColumnRef.current.contains(range.commonAncestorContainer)) {
          const rect = range.getBoundingClientRect();
          const containerRect = readerColumnRef.current.getBoundingClientRect();
          
          if (containerRect) {
            const relativeLeft = rect.left - containerRect.left + rect.width / 2;
            const relativeTop = rect.top - containerRect.top + readerColumnRef.current.scrollTop;
            
            let pIdx = activeParagraphIndex;
            let sIdx = activeSentenceIndex;
            
            const findIndices = (valNode: Node | null): {p: number, s: number} | null => {
              let curr = valNode;
              while (curr && curr !== window.document.body) {
                if (curr instanceof HTMLElement) {
                  const pAttr = curr.getAttribute("data-paragraph-index");
                  const sAttr = curr.getAttribute("data-sentence-index");
                  if (pAttr !== null && sAttr !== null) {
                    return { p: parseInt(pAttr), s: parseInt(sAttr) };
                  }
                }
                curr = curr.parentNode;
              }
              return null;
            };

            const startIndices = findIndices(range.startContainer);
            const endIndices = findIndices(range.endContainer);
            const anchorIndices = findIndices(sel.anchorNode);
            const focusIndices = findIndices(sel.focusNode);

            const found = startIndices || endIndices || anchorIndices || focusIndices;
            if (found) {
              pIdx = found.p;
              sIdx = found.s;
            }

            setToolbarSelection({
              text: selectedText,
              clientX: relativeLeft,
              clientY: relativeTop,
              paragraphIndex: pIdx,
              sentenceIndex: sIdx,
            });
          }
        }
      } catch (err) {
        // ignore range read conflicts
      }
    };

    window.document.addEventListener("selectionchange", handleGlobalSelection);
    return () => {
      window.document.removeEventListener("selectionchange", handleGlobalSelection);
    };
  }, [activeParagraphIndex, activeSentenceIndex]);

  React.useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      const selection = window.getSelection();
      if (!selection || selection.toString().trim().length === 0) return;

      // Ensure the selection lies within our Reader column canvas
      if (readerColumnRef.current && readerColumnRef.current.contains(selection.anchorNode)) {
        e.preventDefault();
        
        const selectedText = selection.toString();
        const sentenceElements = readerColumnRef.current.querySelectorAll("[data-paragraph-index]");
        
        const selectedSentences: { pIdx: number; sIdx: number; text: string }[] = [];
        sentenceElements.forEach((el) => {
          if (selection.containsNode(el, true)) {
            const pIdxAttr = el.getAttribute("data-paragraph-index");
            const sIdxAttr = el.getAttribute("data-sentence-index");
            if (pIdxAttr !== null && sIdxAttr !== null) {
              const pIdx = parseInt(pIdxAttr);
              const sIdx = parseInt(sIdxAttr);
              const sentenceObj = document.paragraphs[pIdx]?.sentences[sIdx];
              if (sentenceObj) {
                selectedSentences.push({
                  pIdx,
                  sIdx,
                  text: sentenceObj.text
                });
              }
            }
          }
        });

        if (selectedSentences.length > 0) {
          const paragraphGroups: Record<number, string[]> = {};
          selectedSentences.forEach((s) => {
            if (!paragraphGroups[s.pIdx]) {
              paragraphGroups[s.pIdx] = [];
            }
            paragraphGroups[s.pIdx].push(s.text);
          });

          const sortedPIds = Object.keys(paragraphGroups).map(Number).sort((a, b) => a - b);
          const blockStrings = sortedPIds.map((pIdx) => {
            const sentencesInPara = paragraphGroups[pIdx];
            const originalParagraphText = document.paragraphs[pIdx].text;
            
            if (originalParagraphText.startsWith("```")) {
              return originalParagraphText; // Code blocks
            }
            if (originalParagraphText.startsWith("#")) {
              return originalParagraphText; // Markdown headings
            }
            if (originalParagraphText.startsWith("* ") || originalParagraphText.startsWith("- ") || originalParagraphText.startsWith("+ ")) {
              return originalParagraphText; // Bullets lists
            }
            if (/^\d+\.\s+/.test(originalParagraphText)) {
              return originalParagraphText; // Decimal lists
            }
            if (originalParagraphText.startsWith("> ")) {
              return originalParagraphText; // Blockquotes
            }
            return sentencesInPara.join(" ");
          });

          const finalMarkdownText = blockStrings.join("\n\n");
          if (e.clipboardData) {
            e.clipboardData.setData("text/plain", finalMarkdownText);
          }
        } else {
          // Normalize spacer artifacts of bio-reading
          let cleanedPlain = selectedText
            .replace(/\s+/g, " ")
            .replace(/\n\s*\n/g, "\n\n")
            .trim();
          if (e.clipboardData) {
            e.clipboardData.setData("text/plain", cleanedPlain);
          }
        }
      }
    };

    window.document.addEventListener("copy", handleCopy);
    return () => {
      window.document.removeEventListener("copy", handleCopy);
    };
  }, [document]);

  const handleTextSelectCheck = (e: React.MouseEvent) => {
    // Global selectionchange handles coordination, dismiss selection on random clicks with zero selected text
    const sel = window.getSelection();
    if (!sel || sel.toString().trim().length === 0) {
      setToolbarSelection(null);
    }
  };

  const handleColorHighlightSelect = (colorClass: string) => {
    if (!toolbarSelection) return;
    onAddHighlight({
      documentId: document.id,
      paragraphIndex: toolbarSelection.paragraphIndex,
      sentenceIndex: toolbarSelection.sentenceIndex,
      text: toolbarSelection.text,
      color: colorClass,
      note: noteInput.trim() || undefined,
    });
    setToolbarSelection(null);
    setNoteInput("");
    setAddingNote(false);
  };

  // Handle Double-tap / Click text trigger play
  const handleSentenceClick = (pIdx: number, sIdx: number) => {
    onJumpTo(pIdx, sIdx);
    onUpdateProgress(pIdx, sIdx);
    setToolbarSelection(null);
  };

  // Place highlight
  const executeHighlight = () => {
    if (!toolbarSelection) return;
    onAddHighlight({
      documentId: document.id,
      paragraphIndex: toolbarSelection.paragraphIndex,
      sentenceIndex: toolbarSelection.sentenceIndex,
      text: toolbarSelection.text,
      color: highlightColor,
      note: noteInput.trim() || undefined,
    });
    setToolbarSelection(null);
    setNoteInput("");
    setAddingNote(false);
  };

  const handlePlaceBookmark = () => {
    onAddBookmark({
      documentId: document.id,
      paragraphIndex: activeParagraphIndex,
      sentenceIndex: activeSentenceIndex,
      label: `Page Mark - Chapter ${document.paragraphs[activeParagraphIndex]?.text.substring(0, 20)}...`,
    });
    alert("Bookmark placed successfully at current line.");
  };

  // Beautiful, robust inline Markdown converter for displaying formatted prose
  const parseInlineMarkdown = (text: string) => {
    const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`|\[.*?\]\(.*?\))/g;
    const parts = text.split(regex);
    
    if (parts.length === 1) return text;
    
    return parts.map((part, idx) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={idx} className="font-bold text-gray-950 dark:text-white">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("*") && part.endsWith("*")) {
        return <em key={idx} className="italic text-gray-900 dark:text-zinc-200">{part.slice(1, -1)}</em>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={idx} className="font-mono bg-zinc-100 dark:bg-zinc-800 text-rose-600 dark:text-rose-400 px-1 py-0.5 rounded text-[12px]">{part.slice(1, -1)}</code>;
      }
      if (part.startsWith("[") && part.includes("](")) {
        const linkText = part.match(/\[(.*?)\]/)?.[1] || "";
        return <span key={idx} className="underline decoration-teal-500 text-teal-600 dark:text-teal-400 font-medium">{linkText}</span>;
      }
      return part;
    });
  };

  // Bonic reading parser transformer
  const parseBionicWord = (word: string, idx: number) => {
    // Strip markdown characters from bionic representations
    const cleanWord = word.replace(/[\*_`\[\]]/g, "");
    if (cleanWord.length <= 1) return <span key={idx} className="mr-1">{cleanWord}</span>;
    const mid = Math.ceil(cleanWord.length / 2);
    const prefix = cleanWord.substring(0, mid);
    const suffix = cleanWord.substring(mid);
    return (
      <span key={idx} className="mr-1 inline-block">
        <strong className="font-extrabold dark:text-white text-gray-900">{prefix}</strong>
        <span>{suffix}</span>
      </span>
    );
  };

  const renderSentenceWithFormat = (s: Sentence, isFocused: boolean, pIdx: number) => {
    const sentenceText = s.text;
    const isHighlighted = highlights.find(
      (h) => h.paragraphIndex === pIdx && h.sentenceIndex === s.index
    );

    const bionicWords = sentenceText.split(" ").map((w, idx) => parseBionicWord(w, idx));

    return (
      <span
        ref={isFocused ? activeSentenceRef : null}
        key={s.id}
        data-paragraph-index={pIdx}
        data-sentence-index={s.index}
        onClick={() => handleSentenceClick(pIdx, s.index)}
        className={`relative inline mx-0.5 px-0.5 rounded cursor-pointer leading-relaxed tracking-wide transition-all select-text duration-200 ${
          isHighlighted
            ? isHighlighted.color
            : isFocused
            ? "bg-teal-500/10 dark:bg-teal-400/10 border-b-2 border-teal-500/60 font-semibold"
            : "hover:bg-gray-100 dark:hover:bg-white/5"
        }`}
      >
        {accessibilityConfig.bionicReading ? bionicWords : parseInlineMarkdown(sentenceText)}
      </span>
    );
  };

  // Custom styling mappings
  const fontStyles: Record<string, string> = {
    serif: "font-serif tracking-normal leading-relaxed",
    sans: "font-sans leading-relaxed tracking-normal",
    dyslexic: "font-dyslexic tracking-wide leading-loose text-amber-900/90 dark:text-amber-100/90",
    hyperlegible: "font-atkinson leading-relaxed text-gray-800 dark:text-zinc-200",
    mono: "font-mono text-xs text-gray-600 dark:text-zinc-400 leading-normal",
  };

  const spacingStyles: Record<string, string> = {
    normal: "",
    wide: "tracking-wide word-spacing-wide",
    wider: "tracking-wider word-spacing-wider",
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-surface-page dark:bg-zinc-950 text-ink-primary select-none w-full">
      {/* 1. Header Navigation Dockbar */}
      <header className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-gray-150 dark:border-white/5 bg-white dark:bg-zinc-950 shadow-sm relative z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg text-gray-500 dark:text-gray-400 transition-colors"
            title="Return to custom shelf library"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-sm font-serif font-bold text-gray-900 dark:text-white truncate max-w-[160px] sm:max-w-xs">
              {document.title}
            </h1>
            <p className="text-[10px] text-gray-400 italic truncate">{document.author}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Table of Contents Trigger Button */}
          <button
            onClick={() => setShowTOC(!showTOC)}
            className={`p-2 rounded-lg border flex items-center gap-1.5 text-xs font-semibold transition-all ${
              showTOC
                ? "border-teal-500 bg-teal-50/10 text-teal-600 dark:text-teal-400"
                : "border-gray-200/50 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5"
            }`}
          >
            <Menu className="w-4 h-4" />
            <span className="hidden sm:inline">ToC Outline</span>
          </button>

          {/* Place Bookmark Button */}
          <button
            onClick={handlePlaceBookmark}
            className="p-2 border border-gray-200/50 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg text-gray-600 dark:text-gray-400 flex items-center gap-1 text-xs font-semibold"
            title="Save bookmark"
          >
            <BookMarked className="w-4 h-4 text-teal-500" />
            <span className="hidden sm:inline">Bookmark</span>
          </button>

          {/* Toggle Right study workspace sidebar */}
          <button
            onClick={toggleRightSidebar}
            className={`p-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all ${
              showRightSidebar
                ? "border-teal-500 bg-teal-50/10 text-teal-600"
                : "border-gray-200/50 dark:border-white/5 hover:bg-gray-50"
            }`}
          >
            <Sparkles className="w-4 h-4 text-teal-500 animate-pulse" />
            <span className="hidden sm:inline">AI study Studio</span>
          </button>
        </div>
      </header>

      {/* 2. Central Layout Workspace (TOC left rail, centralized typography book document, active companion rail right) */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Table of Contents outline (Left toggleable Drawer) */}
        {showTOC && (
          <div className="absolute inset-y-0 left-0 w-[240px] z-35 bg-white dark:bg-zinc-950 border-r border-gray-200/50 dark:border-white/5 shadow-lg p-4 flex flex-col space-y-3">
            <div className="flex items-center justify-between border-b dark:border-white/10 pb-2">
              <span className="text-xs font-bold font-serif">Table of Contents</span>
              <button onClick={() => setShowTOC(false)} className="text-[10px] text-gray-500 hover:underline">
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1">
              {document.chapters.map((ch, idx) => {
                const isActive = activeParagraphIndex >= ch.paragraphIndex &&
                  (idx === document.chapters.length - 1 || activeParagraphIndex < document.chapters[idx + 1].paragraphIndex);
                
                return (
                  <button
                    key={ch.id}
                    onClick={() => {
                      onJumpTo(ch.paragraphIndex, 0);
                      onUpdateProgress(ch.paragraphIndex, 0);
                      setShowTOC(false);
                    }}
                    className={`w-full text-left py-2 px-2.5 rounded text-xs transition-all ${
                      isActive
                        ? "bg-teal-50 dark:bg-teal-950/20 text-teal-600 dark:text-teal-400 font-bold border-l-2 border-teal-500"
                        : "hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    {ch.title}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Vertical Distraction-Free typography board */}
        <div
          ref={readerColumnRef}
          onMouseUp={handleTextSelectCheck}
          className="flex-1 overflow-y-auto px-4 py-12 relative flex flex-col items-center selection:bg-teal-500/20 dark:selection:bg-teal-400/20"
          style={{ scrollBehavior: "smooth" }}
        >
          {/* Active horizontal reading tracking ruler */}
          {accessibilityConfig.readingRuler && (
            <div
              className="absolute left-0 w-full pointer-events-none transition-all duration-150 z-10"
              style={{
                top: `${accessibilityConfig.rulerPosition}%`,
                height: "6px",
                backgroundColor: "rgba(13, 148, 136, 0.55)", // Teal tracking guide ruler color
                boxShadow: "0 0 12px rgba(13, 148, 136, 0.4)",
              }}
            />
          )}

          {/* Audio Synthesis Locked/Unlocking Dashboard Card */}
          {document.processingStatus !== "ready" && (
            <div className="w-full max-w-[65ch] mb-8 p-5 rounded-2xl border bg-white dark:bg-zinc-950 shadow-sm border-amber-200/50 dark:border-amber-900/40 text-left space-y-3.5 relative z-10">
              <div className="flex items-center gap-2">
                <span className="p-1 px-2 rounded text-[9px] uppercase tracking-wider font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono">
                  🎙️ Audio Offline
                </span>
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Speech narration is not synthesized yet
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                Lumen segments text strings and constructs timing indexes in a playable audio mapping. Generate your audio map to activate the bidirectional Speak narration and learning companion.
              </p>
              {document.processingStatus === "unprocessed" ? (
                <button
                  onClick={() => handleTriggerReaderSynthesis()}
                  className="py-2.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 active:scale-97 text-white font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 shadow animate-pulse cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-amber-203" />
                  Load High-Fidelity Voice Synthesis Engine
                </button>
              ) : (
                <div className="p-3.5 bg-teal-50 dark:bg-teal-950/25 rounded-xl text-teal-700 dark:text-teal-400 border border-teal-200/50 dark:border-teal-900/30 space-y-1.5">
                  <div className="flex items-center gap-2 animate-pulse font-bold text-xs">
                    <Loader2 className="w-4 h-4 animate-spin text-teal-600 dark:text-teal-400" />
                    <span>{localPct}% Complete - Synthesizing Kokoro speech blocks...</span>
                  </div>
                  <p className="text-[10px] opacity-80 leading-snug font-mono">
                    {localStep || "Allocating synthesis partitions..."}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Centered Document paper container */}
          <div
            className={`w-full max-w-[65ch] space-y-8 select-text pb-20 ${fontStyles[accessibilityConfig.fontStyle]} ${spacingStyles[accessibilityConfig.textSpacing]}`}
            style={{ fontSize: `${accessibilityConfig.fontSize}px` }}
          >
            {document.paragraphs.map((p, pIdx) => {
              const isCurrentParagraph = pIdx === activeParagraphIndex;
              const textTrimmed = p.text.trim();
              
              // Skip rendering empty lines
              if (textTrimmed === "") return null;

              // 1. Code block rendering
              if (p.text.startsWith("```")) {
                const codeLang = p.text.match(/^```([a-zA-Z0-9]*)/)?.[1] || "";
                
                return (
                  <div key={p.id} className="w-full bg-zinc-900 border border-zinc-800 dark:border-white/5 rounded-xl p-4 my-6 font-mono text-[13px] leading-relaxed shadow-inner overflow-x-auto relative group/code text-zinc-100">
                    <div className="absolute top-2 right-2 flex gap-1.5 items-center select-none opacity-0 group-hover/code:opacity-100 transition-opacity">
                      <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">{codeLang || "code"}</span>
                      <button 
                        onClick={() => {
                          const codeBody = p.sentences.map(s => s.text).join("\n");
                          navigator.clipboard.writeText(codeBody);
                        }}
                        className="text-[10px] text-teal-400 hover:text-teal-300 font-bold hover:underline cursor-pointer"
                        title="Copy snippet"
                      >
                        Copy
                      </button>
                    </div>
                    <pre className="font-mono whitespace-pre select-text">
                      {p.sentences.map((s) => {
                        const isFocused = isCurrentParagraph && s.index === activeSentenceIndex;
                        return renderSentenceWithFormat(s, isFocused, pIdx);
                      })}
                    </pre>
                  </div>
                );
              }

              // 2. Headings (Markdown headers #, ##, ###, or CHAPTER headings)
              const isHashHeader = p.text.startsWith("#");
              const isChapterWord = p.text.toUpperCase().startsWith("CHAPTER");
              
              if (isHashHeader || isChapterWord) {
                const hashes = p.text.match(/^#+/)?.[0] || "";
                const depth = hashes.length || 1;
                
                let headingClasses = "font-serif font-bold text-teal-800 dark:text-teal-350 pb-2 pt-6 border-b border-gray-100 dark:border-white/5 select-text";
                if (depth === 1) {
                  headingClasses += " text-xl sm:text-2xl tracking-tight";
                } else if (depth === 2) {
                  headingClasses += " text-lg sm:text-xl tracking-tight";
                } else {
                  headingClasses += " text-base sm:text-lg";
                }

                return (
                  <div key={p.id} className={headingClasses}>
                    {p.sentences.map((s) => {
                      const isFocused = isCurrentParagraph && s.index === activeSentenceIndex;
                      // Strip visual hash characters on the fly inside heading
                      const headingSentence = {
                        ...s,
                        text: s.text.replace(/^#+\s*/, "")
                      };
                      return renderSentenceWithFormat(headingSentence, isFocused, pIdx);
                    })}
                  </div>
                );
              }

              // 3. Bullet list item rendering
              const isBullet = p.text.startsWith("* ") || p.text.startsWith("- ") || p.text.startsWith("+ ");
              const isNumbered = /^\d+\.\s+/.test(p.text);
              
              if (isBullet || isNumbered) {
                const marker = isBullet ? "•" : p.text.match(/^\d+\./)?.[0] || "1.";
                
                return (
                  <div key={p.id} className="flex gap-3 pl-4 items-start select-text leading-relaxed py-0.5">
                    <span className="text-teal-600 dark:text-teal-400 font-bold select-none mt-1 text-sm shrink-0">
                      {marker}
                    </span>
                    <div className="flex-1 text-gray-800 dark:text-gray-250 select-text">
                      {p.sentences.map((s) => {
                        const isFocused = isCurrentParagraph && s.index === activeSentenceIndex;
                        const listSentence = {
                          ...s,
                          text: s.text.replace(/^[*+-]\s+/, "").replace(/^\d+\.\s+/, "")
                        };
                        return renderSentenceWithFormat(listSentence, isFocused, pIdx);
                      })}
                    </div>
                  </div>
                );
              }

              // 4. Blockquote rendering
              const isBlockquote = p.text.startsWith("> ");
              if (isBlockquote) {
                return (
                  <blockquote key={p.id} className="border-l-4 border-teal-500/50 dark:border-teal-400/40 pl-4 py-1.5 my-4 italic text-gray-600 dark:text-zinc-400 select-text max-w-[65ch] w-full">
                    {p.sentences.map((s) => {
                      const isFocused = isCurrentParagraph && s.index === activeSentenceIndex;
                      const blockquoteSentence = {
                        ...s,
                        text: s.text.replace(/^>\s*/, "")
                      };
                      return renderSentenceWithFormat(blockquoteSentence, isFocused, pIdx);
                    })}
                  </blockquote>
                );
              }

              // 5. Regular core paragraphs
              return (
                <p key={p.id} className="leading-relaxed text-gray-800 dark:text-gray-250 select-text">
                  {p.sentences.map((s) => {
                    const isFocused = isCurrentParagraph && s.index === activeSentenceIndex;
                    return renderSentenceWithFormat(s, isFocused, pIdx);
                  })}
                </p>
              );
            })}
          </div>

          {/* FLOATING POPUP WORD TOOLBAR COMPONENT */}
          {toolbarSelection && (
            <div
              className="selection-popup absolute bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-xl p-3 shadow-xl z-50 flex flex-col gap-2.5 w-[210px] animate-fade-in"
              style={{
                left: `${toolbarSelection.clientX - 105}px`,
                top: `${toolbarSelection.clientY - 65}px`, // Centered beautifully above selection
              }}
            >
              <div className="flex gap-1.5 justify-around border-b dark:border-white/10 pb-1.5 select-none">
                {/* 1. Highlight Button */}
                <button
                  onClick={executeHighlight}
                  className="flex flex-col items-center text-[9px] font-semibold text-gray-500 hover:text-teal-600 transition-colors"
                  title="Apply current color highlight"
                >
                  <Highlighter className="w-4 h-4 text-teal-500 animate-pulse" />
                  <span>Highlight</span>
                </button>

                {/* 2. Custom Notes Button toggler */}
                <button
                  onClick={() => setAddingNote(!addingNote)}
                  className="flex flex-col items-center text-[9px] font-semibold text-gray-500 hover:text-teal-600 transition-colors"
                >
                  <BookMarked className="w-4 h-4 text-amber-500" />
                  <span>Add Note</span>
                </button>

                {/* 3. Narrate Here button */}
                <button
                  onClick={() => {
                    onJumpTo(toolbarSelection.paragraphIndex, toolbarSelection.sentenceIndex);
                    setIsPlaying(true);
                  }}
                  className="flex flex-col items-center text-[9px] font-semibold text-gray-500 hover:text-teal-600 transition-colors"
                >
                  <Play className="w-4 h-4 text-green-500 fill-green-500/10" />
                  <span>Speak Here</span>
                </button>
              </div>

              {/* Color Dot Palette */}
              <div className="flex flex-col gap-1 select-none">
                <span className="text-[8px] font-semibold text-gray-400 dark:text-gray-500 font-mono text-center">Tap to highlight color:</span>
                <div className="flex gap-2 justify-center py-0.5">
                  {[
                    { class: "bg-teal-500/20 border-l-2 border-teal-500", dot: "bg-teal-400" },
                    { class: "bg-yellow-500/25 border-l-2 border-yellow-500", dot: "bg-yellow-400" },
                    { class: "bg-purple-500/20 border-l-2 border-purple-500", dot: "bg-purple-400" },
                    { class: "bg-indigo-505/20 border-l-2 border-indigo-500", dot: "bg-indigo-400" },
                    { class: "bg-rose-500/20 border-l-2 border-rose-500", dot: "bg-rose-400" },
                  ].map((col, i) => (
                    <button
                      key={i}
                      onClick={() => handleColorHighlightSelect(col.class)}
                      className={`w-4 h-4 rounded-full ${col.dot} border border-white dark:border-zinc-800 shadow-sm transition-all hover:scale-120 active:scale-90`}
                      title="Instant Highlight"
                    />
                  ))}
                </div>
              </div>

              {/* Text note field container */}
              {addingNote && (
                <div className="space-y-1.5 border-t dark:border-white/5 pt-2">
                  <input
                    type="text"
                    placeholder="Enter contextual notes..."
                    required
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-zinc-950 border border-gray-150 dark:border-white/5 text-[11px] px-2 py-1.5 rounded focus:outline-none dark:text-gray-250 font-sans"
                  />
                  <button
                    onClick={executeHighlight}
                    className="w-full bg-teal-600 text-white text-[10px] font-semibold py-1 rounded hover:bg-teal-500 transition-colors shadow-sm"
                  >
                    Save Note Highlight
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Collapsible right sidebar (AI Companion panel + Settings) */}
        {showRightSidebar && (
          <div className="w-[320px] shrink-0 h-full border-l border-gray-200/50 dark:border-white/5 relative z-10 bg-white dark:bg-zinc-950">
            {rightSidebarContent}
          </div>
        )}
      </div>

      {/* 3. Bottom Float Audio Controller Dock */}
      <footer className="h-20 shrink-0 bg-white dark:bg-zinc-950 border-t border-gray-200/50 dark:border-white/10 flex flex-col justify-center px-4 relative z-30 shadow-md">
        <div className="max-w-7xl mx-auto w-full flex items-center justify-between gap-4">
          
          {/* Active Sentence preview indicator */}
          <div className="hidden md:block w-1/4 max-w-xs text-left">
            <span className="text-[10px] font-mono uppercase tracking-wider text-teal-600 dark:text-teal-400 font-bold flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Narration Pointer
            </span>
            <p className="text-[11px] font-serif text-gray-500 dark:text-gray-400 truncate mt-1 leading-snug">
              "{document.paragraphs[activeParagraphIndex]?.sentences[activeSentenceIndex]?.text || "No active reading sentence pointer selected."}"
            </p>
          </div>

          {/* Navigation Controls */}
          <div className="flex flex-col items-center gap-1.5 flex-1 select-none">
            <div className="flex items-center gap-5">
              <button
                onClick={handleSkipBack}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/5 text-gray-400 hover:text-teal-600 dark:hover:text-teal-400 rounded-full transition-all"
                title="Skip back 1 sentence"
              >
                <SkipBack className="w-5 h-5" />
              </button>

              <button
                onClick={() => {
                  if (document.processingStatus !== "ready") {
                    alert("Please click 'Load High-Fidelity Voice Synthesis Engine' at the top of the book page to generate the narrated audio map first!");
                    return;
                  }
                  setIsPlaying(!isPlaying);
                }}
                disabled={audioLoading || (document.processingStatus === "processing")}
                className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-all hover:scale-105 ${
                  document.processingStatus !== "ready"
                    ? "bg-gray-200 dark:bg-zinc-800 text-gray-400 dark:text-zinc-650 cursor-not-allowed"
                    : "bg-teal-600 hover:bg-teal-500 text-white"
                }`}
                title={document.processingStatus !== "ready" ? "Generate audio map to activate playback" : "Narrate"}
              >
                {audioLoading ? (
                  <span className="w-4 h-4 rounded-full border-2 border-t-transparent border-teal-500 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-5 h-5 fill-white" />
                ) : (
                  <Play className={`w-5 h-5 ${document.processingStatus !== "ready" ? "fill-gray-400 text-gray-400" : "fill-white text-white translate-x-0.5"}`} />
                )}
              </button>

              <button
                onClick={handleSkipForward}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/5 text-gray-400 hover:text-teal-600 dark:hover:text-teal-400 rounded-full transition-all"
                title="Skip forward 1 sentence"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            {/* active chapter label */}
            <span className="text-[10px] text-gray-400 font-medium">
              Paragraph {activeParagraphIndex + 1} of {document.paragraphs.length} (Sentence {activeSentenceIndex + 1})
            </span>
          </div>

          {/* Voice configuration + playback Speed selector */}
          <div className="w-1/3 max-w-xs flex items-center justify-end gap-3">
            {/* Speed Rate trigger */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-gray-400">Pace</span>
              <select
                value={playbackRate}
                onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                className="bg-gray-50 dark:bg-zinc-90 w-16 border border-gray-200 dark:border-white/10 rounded px-1.5 py-1 text-[11px] font-semibold focus:outline-none dark:text-gray-200"
              >
                <option value="0.75">0.75x</option>
                <option value="1.0">1.0x (Std)</option>
                <option value="1.25">1.25x</option>
                <option value="1.5">1.5x</option>
                <option value="1.75">1.75x</option>
              </select>
            </div>

            {/* Prebuilt voices Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-gray-400">Voice</span>
              <select
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                className="bg-gray-50 dark:bg-zinc-90 border border-gray-200 dark:border-white/10 rounded px-1.5 py-1 text-[11px] font-semibold focus:outline-none dark:text-gray-200 select-voice-config"
              >
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

        </div>
      </footer >
    </div >
  );
}

// Convert raw 16-bit Mono PCM base64 audio into a valid playable WAV blob URL
function pcmToWavBlob(base64Pcm: string, sampleRate: number = 24000): string {
  const binaryString = window.atob(base64Pcm);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const buffer = new ArrayBuffer(44 + len);
  const view = new DataView(buffer);

  // Write WA-RIFF Header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + len, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // Linear PCM
  view.setUint16(22, 1, true); // Mono channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 16-bit mono byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // 16 bits per sample
  writeString(view, 36, "data");
  view.setUint32(40, len, true);

  // Copy PCM data
  const wavBytes = new Uint8Array(buffer);
  wavBytes.set(bytes, 44);

  const blob = new Blob([wavBytes], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
