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
  Search,
  FileText,
  Copy,
  Pin,
} from "lucide-react";
import { AudioProfile, Document, Paragraph, Sentence, Highlight, Bookmark, Voice } from "../types";
import { AccessibilityConfig } from "./AccessibilitySettings";
import { buildTextFilterKey, filterReadableText } from "../lib/textFilters";
import { ensureSentenceAudio, getDefaultVoiceId, getNarratableSentenceText, preloadDocumentAudio } from "../lib/audioMap";

interface Props {
  document: Document;
  highlights: Highlight[];
  bookmarks: Bookmark[];
  accessibilityConfig: AccessibilityConfig;
  onBack: () => void;
  onUpdateProgress: (paragraphIndex: number, sentenceIndex: number) => void;
  onAddHighlight: (highlight: Omit<Highlight, "id" | "createdAt">) => void;
  onRemoveHighlight: (highlightId: string) => void;
  onAddBookmark: (bookmark: Omit<Bookmark, "id" | "createdAt">) => void;
  activeParagraphIndex: number;
  activeSentenceIndex: number;
  onJumpTo: (pIdx: number, sIdx: number) => void;
  rightSidebarContent: React.ReactNode;
  toggleRightSidebar: () => void;
  showRightSidebar: boolean;
  onUpdateStatus: (bookId: string, status: "unprocessed" | "processing" | "ready" | "failed") => void;
  onUpdateAudioProfile: (bookId: string, audioProfile: AudioProfile | null) => void;
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
  onRemoveHighlight,
  onAddBookmark,
  activeParagraphIndex,
  activeSentenceIndex,
  onJumpTo,
  rightSidebarContent,
  toggleRightSidebar,
  showRightSidebar,
  onUpdateStatus,
  onUpdateAudioProfile,
}: Props) {
  const compareCursors = (
    a: { paragraphIndex: number; sentenceIndex: number },
    b: { paragraphIndex: number; sentenceIndex: number },
  ) => {
    if (a.paragraphIndex !== b.paragraphIndex) {
      return a.paragraphIndex - b.paragraphIndex;
    }

    return a.sentenceIndex - b.sentenceIndex;
  };

  const getHighlightRange = (highlight: Highlight) => {
    const start = {
      paragraphIndex: highlight.paragraphIndex,
      sentenceIndex: highlight.sentenceIndex,
    };
    const end = {
      paragraphIndex: highlight.endParagraphIndex ?? highlight.paragraphIndex,
      sentenceIndex: highlight.endSentenceIndex ?? highlight.sentenceIndex,
    };

    return compareCursors(start, end) <= 0 ? { start, end } : { start: end, end: start };
  };

  const isCursorWithinRange = (
    cursor: { paragraphIndex: number; sentenceIndex: number },
    start: { paragraphIndex: number; sentenceIndex: number },
    end: { paragraphIndex: number; sentenceIndex: number },
  ) => compareCursors(cursor, start) >= 0 && compareCursors(cursor, end) <= 0;

  const doesHighlightOverlapSelection = (
    highlight: Highlight,
    start: { paragraphIndex: number; sentenceIndex: number },
    end: { paragraphIndex: number; sentenceIndex: number },
  ) => {
    const range = getHighlightRange(highlight);
    return compareCursors(range.start, end) <= 0 && compareCursors(range.end, start) >= 0;
  };

  // Navigation & Table of Contents Sidebar
  const [showTOC, setShowTOC] = useState(false);

  // Audio Playback Engine States
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [selectedVoice, setSelectedVoice] = useState<string>(() => getDefaultVoiceId(document));
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Local Reader compilers tracking
  const [localPct, setLocalPct] = useState(0);
  const [localStep, setLocalStep] = useState("");

  const activeTextFilterKey = buildTextFilterKey(accessibilityConfig.textFilters);
  const isSelectedVoiceReady = document.processingStatus === "ready" && document.audioProfile?.voiceId === selectedVoice && document.audioProfile?.textFilterKey === activeTextFilterKey;
  const selectedVoiceLabel = VOICES.find((voice) => voice.id === selectedVoice)?.name || selectedVoice;
  const generatedVoiceLabel = document.audioProfile?.voiceId
    ? VOICES.find((voice) => voice.id === document.audioProfile?.voiceId)?.name || document.audioProfile.voiceId
    : null;

  const handleTriggerReaderSynthesis = async () => {
    onUpdateStatus(document.id, "processing");
    setLocalPct(2);
    setLocalStep("Preparing whole-book Kokoro narration cache...");

    try {
      const result = await preloadDocumentAudio({
        document,
        voiceId: selectedVoice,
        textFilters: accessibilityConfig.textFilters,
        onProgress: ({ pct, step }) => {
          setLocalPct(pct);
          setLocalStep(step);
        },
      });

      onUpdateAudioProfile(document.id, {
        voiceId: result.voiceId,
        generatedAt: new Date().toISOString(),
        segmentCount: result.segmentCount,
        textFilterKey: result.textFilterKey,
      });
      onUpdateStatus(document.id, "ready");
      setLocalPct(100);
      setLocalStep("Whole-book Kokoro audio is ready.");
    } catch (err: any) {
      console.error("Reader Kokoro preload failed:", err);
      onUpdateStatus(document.id, "failed");
      setLocalPct(0);
      setLocalStep(err.message || "Kokoro audio generation failed.");
    }
  };

  // Floating word selection toolbar popup state
  const [toolbarSelection, setToolbarSelection] = useState<{
    text: string;
    clientX: number;
    clientY: number;
    startParagraphIndex: number;
    startSentenceIndex: number;
    endParagraphIndex: number;
    endSentenceIndex: number;
  } | null>(null);

  const [highlightColor, setHighlightColor] = useState("bg-[#E8D87D]/25 border-l-2 border-[#E8D87D]");
  const [noteInput, setNoteInput] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [popupMode, setPopupMode] = useState<"toolbar" | "colors" | "note">("toolbar");
  const [copiedFlash, setCopiedFlash] = useState(false);

  // Reference hooks for dynamic scroll mapping
  const activeSentenceRef = useRef<HTMLSpanElement | null>(null);
  const readerColumnRef = useRef<HTMLDivElement | null>(null);

  // Prefetching queues for seamless gaps
  const prefetchTimeoutRef = useRef<any>(null);
  const audioCacheRef = useRef<Record<string, string>>({});

  useEffect(() => {
    setSelectedVoice(getDefaultVoiceId(document));
  }, [document.id, document.audioProfile?.voiceId]);

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

  useEffect(() => {
    if (!isSelectedVoiceReady && isPlaying) {
      setIsPlaying(false);
    }
  }, [isSelectedVoiceReady, isPlaying]);

  const selectedHighlightIds = toolbarSelection
    ? highlights
        .filter((highlight) =>
          doesHighlightOverlapSelection(
            highlight,
            {
              paragraphIndex: toolbarSelection.startParagraphIndex,
              sentenceIndex: toolbarSelection.startSentenceIndex,
            },
            {
              paragraphIndex: toolbarSelection.endParagraphIndex,
              sentenceIndex: toolbarSelection.endSentenceIndex,
            },
          ),
        )
        .map((highlight) => highlight.id)
    : [];

  const findNarratableCursor = (
    paragraphIndex: number,
    sentenceIndex: number,
    {
      direction = 1,
      includeCurrent = false,
    }: {
      direction?: 1 | -1;
      includeCurrent?: boolean;
    } = {},
  ) => {
    let nextParagraphIndex = paragraphIndex;
    let nextSentenceIndex = includeCurrent ? sentenceIndex : sentenceIndex + direction;

    while (nextParagraphIndex >= 0 && nextParagraphIndex < document.paragraphs.length) {
      const currentParagraph = document.paragraphs[nextParagraphIndex];
      if (!currentParagraph) {
        return null;
      }

      while (nextSentenceIndex >= 0 && nextSentenceIndex < currentParagraph.sentences.length) {
        const sentence = currentParagraph.sentences[nextSentenceIndex];
        if (sentence && getNarratableSentenceText(sentence.text, accessibilityConfig.textFilters)) {
          return {
            paragraphIndex: nextParagraphIndex,
            sentenceIndex: nextSentenceIndex,
          };
        }
        nextSentenceIndex += direction;
      }

      nextParagraphIndex += direction;
      if (nextParagraphIndex < 0 || nextParagraphIndex >= document.paragraphs.length) {
        break;
      }

      const nextParagraph = document.paragraphs[nextParagraphIndex];
      nextSentenceIndex = direction > 0 ? 0 : Math.max(nextParagraph.sentences.length - 1, 0);
    }

    return null;
  };

  const getUpcomingSentenceCursors = (paragraphIndex: number, sentenceIndex: number, lookahead: number = 2) => {
    const upcoming: Array<{ paragraphIndex: number; sentenceIndex: number }> = [];
    let cursor = { paragraphIndex, sentenceIndex };

    while (upcoming.length < lookahead) {
      const nextCursor = findNarratableCursor(cursor.paragraphIndex, cursor.sentenceIndex, {
        direction: 1,
      });
      if (!nextCursor) {
        break;
      }

      upcoming.push(nextCursor);
      cursor = nextCursor;
    }

    return upcoming;
  };

  const loadAndPlaySentenceAudio = async (pIdx: number, sIdx: number) => {
    stopAudio();
    setAudioLoading(true);

    if (!isSelectedVoiceReady) {
      setAudioLoading(false);
      setIsPlaying(false);
      return;
    }

    const targetCursor = findNarratableCursor(pIdx, sIdx, { includeCurrent: true });
    if (!targetCursor) {
      setIsPlaying(false);
      setAudioLoading(false);
      return;
    }

    if (targetCursor.paragraphIndex !== pIdx || targetCursor.sentenceIndex !== sIdx) {
      onJumpTo(targetCursor.paragraphIndex, targetCursor.sentenceIndex);
      onUpdateProgress(targetCursor.paragraphIndex, targetCursor.sentenceIndex);
      setAudioLoading(false);
      return;
    }

    const sentence = document.paragraphs[targetCursor.paragraphIndex]?.sentences[targetCursor.sentenceIndex];
    if (!sentence) {
      setIsPlaying(false);
      setAudioLoading(false);
      return;
    }

    const cacheKey = `${document.id}_${selectedVoice}_${activeTextFilterKey}_${targetCursor.paragraphIndex}_${targetCursor.sentenceIndex}`;

    try {
      let resolvedUrl = audioCacheRef.current[cacheKey];

      if (!resolvedUrl) {
        resolvedUrl = await ensureSentenceAudio({
          document,
          voiceId: selectedVoice,
          paragraphIndex: targetCursor.paragraphIndex,
          sentenceIndex: targetCursor.sentenceIndex,
          textFilters: accessibilityConfig.textFilters,
        });
        audioCacheRef.current[cacheKey] = resolvedUrl;
      }

      triggerNarrationPrefetch(targetCursor.paragraphIndex, targetCursor.sentenceIndex);

      const audio = new Audio(resolvedUrl);
      audio.preload = "auto";
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
        handleSentenceCompleted(targetCursor.paragraphIndex, targetCursor.sentenceIndex);
      };

      await audio.play();
    } catch (err: any) {
      console.error("Kokoro narration playback failed:", err);
      setAudioLoading(false);
      setIsPlaying(false);
      alert("Kokoro audio could not be loaded. Rebuild the book audio and verify the local Kokoro worker is available.");
    }
  };

  const triggerNarrationPrefetch = (pIdx: number, sIdx: number) => {
    if (prefetchTimeoutRef.current) clearTimeout(prefetchTimeoutRef.current);

    prefetchTimeoutRef.current = setTimeout(async () => {
      const upcoming = getUpcomingSentenceCursors(pIdx, sIdx, 2);

      for (const cursor of upcoming) {
        const cacheKey = `${document.id}_${selectedVoice}_${activeTextFilterKey}_${cursor.paragraphIndex}_${cursor.sentenceIndex}`;
        if (audioCacheRef.current[cacheKey]) {
          continue;
        }

        try {
          const url = await ensureSentenceAudio({
            document,
            voiceId: selectedVoice,
            paragraphIndex: cursor.paragraphIndex,
            sentenceIndex: cursor.sentenceIndex,
            textFilters: accessibilityConfig.textFilters,
          });
          audioCacheRef.current[cacheKey] = url;
        } catch (err) {
          console.warn("Background Kokoro prefetch silent drop:", err);
          break;
        }
      }
    }, 250);
  };

  // Skip sentence completion
  const handleSentenceCompleted = (pIdx: number, sIdx: number) => {
    const nextCursor = findNarratableCursor(pIdx, sIdx, { direction: 1 });
    if (nextCursor) {
      onJumpTo(nextCursor.paragraphIndex, nextCursor.sentenceIndex);
      return;
    }

    setIsPlaying(false); // Book finished!
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setAudioUrl(null);
  };

  // Sentence Skip Back
  const handleSkipBack = () => {
    const previousCursor = findNarratableCursor(activeParagraphIndex, activeSentenceIndex, { direction: -1 });
    if (previousCursor) {
      onJumpTo(previousCursor.paragraphIndex, previousCursor.sentenceIndex);
    }
  };

  // Sentence Skip Forward
  const handleSkipForward = () => {
    const nextCursor = findNarratableCursor(activeParagraphIndex, activeSentenceIndex, { direction: 1 });
    if (nextCursor) {
      onJumpTo(nextCursor.paragraphIndex, nextCursor.sentenceIndex);
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

            const sentenceElements = Array.from(
              readerColumnRef.current.querySelectorAll("[data-paragraph-index][data-sentence-index]"),
            ) as HTMLElement[];

            const selectedCursors = sentenceElements
              .filter((element) => {
                try {
                  return range.intersectsNode(element);
                } catch {
                  return sel.containsNode(element, true);
                }
              })
              .map((element) => ({
                paragraphIndex: parseInt(element.getAttribute("data-paragraph-index") || "0", 10),
                sentenceIndex: parseInt(element.getAttribute("data-sentence-index") || "0", 10),
              }))
              .sort(compareCursors);

            if (selectedCursors.length === 0) {
              setToolbarSelection(null);
              return;
            }

            const firstCursor = selectedCursors[0];
            const lastCursor = selectedCursors[selectedCursors.length - 1];

            setToolbarSelection({
              text: selectedText,
              clientX: relativeLeft,
              clientY: relativeTop,
              startParagraphIndex: firstCursor.paragraphIndex,
              startSentenceIndex: firstCursor.sentenceIndex,
              endParagraphIndex: lastCursor.paragraphIndex,
              endSentenceIndex: lastCursor.sentenceIndex,
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
      setPopupMode("toolbar");
      setAddingNote(false);
    }
  };

  const hasActiveTextSelection = () => {
    const selection = window.getSelection();
    return Boolean(selection && selection.toString().trim().length > 0);
  };

  const handleColorHighlightSelect = (colorClass: string) => {
    if (!toolbarSelection) return;
    selectedHighlightIds.forEach((highlightId) => onRemoveHighlight(highlightId));
    onAddHighlight({
      documentId: document.id,
      paragraphIndex: toolbarSelection.startParagraphIndex,
      sentenceIndex: toolbarSelection.startSentenceIndex,
      endParagraphIndex: toolbarSelection.endParagraphIndex,
      endSentenceIndex: toolbarSelection.endSentenceIndex,
      text: toolbarSelection.text,
      color: colorClass,
      note: noteInput.trim() || undefined,
    });
    setToolbarSelection(null);
    setNoteInput("");
    setAddingNote(false);
    setPopupMode("toolbar");
  };

  const handleRemoveSelectedHighlights = () => {
    if (selectedHighlightIds.length === 0) {
      return;
    }

    selectedHighlightIds.forEach((highlightId) => onRemoveHighlight(highlightId));
    setToolbarSelection(null);
    setNoteInput("");
    setAddingNote(false);
  };

  // Handle Double-tap / Click text trigger play
  const handleSentenceClick = (pIdx: number, sIdx: number) => {
    if (hasActiveTextSelection()) {
      return;
    }

    const sentence = document.paragraphs[pIdx]?.sentences[sIdx];
    if (!sentence || !getNarratableSentenceText(sentence.text, accessibilityConfig.textFilters)) {
      handleParagraphClick(pIdx);
      return;
    }

    onJumpTo(pIdx, sIdx);
    onUpdateProgress(pIdx, sIdx);
    setToolbarSelection(null);
  };

  const handleParagraphClick = (pIdx: number) => {
    if (hasActiveTextSelection()) {
      return;
    }

    const firstSentence = document.paragraphs[pIdx]?.sentences.find((sentence) => getNarratableSentenceText(sentence.text, accessibilityConfig.textFilters));
    if (!firstSentence) {
      return;
    }

    onJumpTo(pIdx, firstSentence.index);
    onUpdateProgress(pIdx, firstSentence.index);
    setToolbarSelection(null);
  };

  // Place highlight
  const executeHighlight = () => {
    if (!toolbarSelection) return;
    selectedHighlightIds.forEach((highlightId) => onRemoveHighlight(highlightId));
    onAddHighlight({
      documentId: document.id,
      paragraphIndex: toolbarSelection.startParagraphIndex,
      sentenceIndex: toolbarSelection.startSentenceIndex,
      endParagraphIndex: toolbarSelection.endParagraphIndex,
      endSentenceIndex: toolbarSelection.endSentenceIndex,
      text: toolbarSelection.text,
      color: highlightColor,
      note: noteInput.trim() || undefined,
    });
    setToolbarSelection(null);
    setNoteInput("");
    setAddingNote(false);
    setPopupMode("toolbar");
  };

  const handleCopySelection = async () => {
    if (!toolbarSelection) return;
    try {
      await navigator.clipboard.writeText(toolbarSelection.text);
      setCopiedFlash(true);
      setTimeout(() => setCopiedFlash(false), 1200);
    } catch {
      // fallback
    }
  };

  const handlePinSelection = () => {
    if (!toolbarSelection) return;
    onAddBookmark({
      documentId: document.id,
      paragraphIndex: toolbarSelection.startParagraphIndex,
      sentenceIndex: toolbarSelection.startSentenceIndex,
      label: toolbarSelection.text.slice(0, 40) + (toolbarSelection.text.length > 40 ? "..." : ""),
    });
    setToolbarSelection(null);
    setPopupMode("toolbar");
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
    const sentenceText = filterReadableText(s.text, accessibilityConfig.textFilters);
    if (!sentenceText) {
      return null;
    }

    const isHighlighted = highlights.find(
      (highlight) =>
        isCursorWithinRange(
          { paragraphIndex: pIdx, sentenceIndex: s.index },
          getHighlightRange(highlight).start,
          getHighlightRange(highlight).end,
        )
    );

    const bionicWords = sentenceText.split(" ").map((w, idx) => parseBionicWord(w, idx));

    return (
      <span
        ref={isFocused ? activeSentenceRef : null}
        key={s.id}
        data-paragraph-index={pIdx}
        data-sentence-index={s.index}
        onClick={(event) => {
          event.stopPropagation();
          handleSentenceClick(pIdx, s.index);
        }}
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
                      const chapterCursor = findNarratableCursor(ch.paragraphIndex, 0, { includeCurrent: true }) || {
                        paragraphIndex: ch.paragraphIndex,
                        sentenceIndex: 0,
                      };
                      onJumpTo(chapterCursor.paragraphIndex, chapterCursor.sentenceIndex);
                      onUpdateProgress(chapterCursor.paragraphIndex, chapterCursor.sentenceIndex);
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
          {!isSelectedVoiceReady && (
            <div className="w-full max-w-[65ch] mb-8 p-5 rounded-2xl border bg-white dark:bg-zinc-950 shadow-sm border-amber-200/50 dark:border-amber-900/40 text-left space-y-3.5 relative z-10">
              <div className="flex items-center gap-2">
                <span className="p-1 px-2 rounded text-[9px] uppercase tracking-wider font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono">
                  🎙️ Audio Offline
                </span>
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Speech narration is not preloaded for this voice yet
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                {generatedVoiceLabel && document.audioProfile?.voiceId !== selectedVoice
                  ? `This book is currently preloaded for ${generatedVoiceLabel}. Generate again to switch the whole-book cache to ${selectedVoiceLabel}.`
                  : "Generate the full Kokoro audio map once, then you can jump to any paragraph and start playback from there without waiting on live synthesis."}
              </p>
              {document.processingStatus === "processing" ? (
                <div className="p-3.5 bg-teal-50 dark:bg-teal-950/25 rounded-xl text-teal-700 dark:text-teal-400 border border-teal-200/50 dark:border-teal-900/30 space-y-1.5">
                  <div className="flex items-center gap-2 animate-pulse font-bold text-xs">
                    <Loader2 className="w-4 h-4 animate-spin text-teal-600 dark:text-teal-400" />
                    <span>{localPct}% Complete - Preloading Kokoro speech blocks...</span>
                  </div>
                  <p className="text-[10px] opacity-80 leading-snug font-mono">
                    {localStep || "Allocating synthesis partitions..."}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {document.processingStatus === "failed" && localStep ? (
                    <p className="text-xs text-rose-600 dark:text-rose-400 leading-relaxed">
                      {localStep}
                    </p>
                  ) : null}
                  <button
                    onClick={() => handleTriggerReaderSynthesis()}
                    className="py-2.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 active:scale-97 text-white font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 shadow animate-pulse cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4 text-amber-203" />
                    {generatedVoiceLabel && document.audioProfile?.voiceId !== selectedVoice
                      ? "Generate Selected Voice Audio"
                      : document.processingStatus === "failed"
                      ? "Retry Whole-Book Kokoro Audio"
                      : "Generate Whole-Book Kokoro Audio"}
                  </button>
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
                  <div
                    key={p.id}
                    onClick={() => handleParagraphClick(pIdx)}
                    className="w-full bg-zinc-900 border border-zinc-800 dark:border-white/5 rounded-xl p-4 my-6 font-mono text-[13px] leading-relaxed shadow-inner overflow-x-auto relative group/code text-zinc-100 cursor-pointer"
                  >
                    <div className="absolute top-2 right-2 flex gap-1.5 items-center select-none opacity-0 group-hover/code:opacity-100 transition-opacity">
                      <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">{codeLang || "code"}</span>
                      <button 
                        onClick={(event) => {
                          event.stopPropagation();
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
                  <div key={p.id} className={`${headingClasses} cursor-pointer`} onClick={() => handleParagraphClick(pIdx)}>
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
                  <div key={p.id} className="flex gap-3 pl-4 items-start select-text leading-relaxed py-0.5 cursor-pointer" onClick={() => handleParagraphClick(pIdx)}>
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
                  <blockquote key={p.id} className="border-l-4 border-teal-500/50 dark:border-teal-400/40 pl-4 py-1.5 my-4 italic text-gray-600 dark:text-zinc-400 select-text max-w-[65ch] w-full cursor-pointer" onClick={() => handleParagraphClick(pIdx)}>
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
                <p key={p.id} className="leading-relaxed text-gray-800 dark:text-gray-250 select-text cursor-pointer" onClick={() => handleParagraphClick(pIdx)}>
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
              className="selection-popup absolute rounded-2xl p-3 shadow-2xl z-50 flex flex-col gap-2 select-none animate-fade-in-up"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              style={{
                left: `${Math.max(12, Math.min(toolbarSelection.clientX - 130, (readerColumnRef.current?.clientWidth || 500) - 260))}px`,
                top: `${Math.max(12, toolbarSelection.clientY - (popupMode === "colors" ? 140 : popupMode === "note" ? 180 : 105))}px`,
                backgroundColor: "var(--surface-elevated)",
                border: "1px solid var(--border-default)",
                width: popupMode === "colors" ? "240px" : popupMode === "note" ? "240px" : "260px",
                boxShadow: "0 12px 40px var(--shadow-elevated)",
              }}
            >
              {/* ─── TOOLBAR VIEW ─── */}
              {popupMode === "toolbar" && (
                <div className="flex items-center justify-around py-1">
                  {/* Highlight */}
                  <button
                    onClick={() => setPopupMode("colors")}
                    className="flex flex-col items-center gap-1.5 min-w-[44px] group"
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center transition-transform group-hover:scale-110"
                      style={{ backgroundColor: "#E8D87D" }}>
                      <Highlighter className="w-4 h-4" style={{ color: "#5A5020" }} />
                    </div>
                    <span className="text-[10px] font-semibold" style={{ color: "var(--ink-secondary)" }}>
                      Highlight
                    </span>
                  </button>

                  {/* Look Up */}
                  <button
                    onClick={() => {
                      toggleRightSidebar();
                      setToolbarSelection(null);
                      setPopupMode("toolbar");
                    }}
                    className="flex flex-col items-center gap-1.5 min-w-[44px] group"
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center transition-all group-hover:scale-110"
                      style={{ backgroundColor: "var(--surface-hover)" }}>
                      <Search className="w-4 h-4" style={{ color: "var(--ink-primary)" }} />
                    </div>
                    <span className="text-[10px] font-semibold" style={{ color: "var(--ink-secondary)" }}>
                      Look Up
                    </span>
                  </button>

                  {/* Note */}
                  <button
                    onClick={() => setPopupMode("note")}
                    className="flex flex-col items-center gap-1.5 min-w-[44px] group"
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center transition-all group-hover:scale-110"
                      style={{ backgroundColor: "var(--surface-hover)" }}>
                      <FileText className="w-4 h-4" style={{ color: "var(--ink-primary)" }} />
                    </div>
                    <span className="text-[10px] font-semibold" style={{ color: "var(--ink-secondary)" }}>
                      Note
                    </span>
                  </button>

                  {/* Copy */}
                  <button
                    onClick={handleCopySelection}
                    className="flex flex-col items-center gap-1.5 min-w-[44px] group relative"
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center transition-all group-hover:scale-110"
                      style={{ backgroundColor: "var(--surface-hover)" }}>
                      <Copy className="w-4 h-4" style={{ color: "var(--ink-primary)" }} />
                    </div>
                    <span className="text-[10px] font-semibold" style={{ color: "var(--ink-secondary)" }}>
                      {copiedFlash ? "Copied!" : "Copy"}
                    </span>
                  </button>

                  {/* Pin */}
                  <button
                    onClick={handlePinSelection}
                    className="flex flex-col items-center gap-1.5 min-w-[44px] group"
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center transition-all group-hover:scale-110"
                      style={{ backgroundColor: "var(--surface-hover)" }}>
                      <Pin className="w-4 h-4" style={{ color: "var(--ink-primary)" }} />
                    </div>
                    <span className="text-[10px] font-semibold" style={{ color: "var(--ink-secondary)" }}>
                      Pin
                    </span>
                  </button>

                  {/* Unhighlight (only if selection is already highlighted) */}
                  {selectedHighlightIds.length > 0 && (
                    <button
                      onClick={handleRemoveSelectedHighlights}
                      className="flex flex-col items-center gap-1.5 min-w-[44px] group"
                    >
                      <div className="w-9 h-9 rounded-full flex items-center justify-center transition-all group-hover:scale-110"
                        style={{ backgroundColor: "rgba(184, 84, 80, 0.1)" }}>
                        <RotateCcw className="w-4 h-4" style={{ color: "var(--status-failed)" }} />
                      </div>
                      <span className="text-[10px] font-semibold" style={{ color: "var(--status-failed)" }}>
                        Remove
                      </span>
                    </button>
                  )}
                </div>
              )}

              {/* ─── COLOR PICKER VIEW ─── */}
              {popupMode === "colors" && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPopupMode("toolbar")}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: "var(--ink-muted)" }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--surface-hover)"}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-semibold" style={{ color: "var(--ink-primary)" }}>
                      Choose color
                    </span>
                  </div>
                  <div className="flex items-center justify-around py-1">
                    {[
                      { name: "Aqua", class: "bg-[#7EC8C8]/25 border-l-2 border-[#7EC8C8]", dot: "#7EC8C8" },
                      { name: "Pink", class: "bg-[#E8A0A0]/25 border-l-2 border-[#E8A0A0]", dot: "#E8A0A0" },
                      { name: "Orange", class: "bg-[#E8B87D]/25 border-l-2 border-[#E8B87D]", dot: "#E8B87D" },
                      { name: "Yellow", class: "bg-[#E8D87D]/25 border-l-2 border-[#E8D87D]", dot: "#E8D87D" },
                      { name: "Green", class: "bg-[#7EC88A]/25 border-l-2 border-[#7EC88A]", dot: "#7EC88A" },
                    ].map((col) => (
                      <button
                        key={col.name}
                        onClick={() => handleColorHighlightSelect(col.class)}
                        className="flex flex-col items-center gap-1.5 min-w-[36px] group"
                      >
                        <div
                          className="w-8 h-8 rounded-full border-2 transition-all group-hover:scale-110 group-active:scale-95"
                          style={{
                            backgroundColor: col.dot,
                            borderColor: `${col.dot}80`,
                          }}
                        />
                        <span className="text-[9px] font-medium" style={{ color: "var(--ink-secondary)" }}>
                          {col.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ─── NOTE INPUT VIEW ─── */}
              {popupMode === "note" && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPopupMode("toolbar")}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: "var(--ink-muted)" }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--surface-hover)"}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-semibold" style={{ color: "var(--ink-primary)" }}>
                      Add note
                    </span>
                  </div>
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Enter your note..."
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-xs border focus:outline-none transition-colors"
                      style={{
                        backgroundColor: "var(--surface-page)",
                        borderColor: "var(--border-strong)",
                        color: "var(--ink-primary)",
                      }}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setPopupMode("toolbar");
                          setNoteInput("");
                        }}
                        className="flex-1 py-2 rounded-xl text-[11px] font-medium border transition-all"
                        style={{
                          backgroundColor: "transparent",
                          borderColor: "var(--border-strong)",
                          color: "var(--ink-secondary)",
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={executeHighlight}
                        className="flex-1 py-2 rounded-xl text-[11px] font-semibold text-white transition-all"
                        style={{ backgroundColor: "var(--accent)" }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--accent-hover)"}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "var(--accent)"}
                      >
                        Save
                      </button>
                    </div>
                  </div>
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
                  if (!isSelectedVoiceReady) {
                    alert("Generate the full-book Kokoro audio for the selected voice before pressing play.");
                    return;
                  }
                  setIsPlaying(!isPlaying);
                }}
                disabled={audioLoading || (document.processingStatus === "processing")}
                className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-all hover:scale-105 ${
                  !isSelectedVoiceReady
                    ? "bg-gray-200 dark:bg-zinc-800 text-gray-400 dark:text-zinc-650 cursor-not-allowed"
                    : "bg-teal-600 hover:bg-teal-500 text-white"
                }`}
                title={!isSelectedVoiceReady ? "Generate Kokoro audio to activate playback" : "Narrate"}
              >
                {audioLoading ? (
                  <span className="w-4 h-4 rounded-full border-2 border-t-transparent border-teal-500 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-5 h-5 fill-white" />
                ) : (
                  <Play className={`w-5 h-5 ${!isSelectedVoiceReady ? "fill-gray-400 text-gray-400" : "fill-white text-white translate-x-0.5"}`} />
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
                disabled={document.processingStatus === "processing"}
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
