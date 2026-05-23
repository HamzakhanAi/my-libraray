/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Word {
  text: string;
  index: number;
}

export interface Sentence {
  id: string;
  text: string;
  index: number;
  words?: Word[];
}

export interface Paragraph {
  id: string;
  text: string;
  index: number;
  sentences: Sentence[];
}

export interface Chapter {
  id: string;
  title: string;
  startParagraphId: string;
  paragraphIndex: number;
}

export interface AudioProfile {
  voiceId: string;
  generatedAt: string;
  segmentCount: number;
  textFilterKey?: string;
}

export interface TextFilterConfig {
  skipRoundBrackets: boolean;
  skipSquareBrackets: boolean;
  skipCurlyBrackets: boolean;
  skipUrls: boolean;
  skipSuperscriptSubscript: boolean;
  skipVerticalText: boolean;
}

export interface Document {
  id: string;
  title: string;
  author: string;
  coverUrl?: string;
  paragraphs: Paragraph[];
  chapters: Chapter[];
  progress: {
    paragraphIndex: number;
    sentenceIndex: number;
    updatedAt: string;
  };
  durationMinutes: number;
  wordCount: number;
  processingStatus: "unprocessed" | "ready" | "processing" | "failed";
  audioProfile?: AudioProfile | null;
}

export interface Highlight {
  id: string;
  documentId: string;
  paragraphIndex: number;
  sentenceIndex: number;
  endParagraphIndex?: number;
  endSentenceIndex?: number;
  text: string;
  color: string; // Tailwind bg color class
  note?: string;
  createdAt: string;
}

export interface Bookmark {
  id: string;
  documentId: string;
  paragraphIndex: number;
  sentenceIndex: number;
  label: string;
  createdAt: string;
}

export interface Voice {
  id: string;
  name: string;
  gender: "male" | "female" | "neutral";
  description: string;
}

export interface AIThreadMessage {
  id: string;
  role: "user" | "model";
  content: string;
  createdAt: string;
}
