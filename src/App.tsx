/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { BookOpen, Sun, Moon, Cloud, CloudOff, LogIn, LogOut } from "lucide-react";
import { auth } from "./firebase";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";
import {
  saveBookToCloud,
  deleteBookFromCloud,
  saveHighlightToCloud,
  deleteHighlightFromCloud,
  saveBookmarkToCloud,
  deleteBookmarkFromCloud,
  listenToUserCollection
} from "./lib/firebaseService";
import { AudioProfile, Document, Highlight, Bookmark } from "./types";
import { getPresetBooks } from "./data/presets";
import LibraryView from "./components/LibraryView";
import ReaderView from "./components/ReaderView";
import AccessibilitySettings, { AccessibilityConfig } from "./components/AccessibilitySettings";
import AISidebar from "./components/AISidebar";
import { DEFAULT_TEXT_FILTER_CONFIG } from "./lib/textFilters";

const DEFAULT_ACCESSIBILITY_CONFIG: AccessibilityConfig = {
  fontStyle: "serif",
  fontSize: 19,
  lineHeight: 1.65,
  bionicReading: false,
  readingRuler: false,
  rulerPosition: 40,
  textSpacing: "normal",
  textFilters: DEFAULT_TEXT_FILTER_CONFIG,
};

function loadAccessibilityConfig(): AccessibilityConfig {
  try {
    const savedConfig = localStorage.getItem("lumen_accessibility_config");
    if (!savedConfig) {
      return DEFAULT_ACCESSIBILITY_CONFIG;
    }

    const parsed = JSON.parse(savedConfig) as Partial<AccessibilityConfig>;
    return {
      ...DEFAULT_ACCESSIBILITY_CONFIG,
      ...parsed,
      textFilters: {
        ...DEFAULT_TEXT_FILTER_CONFIG,
        ...(parsed.textFilters || {}),
      },
    };
  } catch {
    return DEFAULT_ACCESSIBILITY_CONFIG;
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [books, setBooks] = useState<Document[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [theme, setTheme] = useState<"daylight" | "parchment" | "midnight" | "contrast">("daylight");
  const [accessibilityConfig, setAccessibilityConfig] = useState<AccessibilityConfig>(() => loadAccessibilityConfig());
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [sidebarPanel, setSidebarPanel] = useState<"ai" | "settings">("ai");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      const savedBooks = localStorage.getItem("lumen_library_books");
      if (savedBooks) {
        setBooks(JSON.parse(savedBooks));
      } else {
        const seeds = getPresetBooks();
        setBooks(seeds);
        localStorage.setItem("lumen_library_books", JSON.stringify(seeds));
      }

      const savedHighlights = localStorage.getItem("lumen_library_highlights");
      if (savedHighlights) {
        setHighlights(JSON.parse(savedHighlights));
      } else {
        setHighlights([]);
      }

      const savedBookmarks = localStorage.getItem("lumen_library_bookmarks");
      if (savedBookmarks) {
        setBookmarks(JSON.parse(savedBookmarks));
      } else {
        setBookmarks([]);
      }
      return;
    }

    const unsubBooks = listenToUserCollection<Document>(
      user.uid,
      "books",
      user.email || "",
      (cloudBooks) => {
        if (cloudBooks.length > 0) {
          setBooks(cloudBooks);
        } else {
          const localBooks = books.length > 0 ? books : getPresetBooks();
          localBooks.forEach(async (book) => {
            await saveBookToCloud(user.uid, user.email || "", book);
          });
        }
      },
      (err) => console.error("Cloud books sync failed:", err)
    );

    const unsubHighlights = listenToUserCollection<Highlight>(
      user.uid,
      "highlights",
      user.email || "",
      (cloudHighlights) => {
        setHighlights(cloudHighlights);
      },
      (err) => console.error("Cloud highlights sync failed:", err)
    );

    const unsubBookmarks = listenToUserCollection<Bookmark>(
      user.uid,
      "bookmarks",
      user.email || "",
      (cloudBookmarks) => {
        setBookmarks(cloudBookmarks);
      },
      (err) => console.error("Cloud bookmarks sync failed:", err)
    );

    return () => {
      unsubBooks();
      unsubHighlights();
      unsubBookmarks();
    };
  }, [user]);

  useEffect(() => {
    const savedTheme = localStorage.getItem("lumen_theme");
    if (savedTheme) {
      setTheme(savedTheme as any);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("lumen_accessibility_config", JSON.stringify(accessibilityConfig));
  }, [accessibilityConfig]);

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error("Google authentication trigger error:", err);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Logout trigger error:", err);
    }
  };

  const saveBooks = (updated: Document[] | ((current: Document[]) => Document[])) => {
    setBooks((current) => {
      const next = typeof updated === "function"
        ? (updated as (current: Document[]) => Document[])(current)
        : updated;
      localStorage.setItem("lumen_library_books", JSON.stringify(next));
      return next;
    });
  };

  const handleUploadBook = (newBook: Document) => {
    saveBooks((current) => [newBook, ...current]);
    if (user) {
      saveBookToCloud(user.uid, user.email || "", newBook);
    }
  };

  const handleRemoveBook = (id: string) => {
    saveBooks((current) => current.filter((b) => b.id !== id));
    if (selectedBookId === id) setSelectedBookId(null);
    if (user) {
      deleteBookFromCloud(user.uid, user.email || "", id);
    }
  };

  const handleUpdateProgress = (bookId: string, pIdx: number, sIdx: number) => {
    saveBooks((current) => {
      return current.map((b) => {
        if (b.id === bookId) {
          const docUpdates = {
            ...b,
            progress: {
              paragraphIndex: pIdx,
              sentenceIndex: sIdx,
              updatedAt: new Date().toISOString(),
            },
          };
          if (user) {
            saveBookToCloud(user.uid, user.email || "", docUpdates);
          }
          return docUpdates;
        }
        return b;
      });
    });
  };

  const handleUpdateStatus = (bookId: string, status: "unprocessed" | "processing" | "ready" | "failed") => {
    saveBooks((current) => {
      return current.map((b) => {
        if (b.id === bookId) {
          const docUpdates = {
            ...b,
            processingStatus: status,
          };
          if (user) {
            saveBookToCloud(user.uid, user.email || "", docUpdates);
          }
          return docUpdates;
        }
        return b;
      });
    });
  };

  const handleUpdateAudioProfile = (bookId: string, audioProfile: AudioProfile | null) => {
    saveBooks((current) => {
      return current.map((b) => {
        if (b.id === bookId) {
          const docUpdates = {
            ...b,
            audioProfile,
          };
          if (user) {
            saveBookToCloud(user.uid, user.email || "", docUpdates);
          }
          return docUpdates;
        }
        return b;
      });
    });
  };

  const handleAddHighlight = (newH: Omit<Highlight, "id" | "createdAt">) => {
    const item: Highlight = {
      ...newH,
      id: Math.random().toString(36).substring(2, 9),
      createdAt: new Date().toISOString(),
    };
    setHighlights((current) => {
      const updated = [item, ...current];
      localStorage.setItem("lumen_library_highlights", JSON.stringify(updated));
      return updated;
    });
    if (user) {
      saveHighlightToCloud(user.uid, user.email || "", item);
    }
  };

  const handleRemoveHighlight = (id: string) => {
    setHighlights((current) => {
      const updated = current.filter((h) => h.id !== id);
      localStorage.setItem("lumen_library_highlights", JSON.stringify(updated));
      return updated;
    });
    if (user) {
      deleteHighlightFromCloud(user.uid, user.email || "", id);
    }
  };

  const handleAddBookmark = (newB: Omit<Bookmark, "id" | "createdAt">) => {
    const item: Bookmark = {
      ...newB,
      id: Math.random().toString(36).substring(2, 9),
      createdAt: new Date().toISOString(),
    };
    const updated = [item, ...bookmarks];
    setBookmarks(updated);
    localStorage.setItem("lumen_library_bookmarks", JSON.stringify(updated));
    if (user) {
      saveBookmarkToCloud(user.uid, user.email || "", item);
    }
  };

  const handleRemoveBookmark = (id: string) => {
    const updated = bookmarks.filter((b) => b.id !== id);
    setBookmarks(updated);
    localStorage.setItem("lumen_library_bookmarks", JSON.stringify(updated));
    if (user) {
      deleteBookmarkFromCloud(user.uid, user.email || "", id);
    }
  };

  const changeTheme = (newTheme: typeof theme) => {
    setTheme(newTheme);
    localStorage.setItem("lumen_theme", newTheme);
  };

  const activeBook = books.find((b) => b.id === selectedBookId);
  const activeBookHighlights = highlights.filter((h) => h.documentId === selectedBookId);
  const activeBookBookmarks = bookmarks.filter((b) => b.documentId === selectedBookId);

  const isDark = theme === "midnight" || theme === "contrast";

  return (
    <div className={`min-h-screen transition-theme theme-${theme} font-sans`}>
      {activeBook ? (
        <ReaderView
          document={activeBook}
          highlights={activeBookHighlights}
          bookmarks={activeBookBookmarks}
          accessibilityConfig={accessibilityConfig}
          activeParagraphIndex={activeBook.progress.paragraphIndex || 0}
          activeSentenceIndex={activeBook.progress.sentenceIndex || 0}
          onJumpTo={(pIdx, sIdx) => handleUpdateProgress(activeBook.id, pIdx, sIdx)}
          onBack={() => setSelectedBookId(null)}
          onUpdateProgress={(pIdx, sIdx) => handleUpdateProgress(activeBook.id, pIdx, sIdx)}
          onAddHighlight={handleAddHighlight}
          onRemoveHighlight={handleRemoveHighlight}
          onAddBookmark={handleAddBookmark}
          onUpdateStatus={handleUpdateStatus}
          onUpdateAudioProfile={handleUpdateAudioProfile}
          showRightSidebar={isRightSidebarOpen}
          toggleRightSidebar={() => {
            setSidebarPanel("ai");
            setIsRightSidebarOpen(!isRightSidebarOpen);
          }}
          rightSidebarContent={
            <div className="h-full flex flex-col" style={{ backgroundColor: "var(--surface-elevated)" }}>
              <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b"
                style={{ borderColor: "var(--border-default)", backgroundColor: "var(--surface-page)" }}>
                <span className="text-[11px] font-bold tracking-wider font-mono flex items-center gap-1.5"
                  style={{ color: "var(--ink-muted)" }}>
                  <BookOpen className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
                  {sidebarPanel === "ai" ? "Companion" : "Preferences"}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setSidebarPanel("ai")}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
                    style={{
                      backgroundColor: sidebarPanel === "ai" ? "var(--accent)" : "transparent",
                      color: sidebarPanel === "ai" ? "#fff" : "var(--ink-muted)",
                    }}
                  >
                    AI
                  </button>
                  <button
                    onClick={() => setSidebarPanel("settings")}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
                    style={{
                      backgroundColor: sidebarPanel === "settings" ? "var(--accent)" : "transparent",
                      color: sidebarPanel === "settings" ? "#fff" : "var(--ink-muted)",
                    }}
                  >
                    Theme
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {sidebarPanel === "ai" ? (
                  <AISidebar
                    document={activeBook}
                    highlights={activeBookHighlights}
                    bookmarks={activeBookBookmarks}
                    activeParagraphIndex={activeBook.progress.paragraphIndex || 0}
                    activeSentenceIndex={activeBook.progress.sentenceIndex || 0}
                    onJumpTo={(p, s) => handleUpdateProgress(activeBook.id, p, s)}
                    onRemoveHighlight={handleRemoveHighlight}
                    onRemoveBookmark={handleRemoveBookmark}
                  />
                ) : (
                  <div className="p-4 space-y-6">
                    <div className="space-y-2">
                      <label className="text-[11px] font-semibold uppercase tracking-wider block" style={{ color: "var(--ink-muted)" }}>
                        Contrast Palette
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: "daylight", name: "Daylight", style: { backgroundColor: "#F5F3EF", color: "#1C1C1A" } },
                          { id: "parchment", name: "Parchment", style: { backgroundColor: "#F0EBE0", color: "#2E2820" } },
                          { id: "midnight", name: "Midnight", style: { backgroundColor: "#141516", color: "#E8E6E1", border: "1px solid rgba(255,255,255,0.08)" } },
                          { id: "contrast", name: "High Contrast", style: { backgroundColor: "#000000", color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.15)" } },
                        ].map((item) => (
                          <button
                            key={item.id}
                            onClick={() => changeTheme(item.id as any)}
                            className="w-full py-2.5 px-3 text-xs font-semibold rounded-xl text-center transition-all"
                            style={{
                              ...item.style,
                              boxShadow: theme === item.id ? `0 0 0 2px var(--accent)` : "none",
                              opacity: theme === item.id ? 1 : 0.75,
                            }}
                          >
                            {item.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <AccessibilitySettings
                      config={accessibilityConfig}
                      onChange={setAccessibilityConfig}
                    />
                  </div>
                )}
              </div>
            </div>
          }
        />
      ) : (
        <div className="min-h-screen flex flex-col transition-theme" style={{ backgroundColor: "var(--surface-page)", color: "var(--ink-primary)" }}>
          {/* Modern Header */}
          <header
            className="h-14 flex items-center justify-between px-4 sm:px-6 lg:px-8 border-b sticky top-0 z-50 transition-theme"
            style={{
              backgroundColor: "var(--surface-elevated)",
              borderColor: "var(--border-default)",
            }}
          >
            <div className="flex items-center gap-2.5">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-serif font-black text-sm"
                style={{ backgroundColor: "var(--accent)" }}
              >
                L
              </div>
              <span className="font-serif font-bold tracking-tight text-sm" style={{ color: "var(--ink-primary)" }}>
                Lumen
              </span>
            </div>

            <div className="flex items-center gap-3">
              {/* Cloud status */}
              {user ? (
                <div
                  className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold font-mono border"
                  style={{
                    backgroundColor: "var(--accent-subtle)",
                    borderColor: "var(--accent-border)",
                    color: "var(--accent)",
                  }}
                >
                  <Cloud className="w-3 h-3" />
                  <span>Synced</span>
                </div>
              ) : (
                <div
                  className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold font-mono border"
                  style={{
                    backgroundColor: "var(--surface-hover)",
                    borderColor: "var(--border-default)",
                    color: "var(--ink-muted)",
                  }}
                >
                  <CloudOff className="w-3 h-3" />
                  <span>Local</span>
                </div>
              )}

              {/* Theme toggle */}
              <button
                onClick={() => changeTheme(isDark ? "daylight" : "midnight")}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
                style={{
                  backgroundColor: "var(--surface-hover)",
                  color: "var(--ink-secondary)",
                }}
                title={isDark ? "Switch to light" : "Switch to dark"}
              >
                {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>

              {/* Auth */}
              {user ? (
                <div className="flex items-center gap-2 pl-2 border-l" style={{ borderColor: "var(--border-default)" }}>
                  <div className="hidden sm:flex flex-col text-right">
                    <span className="text-[11px] font-semibold truncate max-w-[120px]" style={{ color: "var(--ink-primary)" }}>
                      {user.displayName || "User"}
                    </span>
                  </div>
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt="User avatar"
                      referrerPolicy="no-referrer"
                      className="w-7 h-7 rounded-full object-cover border"
                      style={{ borderColor: "var(--border-strong)" }}
                    />
                  ) : (
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-[10px] text-white"
                      style={{ backgroundColor: "var(--accent)" }}
                    >
                      {user.email?.substring(0, 2).toUpperCase() || "LU"}
                    </div>
                  )}
                  <button
                    onClick={handleLogout}
                    className="p-1.5 rounded-lg transition-all"
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
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleGoogleLogin}
                  className="flex items-center gap-2 py-1.5 px-3 rounded-lg text-[11px] font-bold transition-all border"
                  style={{
                    backgroundColor: "var(--surface-page)",
                    borderColor: "var(--border-strong)",
                    color: "var(--ink-primary)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--surface-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--surface-page)";
                  }}
                >
                  <LogIn className="w-3 h-3" />
                  <span className="hidden sm:inline">Sign In</span>
                </button>
              )}
            </div>
          </header>

          <main className="flex-1 overflow-y-auto custom-scrollbar">
            <LibraryView
              books={books}
              onSelectBook={setSelectedBookId}
              onUploadBook={handleUploadBook}
              onRemoveBook={handleRemoveBook}
              onUpdateStatus={handleUpdateStatus}
              onUpdateAudioProfile={handleUpdateAudioProfile}
              textFilters={accessibilityConfig.textFilters}
            />
          </main>
        </div>
      )}
    </div>
  );
}
