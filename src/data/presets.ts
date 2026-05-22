/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Document, Paragraph, Sentence, Chapter } from "../types";

// Helper to generate IDs
function makeId(): string {
  return Math.random().toString(36).substring(2, 9);
}

// A simple but highly robust regex-based sentence segmenter
export function segmentSentences(text: string): Sentence[] {
  const matches = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
  return matches.map((match, index) => {
    const sText = match.trim();
    // Generate word bboxes/words if needed, otherwise keep it simple
    const words = sText.split(/\s+/).map((word, wIdx) => ({
      text: word.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ""),
      index: wIdx,
    }));
    return {
      id: makeId(),
      text: sText,
      index,
      words,
    };
  });
}

// Helper to clean MD formatting for inline styles
export function cleanMarkdownInline(rawText: string): string {
  let text = rawText;
  
  // 1. Remove inline backticks `code` -> code
  text = text.replace(/`([^`\n]+)`/g, "$1");

  // 2. Remove strong/emphasis markdown formats **bold** etc.
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/\*([^*:\n]+)\*/g, "$1");
  text = text.replace(/_([^_:\n]+)_/g, "$1");

  // 3. Remove Markdown links [text](url) -> text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  return text;
}

// Full document processing pipeline
export function processRawText(
  title: string,
  author: string,
  rawText: string,
  coverUrl?: string
): Document {
  // Normalize line endings
  const normalized = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  
  // Split into raw paragraphs (delimited by double newlines)
  const rawParagraphs = normalized.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  
  const paragraphs: Paragraph[] = [];
  const chapters: Chapter[] = [];
  
  let currentChapterParagraphIndex = 0;
  let chCount = 1;

  rawParagraphs.forEach((pText, pIdx) => {
    const isCode = pText.startsWith("```");
    const isHeader = pText.startsWith("#");

    // Check if paragraph is a header (like CHAPTER I, Chapter 1, markdown headers)
    const isChapterHeader = 
      isHeader ||
      pText.toUpperCase().startsWith("CHAPTER") || 
      /^(I+|V|X|L|C|D|M)+\.?\s*$/i.test(pText) ||
      (pText.length < 50 && /^[0-9]+\.\s+[A-Z]/.test(pText)) ||
      (pText.length < 40 && pIdx === 0);

    if (isChapterHeader) {
      const cleanTitle = pText.replace(/^#+\s*/, "");
      chapters.push({
        id: makeId(),
        title: cleanTitle,
        startParagraphId: `p-${pIdx + 1}`, // will be the next text paragraph
        paragraphIndex: Math.min(pIdx + 1, rawParagraphs.length - 1)
      });
      chCount++;
    }

    // Isolate and clean the sentences inside the paragraph
    let sentences: Sentence[] = [];
    if (isCode) {
      // Treat code block as a single consolidated block sentence to avoid splitting on programming structures
      const cleanedCode = pText.replace(/^```[a-zA-Z0-9]*\n?/, "").replace(/\n?```$/, "");
      sentences = [{
        id: makeId(),
        text: cleanedCode,
        index: 0,
        words: cleanedCode.split(/\s+/).map((w, wIdx) => ({
          text: w.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ""),
          index: wIdx
        }))
      }];
    } else {
      // Normal sentence segmentation - preserve inline markdown formatting (e.g. bold, italics, inline code)
      sentences = segmentSentences(pText);
    }

    paragraphs.push({
      id: `p-${pIdx}`,
      text: pText,
      index: pIdx,
      sentences,
    });
  });

  // Ensure there is at least one chapter
  if (chapters.length === 0) {
    chapters.push({
      id: makeId(),
      title: "Introduction",
      startParagraphId: paragraphs[0]?.id || "p-0",
      paragraphIndex: 0,
    });
  }

  // Adjust any chapters whose start Paragraph IDs might be headers
  chapters.forEach(ch => {
    if (ch.paragraphIndex >= paragraphs.length) {
      ch.paragraphIndex = paragraphs.length - 1;
    }
    ch.startParagraphId = paragraphs[ch.paragraphIndex]?.id || "p-0";
  });

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  // Estimate reading/tts duration at 160 WPM
  const durationMinutes = Math.max(1, Math.round(wordCount / 160));

  return {
    id: makeId(),
    title,
    author,
    coverUrl,
    paragraphs,
    chapters,
    progress: {
      paragraphIndex: 0,
      sentenceIndex: 0,
      updatedAt: new Date().toISOString(),
    },
    wordCount,
    durationMinutes,
    processingStatus: "unprocessed",
  };
}

// 3 Curated Preset Documents
export const PRESET_BOOKS_RAW = [
  {
    title: "The Metamorphosis",
    author: "Franz Kafka",
    coverUrl: "",
    text: `CHAPTER I

One morning, when Gregor Samsa woke from troubled dreams, he found himself transformed in his bed into a horrible vermin. He lay on his armour-like back, and if he lifted his head a little he could see his brown belly, slightly domed and divided by arches into stiff sections. The bedding was hardly able to cover it and seemed ready to slide off any moment. His many legs, pitifully thin compared with the size of the rest of him, waved helplessly before his eyes.

"What's happened to me?" he thought. It wasn't a dream. His room, a proper human room although a little too small, lay peacefully between its four familiar walls. A collection of textile samples lay spread out on the table—Samsa was a travelling salesman—and above it there hung a picture that he had recently cut out of an illustrated magazine and housed in a nice, gilded frame. It showed a lady fitted out with a fur hat and fur boa who sat upright, raising a heavy fur muff that covered the whole of her lower arm towards the viewer.

Gregor then turned to look out the window at the dull weather. Drops of rain could be heard hitting the pane, which made him feel quite sad. "How about if I sleep a little bit longer and forget all this nonsense?" he thought, but that was something he was unable to do because he was used to sleeping on his right, and in his present state he couldn't get into that position. However hard he threw himself onto his right, he always rolled back to where he was. He must have tried it a hundred times, shut his eyes so that he wouldn't have to look at the floundering legs, and only stopped when he began to feel a mild, dull pain there that he had never felt before.

"Oh, God", he thought, "what a strenuous career it is that I've chosen! Travelling day in and day out. Doing business like this takes much more effort than doing your own business at home, and on top of that there's the curse of travelling, worries about making train connections, bad and irregular food, contact with different people all the time so that you can never establish any warm, lasting relationship. To hell with it all!"

CHAPTER II

It was not until to-the-evening that Gregor woke from his heavy, swoon-like sleep. He would have woken up not much later anyway, even without any disturbance, as he felt himself sufficiently rested and slept off, but it seemed to him as if a hurried step and a cautious shutting of the door to the hall had awakened him. The brightness of the electric streetlamps cast pale reflections here and there on the ceiling and on the upper parts of the furniture, but down where Gregor lay it was dark.

Slowly, and still awkwardly feeling his way with his feelers, which he only now learned to value, he crept towards the door to see what had been happening there. His left side seemed one single long, unpleasantly contracting scar, and he had to limp on his two rows of legs. One little leg, moreover, had been seriously injured in the course of the morning's occurrences—it was almost a miracle that only one had been hurt—and it dragged along lifelessly.

Only at the door did he realize what had really attracted him there; it was the smell of something to eat. For there stood a bowl of sweet milk, in which floated small pieces of white bread. He could almost have laughed with joy, for he was even hungrier than he had been in the morning, and he immediately dipped his head into the milk, almost up to his eyes. But he soon drew it back again in disappointment; not only did he find it difficult to eat because of his sore left side—and he could only eat if his whole panting body worked together—but the milk, which had always been his favorite drink, did not taste good to him at all.`
  },
  {
    title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    coverUrl: "",
    text: `CHAPTER I. Down the Rabbit-Hole

Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, "and what is the use of a book," thought Alice "without pictures or conversations?"

So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.

There was nothing so VERY remarkable in that; nor did Alice think it so VERY much out of the way to hear the Rabbit say to itself, "Oh dear! Oh dear! I shall be late!" (when she thought it over afterwards, it occurred to her that she ought to have wondered at this, but at the time it all seemed quite natural); but when the Rabbit actually TOOK A WATCH OUT OF ITS WAISTCOAT-POCKET, and looked at it, and then hurried on, Alice started to her feet, for it flashed across her mind that she had never before seen a rabbit with either a waistcoat-pocket, or a watch to take out of it, and burning with curiosity, she ran across the field after it, and fortunately was just in time to see it pop down a large rabbit-hole under the hedge.

In another moment down went Alice after it, never once considering how in the world she was to get out again.

The rabbit-hole went straight on like a tunnel for some way, and then dipped suddenly down, so suddenly that Alice had not a moment to think about stopping herself before she found herself falling down a very deep well.

Either the well was very deep, or she fell very slowly, for she had plenty of time as she went down to look about her and to wonder what was going to happen next. First, she tried to look down and make out what she was coming to, but it was too dark to see anything; then she looked at the sides of the well, and noticed that they were filled with cupboards and book-shelves; here and there she saw maps and pictures hung upon pegs. She took down a jar from one of the shelves as she passed; it was labelled "ORANGE MARMALADE", but to her great disappointment it was empty.`
  },
  {
    title: "The Art of War",
    author: "Sun Tzu",
    coverUrl: "",
    text: `CHAPTER I. Laying Plans

Sun Tzu said: The art of war is of vital importance to the State. It is a matter of life and death, a road either to safety or to ruin. Hence it is a subject of inquiry which can on no account be neglected.

The art of war, then, is governed by five constant factors, to be taken into account in one's deliberations, when seeking to determine the conditions obtaining in the field. These are: The Moral Law; Heaven; Earth; The Commander; Method and discipline.

The Moral Law causes the people to be in complete accord with their ruler, so that they will follow him regardless of their lives, undismayed by any danger.

Heaven signifies night and day, cold and heat, times and seasons.

Earth comprises distances, great and small; danger and security; open ground and narrow passes; the chances of life and death.

The Commander stands for the virtues of wisdom, sincerely, benevolence, courage and strictness.

Method and discipline are to be understood the marshaling of the army in its proper subdivisions, the gradations of rank among the officers, the maintenance of roads by which supplies may reach the army, and the control of military expenditure.

These five heads should be familiar to every general: he who knows them will be victorious; he who knows them not will fail.`
  }
];

export function getPresetBooks(): Document[] {
  return PRESET_BOOKS_RAW.map(b => processRawText(b.title, b.author, b.text, b.coverUrl));
}
