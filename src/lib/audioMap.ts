import { Document, TextFilterConfig } from "../types";
import { buildTextFilterKey, filterReadableText } from "./textFilters";

export const DEFAULT_KOKORO_VOICE = "af_sarah";

const AUDIO_DB_NAME = "lumen-reader-audio-cache";
const AUDIO_STORE_NAME = "kokoro-segments";
const AUDIO_DB_VERSION = 1;
const DEFAULT_BATCH_SIZE = 8;
const THEMATIC_BREAK_PATTERN = /^\s{0,3}(?:[-*_]\s*){3,}$/;
const TABLE_DIVIDER_PATTERN = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;
const HAS_NARRATABLE_CONTENT_PATTERN = /[\p{L}\p{N}]/u;

export type NarrationSegment = {
  id: string;
  paragraphIndex: number;
  sentenceIndex: number;
  text: string;
};

type CachedAudioRecord = {
  cacheKey: string;
  documentVoiceKey: string;
  documentId: string;
  voiceId: string;
  textFilterKey: string;
  segmentId: string;
  paragraphIndex: number;
  sentenceIndex: number;
  audioBase64: string;
  updatedAt: string;
};

type TtsBatchResult = {
  id: string;
  audio: string;
};

export type AudioPreloadProgress = {
  completed: number;
  total: number;
  pct: number;
  step: string;
};

export type AudioPreloadResult = {
  voiceId: string;
  segmentCount: number;
  textFilterKey: string;
};

let audioDbPromise: Promise<IDBDatabase> | null = null;

export function getNarratableSentenceText(rawText: string, textFilters?: TextFilterConfig) {
  let text = rawText.trim();
  if (!text) {
    return "";
  }

  if (THEMATIC_BREAK_PATTERN.test(text) || TABLE_DIVIDER_PATTERN.test(text)) {
    return "";
  }

  text = text
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/^[*+-]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^\[(?: |x|X)\]\s+/, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*:\n]+)\*/g, "$1")
    .replace(/_([^_:\n]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  text = filterReadableText(text, textFilters);

  if (!HAS_NARRATABLE_CONTENT_PATTERN.test(text)) {
    return "";
  }

  return text;
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function transactionToPromise(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
  });
}

function openAudioDb() {
  if (audioDbPromise) {
    return audioDbPromise;
  }

  audioDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(AUDIO_DB_NAME, AUDIO_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(AUDIO_STORE_NAME)
        ? request.transaction?.objectStore(AUDIO_STORE_NAME)
        : db.createObjectStore(AUDIO_STORE_NAME, { keyPath: "cacheKey" });

      if (store && !store.indexNames.contains("documentVoiceKey")) {
        store.createIndex("documentVoiceKey", "documentVoiceKey", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open audio cache."));
  });

  return audioDbPromise;
}

function buildSegmentId(paragraphIndex: number, sentenceIndex: number) {
  return `${paragraphIndex}:${sentenceIndex}`;
}

function buildDocumentVoiceKey(documentId: string, voiceId: string, textFilterKey: string) {
  return `${documentId}:${voiceId}:${textFilterKey}`;
}

function buildCacheKey(documentId: string, voiceId: string, textFilterKey: string, segmentId: string) {
  return `${documentId}:${voiceId}:${textFilterKey}:${segmentId}`;
}

function toPct(completed: number, total: number) {
  if (total === 0) {
    return 100;
  }
  return Math.min(100, Math.round((completed / total) * 100));
}

function toDataUrl(audioBase64: string) {
  return `data:audio/wav;base64,${audioBase64}`;
}

async function listCachedKeys(documentId: string, voiceId: string, textFilterKey: string) {
  const db = await openAudioDb();
  const transaction = db.transaction(AUDIO_STORE_NAME, "readonly");
  const index = transaction.objectStore(AUDIO_STORE_NAME).index("documentVoiceKey");
  const keys = await requestToPromise(index.getAllKeys(buildDocumentVoiceKey(documentId, voiceId, textFilterKey)) as IDBRequest<IDBValidKey[]>);
  return new Set(keys.map((key) => String(key)));
}

async function persistBatch(documentId: string, voiceId: string, textFilterKey: string, segments: NarrationSegment[], results: TtsBatchResult[]) {
  const db = await openAudioDb();
  const transaction = db.transaction(AUDIO_STORE_NAME, "readwrite");
  const store = transaction.objectStore(AUDIO_STORE_NAME);
  const documentVoiceKey = buildDocumentVoiceKey(documentId, voiceId, textFilterKey);
  const now = new Date().toISOString();
  const segmentsById = new Map(segments.map((segment) => [segment.id, segment]));

  for (const result of results) {
    const segment = segmentsById.get(result.id);
    if (!segment || !result.audio) {
      continue;
    }

    const record: CachedAudioRecord = {
      cacheKey: buildCacheKey(documentId, voiceId, textFilterKey, segment.id),
      documentVoiceKey,
      documentId,
      voiceId,
      textFilterKey,
      segmentId: segment.id,
      paragraphIndex: segment.paragraphIndex,
      sentenceIndex: segment.sentenceIndex,
      audioBase64: result.audio,
      updatedAt: now,
    };

    store.put(record);
  }

  await transactionToPromise(transaction);
}

async function requestBatchFromServer(segments: NarrationSegment[], voiceId: string, speed: number) {
  const response = await fetch("/api/tts/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      voiceName: voiceId,
      speed,
      segments: segments.map(({ id, text }) => ({ id, text })),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || "Kokoro batch synthesis failed.");
  }

  const results = Array.isArray(data.audios) ? (data.audios as TtsBatchResult[]) : [];
  if (results.length !== segments.length) {
    throw new Error("Kokoro returned an incomplete audio batch.");
  }

  return results;
}

export function getDocumentNarrationSegments(document: Document, textFilters?: TextFilterConfig) {
  const segments: NarrationSegment[] = [];

  document.paragraphs.forEach((paragraph, paragraphIndex) => {
    paragraph.sentences.forEach((sentence, sentenceIndex) => {
      const text = getNarratableSentenceText(sentence.text, textFilters);
      if (!text) {
        return;
      }

      segments.push({
        id: buildSegmentId(paragraphIndex, sentenceIndex),
        paragraphIndex,
        sentenceIndex,
        text,
      });
    });
  });

  return segments;
}

export async function preloadDocumentAudio({
  document,
  voiceId = DEFAULT_KOKORO_VOICE,
  speed = 1,
  batchSize = DEFAULT_BATCH_SIZE,
  textFilters,
  signal,
  onProgress,
}: {
  document: Document;
  voiceId?: string;
  speed?: number;
  batchSize?: number;
  textFilters?: TextFilterConfig;
  signal?: AbortSignal;
  onProgress?: (progress: AudioPreloadProgress) => void;
}): Promise<AudioPreloadResult> {
  const textFilterKey = buildTextFilterKey(textFilters);
  const segments = getDocumentNarrationSegments(document, textFilters);
  const total = segments.length;

  if (total === 0) {
    onProgress?.({
      completed: 0,
      total: 0,
      pct: 100,
      step: "No narratable text was found in this book.",
    });
    return {
      voiceId,
      segmentCount: 0,
      textFilterKey,
    };
  }

  const cachedKeys = await listCachedKeys(document.id, voiceId, textFilterKey);
  let completed = Math.min(cachedKeys.size, total);

  onProgress?.({
    completed,
    total,
    pct: toPct(completed, total),
    step: completed > 0
      ? `Loaded ${completed} cached Kokoro segments. Filling the missing narration blocks...`
      : "Starting whole-book Kokoro synthesis...",
  });

  const missingSegments = segments.filter((segment) => !cachedKeys.has(buildCacheKey(document.id, voiceId, textFilterKey, segment.id)));
  if (missingSegments.length === 0) {
    onProgress?.({
      completed: total,
      total,
      pct: 100,
      step: "Whole-book Kokoro audio is already preloaded.",
    });
    return {
      voiceId,
      segmentCount: total,
      textFilterKey,
    };
  }

  const totalBatches = Math.ceil(missingSegments.length / batchSize);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    if (signal?.aborted) {
      throw new DOMException("Audio preload was cancelled.", "AbortError");
    }

    const batch = missingSegments.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);

    onProgress?.({
      completed,
      total,
      pct: toPct(completed, total),
      step: `Synthesizing Kokoro batch ${batchIndex + 1} of ${totalBatches}...`,
    });

    const results = await requestBatchFromServer(batch, voiceId, speed);
    await persistBatch(document.id, voiceId, textFilterKey, batch, results);

    completed = Math.min(total, completed + results.length);
    onProgress?.({
      completed,
      total,
      pct: toPct(completed, total),
      step: `Stored ${completed} of ${total} Kokoro narration segments.`,
    });
  }

  onProgress?.({
    completed: total,
    total,
    pct: 100,
    step: "Whole-book Kokoro audio preload finished.",
  });

  return {
    voiceId,
    segmentCount: total,
    textFilterKey,
  };
}

export async function ensureSentenceAudio({
  document,
  voiceId,
  paragraphIndex,
  sentenceIndex,
  speed = 1,
  textFilters,
}: {
  document: Document;
  voiceId: string;
  paragraphIndex: number;
  sentenceIndex: number;
  speed?: number;
  textFilters?: TextFilterConfig;
}) {
  const textFilterKey = buildTextFilterKey(textFilters);
  const cacheKey = buildCacheKey(document.id, voiceId, textFilterKey, buildSegmentId(paragraphIndex, sentenceIndex));
  const db = await openAudioDb();
  const transaction = db.transaction(AUDIO_STORE_NAME, "readonly");
  const store = transaction.objectStore(AUDIO_STORE_NAME);
  const cachedRecord = await requestToPromise(store.get(cacheKey) as IDBRequest<CachedAudioRecord | undefined>);

  if (cachedRecord?.audioBase64) {
    return toDataUrl(cachedRecord.audioBase64);
  }

  const sentence = document.paragraphs[paragraphIndex]?.sentences[sentenceIndex];
  const text = sentence ? getNarratableSentenceText(sentence.text, textFilters) : "";
  if (!text) {
    throw new Error("This block does not contain narratable text.");
  }

  const segment: NarrationSegment = {
    id: buildSegmentId(paragraphIndex, sentenceIndex),
    paragraphIndex,
    sentenceIndex,
    text,
  };

  const results = await requestBatchFromServer([segment], voiceId, speed);
  const [firstResult] = results;
  if (!firstResult?.audio) {
    throw new Error("Kokoro returned no audio for this sentence.");
  }

  await persistBatch(document.id, voiceId, textFilterKey, [segment], results);
  return toDataUrl(firstResult.audio);
}

export function getDefaultVoiceId(document: Document) {
  return document.audioProfile?.voiceId || DEFAULT_KOKORO_VOICE;
}
