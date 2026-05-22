/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { BookOpen, Settings, Sun, Moon, Sparkles, BookMarked, HelpCircle, Eye, RefreshCw, LogIn, LogOut, Cloud, CloudOff } from "lucide-react";
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
import AccessibilitySettings, { AccessibilityConfig, FontStyle } from "./components/AccessibilitySettings";
import AISidebar from "./components/AISidebar";

export default function App() {
  // Authentication user context
  const [user, setUser] = useState<User | null>(null);

  // 1. Library State Stateful Persistence
  const [books, setBooks] = useState<Document[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  
  // Study logs
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  // 2. Color Themes State
  const [theme, setTheme] = useState<"daylight" | "parchment" | "midnight" | "contrast">("daylight");

  // 3. Accessibility Configuration Defaults
  const [accessibilityConfig, setAccessibilityConfig] = useState<AccessibilityConfig>({
    fontStyle: "serif",
    fontSize: 19,
    lineHeight: 1.65,
    bionicReading: false,
    readingRuler: false,
    rulerPosition: 40,
    textSpacing: "normal",
  });

  // Collapsible Right study panel settings drawer
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [sidebarPanel, setSidebarPanel] = useState<"ai" | "settings">("ai");

  // Authentication observer listener effect
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        console.log("[Lumen Auth]: Logged in user:", currentUser.email);
      } else {
        console.log("[Lumen Auth]: Guest session.");
      }
    });
    return () => unsubscribe();
  }, []);

  // Sync state with cloud when authenticated, or fallback to local storage
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

    console.log("[Lumen Real-Time Sync]: Running sync listeners for:", user.uid);

    const unsubBooks = listenToUserCollection<Document>(
      user.uid,
      "books",
      user.email || "",
      (cloudBooks) => {
        if (cloudBooks.length > 0) {
          setBooks(cloudBooks);
        } else {
          // Empty cloud, seed with current local library or presets
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

  // Load visual defaults on start
  useEffect(() => {
    const savedTheme = localStorage.getItem("lumen_theme");
    if (savedTheme) {
      setTheme(savedTheme as any);
    }
  }, []);

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

  // Save book changes
  const saveBooks = (updated: Document[] | ((current: Document[]) => Document[])) => {
    setBooks((current) => {
      const next = typeof updated === "function"
        ? (updated as (current: Document[]) => Document[])(current)
        : updated;
      localStorage.setItem("lumen_library_books", JSON.stringify(next));
      return next;
    });
  };

  // Add book to shelves
  const handleUploadBook = (newBook: Document) => {
    saveBooks((current) => [newBook, ...current]);
    if (user) {
      saveBookToCloud(user.uid, user.email || "", newBook);
    }
  };

  // Remove book from shelves
  const handleRemoveBook = (id: string) => {
    saveBooks((current) => current.filter((b) => b.id !== id));
    if (selectedBookId === id) setSelectedBookId(null);
    if (user) {
      deleteBookFromCloud(user.uid, user.email || "", id);
    }
  };

  // Track sentence / progress updates
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

  // Process Document Audio Status Transition
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

  // Manage Study Highlights
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

  // Manage Saved bookmarks
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

  // Filters for book specific logs
  const activeBookHighlights = highlights.filter((h) => h.documentId === selectedBookId);
  const activeBookBookmarks = bookmarks.filter((b) => b.documentId === selectedBookId);

  return (
    <div className={`min-h-screen transition-theme theme-${theme} font-sans`}>
      {/* Dynamic Theme classes mapped correctly inside outer wrapper */}
      
      {activeBook ? (
        // ————— VIEW A: INDIVIDUAL BOOK READER VIEW —————
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
            <div className="h-full flex flex-col bg-white dark:bg-zinc-950">
              {/* Header inside companion sidebar to toggle configuration settings vs tutor chatbot */}
              <div className="h-12 shrink-0 border-b border-gray-150 dark:border-white/5 flex items-center justify-between px-3.5 bg-gray-50/50 dark:bg-zinc-900/50">
                <span className="text-[11px] font-bold tracking-wider font-mono text-gray-400 capitalize flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                  {sidebarPanel === "ai" ? "Learning Companion" : "Preferences Settings"}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setSidebarPanel("ai")}
                    className={`p-1.5 rounded transition-colors text-xs font-semibold ${
                      sidebarPanel === "ai"
                        ? "bg-teal-600 text-white"
                        : "hover:bg-gray-150 dark:hover:bg-white/5 text-gray-500"
                    }`}
                  >
                    AI Companion
                  </button>
                  <button
                    onClick={() => setSidebarPanel("settings")}
                    className={`p-1.5 rounded transition-colors text-xs font-semibold ${
                      sidebarPanel === "settings"
                        ? "bg-teal-600 text-white"
                        : "hover:bg-gray-150 dark:hover:bg-white/5 text-gray-500"
                    }`}
                  >
                    Theme/Fonts
                  </button>
                </div>
              </div>

              {/* Toggle panels */}
              <div className="flex-1 overflow-y-auto">
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
                    {/* Theme Palettes selections */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-gray-500 block">Contrast Palette</label>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: "daylight", name: "Daylight", style: "bg-[#FAF8F3] text-[#1B1B1A]" },
                          { id: "parchment", name: "Parchment", style: "bg-[#F4ECD8] text-[#3A2E22]" },
                          { id: "midnight", name: "Midnight", style: "bg-[#121315] text-[#E6E2D8] border border-white/10" },
                          { id: "contrast", name: "AAA Black", style: "bg-black text-white border border-teal-500" },
                        ].map((item) => (
                          <button
                            key={item.id}
                            onClick={() => changeTheme(item.id as any)}
                            className={`w-full py-2 px-3 text-xs font-semibold rounded-lg text-center transition-all ${item.style} ${
                              theme === item.id ? "ring-2 ring-teal-500 scale-[1.02]" : "opacity-80"
                            }`}
                          >
                            {item.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Typeface and font scale Accessibility Adjustments */}
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
        // ————— VIEW B: MAIN SHELF DASHBOARD VIEW —————
        <div className="min-h-screen flex flex-col bg-slate-50/20 dark:bg-black/20 text-gray-900 dark:text-white">
          {/* Header navigation bar */}
          <header className="h-16 border-b border-gray-150 dark:border-white/10 flex items-center justify-between px-6 bg-white dark:bg-zinc-950 shadow-sm relative z-10 shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-indigo-600 flex items-center justify-center text-white font-serif font-black text-lg">
                L
              </span>
              <span className="font-serif font-extrabold tracking-tight text-lg dark:text-white">
                Lumen Reader
              </span>
            </div>

            {/* Quick dashboard theme controls and sign-in handlers */}
            <div className="flex items-center gap-4">
              {/* Cloud Storage Synchronize state */}
              {user ? (
                <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-teal-500/10 dark:bg-teal-400/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 rounded-full text-[11px] font-bold font-mono">
                  <Cloud className="w-3.5 h-3.5" />
                  <span>Cloud Storage Synced</span>
                </div>
              ) : (
                <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-slate-100 dark:bg-zinc-900 border border-slate-200/40 dark:border-white/5 text-slate-500 dark:text-zinc-500 rounded-full text-[11px] font-bold font-mono">
                  <CloudOff className="w-3.5 h-3.5 animate-pulse" />
                  <span>Cloud Off (Local Storage)</span>
                </div>
              )}

              {/* Theme selectors */}
              <div className="flex gap-1.5 bg-gray-50 dark:bg-zinc-90 w-fit p-1 rounded-lg border border-gray-200/50 dark:border-white/10 select-none">
                {[
                  { id: "daylight", icon: Sun, label: "Daylight" },
                  { id: "midnight", icon: Moon, label: "Midnight" },
                ].map((item) => {
                  const Icon = item.icon;
                  const isActive = theme === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => changeTheme(item.id as any)}
                      className={`p-1.5 rounded-md transition-all ${
                        isActive ? "bg-white dark:bg-zinc-900 text-teal-600 dark:text-teal-400 shadow cursor-pointer" : "text-gray-400 hover:text-[#1B1B1A]"
                      }`}
                      title={item.label}
                    >
                      <Icon className="w-4 h-4" />
                    </button>
                  );
                })}
              </div>

              {/* Google login badge triggers */}
              {user ? (
                <div className="flex items-center gap-2.5 pl-2.5 border-l border-zinc-200 dark:border-white/10">
                  <div className="hidden lg:flex flex-col text-right text-xs">
                    <span className="font-semibold text-gray-800 dark:text-white truncate max-w-[130px]">{user.displayName || "Lumen Reader"}</span>
                    <span className="text-[10px] text-gray-400 dark:text-zinc-500 font-mono truncate max-w-[130px]">{user.email}</span>
                  </div>
                  {user.photoURL ? (
                    <img 
                      src={user.photoURL} 
                      alt="User avatar" 
                      referrerPolicy="no-referrer"
                      className="w-8 h-8 rounded-full border border-teal-500/35 object-cover"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center font-bold text-xs select-none shadow">
                      {user.email?.substring(0, 2).toUpperCase() || "LU"}
                    </div>
                  )}
                  <button
                    onClick={handleLogout}
                    className="p-1.5 text-gray-400 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg transition-all cursor-pointer"
                    title="Sign Out Cloud Session"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleGoogleLogin}
                  className="flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100 text-white font-bold text-xs py-2 px-3.5 rounded-xl cursor-pointer shadow hover:scale-[1.02] active:scale-95 transition-all"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Google Sign In</span>
                </button>
              )}
            </div>
          </header>

          <main className="flex-1 overflow-y-auto">
            <LibraryView
              books={books}
              onSelectBook={setSelectedBookId}
              onUploadBook={handleUploadBook}
              onRemoveBook={handleRemoveBook}
              onUpdateStatus={handleUpdateStatus}
              onUpdateAudioProfile={handleUpdateAudioProfile}
            />
          </main>
        </div>
      )}
    </div>
  );
}
