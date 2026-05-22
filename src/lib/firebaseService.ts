/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot
} from "firebase/firestore";
import { db } from "../firebase";
import { Document, Highlight, Bookmark } from "../types";

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  };
}

// Global robust error parser matching security rules skill specification
export function handleFirestoreError(
  error: unknown, 
  operationType: OperationType, 
  path: string | null,
  userId: string | undefined,
  email: string | null | undefined
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: userId || null,
      email: email || null,
      emailVerified: true // Set up Google pop-up logins are default-verified
    }
  };
  console.error("[Firestore Security Guard Triggered]:", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// 1. Cloud Books Storage Helpers
export async function saveBookToCloud(userId: string, userEmail: string, book: Document) {
  const path = `users/${userId}/books/${book.id}`;
  try {
    const docRef = doc(db, `users/${userId}/books`, book.id);
    await setDoc(docRef, {
      id: book.id,
      title: book.title,
      author: book.author,
      paragraphs: book.paragraphs || [],
      chapters: book.chapters || [],
      progress: {
        paragraphIndex: book.progress?.paragraphIndex || 0,
        sentenceIndex: book.progress?.sentenceIndex || 0
      },
      durationMinutes: book.durationMinutes || 0,
      wordCount: book.wordCount || 0,
      processingStatus: book.processingStatus || "unprocessed",
      audioProfile: book.audioProfile
        ? {
            voiceId: book.audioProfile.voiceId,
            generatedAt: book.audioProfile.generatedAt,
            segmentCount: book.audioProfile.segmentCount,
          }
        : null,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path, userId, userEmail);
  }
}

export async function deleteBookFromCloud(userId: string, userEmail: string, bookId: string) {
  const path = `users/${userId}/books/${bookId}`;
  try {
    const docRef = doc(db, `users/${userId}/books`, bookId);
    await deleteDoc(docRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path, userId, userEmail);
  }
}

// 2. Cloud Highlights & User Notes Storage Helpers
export async function saveHighlightToCloud(userId: string, userEmail: string, h: Highlight) {
  const path = `users/${userId}/highlights/${h.id}`;
  try {
    const docRef = doc(db, `users/${userId}/highlights`, h.id);
    await setDoc(docRef, {
      id: h.id,
      documentId: h.documentId,
      paragraphIndex: h.paragraphIndex,
      sentenceIndex: h.sentenceIndex,
      endParagraphIndex: h.endParagraphIndex ?? h.paragraphIndex,
      endSentenceIndex: h.endSentenceIndex ?? h.sentenceIndex,
      text: h.text,
      color: h.color,
      note: h.note || null,
      createdAt: h.createdAt
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path, userId, userEmail);
  }
}

export async function deleteHighlightFromCloud(userId: string, userEmail: string, highlightId: string) {
  const path = `users/${userId}/highlights/${highlightId}`;
  try {
    const docRef = doc(db, `users/${userId}/highlights`, highlightId);
    await deleteDoc(docRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path, userId, userEmail);
  }
}

// 3. Cloud Bookmarks Storage Helpers
export async function saveBookmarkToCloud(userId: string, userEmail: string, b: Bookmark) {
  const path = `users/${userId}/bookmarks/${b.id}`;
  try {
    const docRef = doc(db, `users/${userId}/bookmarks`, b.id);
    await setDoc(docRef, {
      id: b.id,
      documentId: b.documentId,
      paragraphIndex: b.paragraphIndex,
      sentenceIndex: b.sentenceIndex,
      label: b.label,
      createdAt: b.createdAt
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path, userId, userEmail);
  }
}

export async function deleteBookmarkFromCloud(userId: string, userEmail: string, bookmarkId: string) {
  const path = `users/${userId}/bookmarks/${bookmarkId}`;
  try {
    const docRef = doc(db, `users/${userId}/bookmarks`, bookmarkId);
    await deleteDoc(docRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path, userId, userEmail);
  }
}

// 4. Listeners setup for real-time cloud sync
export function listenToUserCollection<T>(
  userId: string,
  collectionName: "books" | "highlights" | "bookmarks",
  userEmail: string,
  onUpdate: (items: T[]) => void,
  onError: (err: any) => void
) {
  const path = `users/${userId}/${collectionName}`;
  const colRef = collection(db, "users", userId, collectionName);
  
  return onSnapshot(
    colRef,
    (snapshot) => {
      const items: any[] = [];
      snapshot.forEach((doc) => {
        items.push(doc.data());
      });
      onUpdate(items as T[]);
    },
    (err) => {
      console.error(`Error loading cloud ${collectionName}:`, err);
      onError(err);
    }
  );
}
