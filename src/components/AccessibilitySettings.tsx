/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Eye, Type, AlignLeft, ShieldAlert } from "lucide-react";

export type FontStyle = "serif" | "sans" | "dyslexic" | "hyperlegible" | "mono";

export interface AccessibilityConfig {
  fontStyle: FontStyle;
  fontSize: number; // in px, default 19
  lineHeight: number; // default 1.65
  bionicReading: boolean;
  readingRuler: boolean;
  rulerPosition: number; // in % from top of viewport or card
  textSpacing: "normal" | "wide" | "wider";
}

interface Props {
  config: AccessibilityConfig;
  onChange: (config: AccessibilityConfig) => void;
}

export default function AccessibilitySettings({ config, onChange }: Props) {
  const fonts: { id: FontStyle; label: string; class: string }[] = [
    { id: "serif", label: "Literata Serif (Book)", class: "font-serif" },
    { id: "sans", label: "Inter (Clean UI)", class: "font-sans" },
    { id: "dyslexic", label: "OpenDyslexic (ADHD/Dyslexia)", class: "font-dyslexic" },
    { id: "hyperlegible", label: "Atkinson Hyperlegible", class: "font-atkinson" },
    { id: "mono", label: "JetBrains Code (Technical)", class: "font-mono" },
  ];

  const update = <K extends keyof AccessibilityConfig>(key: K, value: AccessibilityConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 pb-2 border-b border-gray-200/50 dark:border-white/10">
        <Type className="w-5 h-5 text-teal-600 dark:text-teal-400" />
        <h3 className="font-semibold text-sm">Typography & Accessibility</h3>
      </div>

      {/* Font Chooser */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Font Face</label>
        <div className="grid grid-cols-1 gap-1.5">
          {fonts.map((f) => (
            <button
              key={f.id}
              onClick={() => update("fontStyle", f.id)}
              className={`flex items-center justify-between px-3 py-2 text-left text-sm rounded-lg border transition-all ${
                config.fontStyle === f.id
                  ? "border-teal-500 bg-teal-50/10 dark:bg-teal-900/10 font-medium"
                  : "border-gray-200/50 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300"
              }`}
            >
              <span>{f.label}</span>
              <span className={`text-xs ${f.class} opacity-70`}>Sample</span>
            </button>
          ))}
        </div>
      </div>

      {/* Font Size & Spacing */}
      <div className="space-y-3">
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Size ({config.fontSize}px)</label>
            <span className="text-xs font-mono">{Math.round((config.fontSize / 19) * 100)}%</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => update("fontSize", Math.max(14, config.fontSize - 1))}
              disabled={config.fontSize <= 14}
              className="px-2.5 py-1 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded disabled:opacity-50"
            >
              A-
            </button>
            <input
              type="range"
              min="14"
              max="28"
              step="1"
              value={config.fontSize}
              onChange={(e) => update("fontSize", parseInt(e.target.value))}
              className="flex-1 accent-teal-600"
            />
            <button
              onClick={() => update("fontSize", Math.min(28, config.fontSize + 1))}
              disabled={config.fontSize >= 28}
              className="px-2.5 py-1 text-sm bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded disabled:opacity-50"
            >
              A+
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Letter Spacing</label>
          <div className="grid grid-cols-3 gap-1.5">
            {(["normal", "wide", "wider"] as const).map((spacing) => (
              <button
                key={spacing}
                onClick={() => update("textSpacing", spacing)}
                className={`py-1.5 text-xs rounded border capitalize transition-all ${
                  config.textSpacing === spacing
                    ? "border-teal-500 bg-teal-50/10 dark:bg-teal-900/10 text-teal-600 dark:text-teal-400 font-semibold"
                    : "border-gray-200/50 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5"
                }`}
              >
                {spacing}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Reading focus tools */}
      <div className="space-y-3 pt-2 border-t border-gray-200/50 dark:border-white/10">
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block">Focus Assistance</label>
        
        {/* Bionic Reading */}
        <button
          onClick={() => update("bionicReading", !config.bionicReading)}
          className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-all ${
            config.bionicReading
              ? "border-teal-500 bg-teal-50/10 dark:bg-teal-900/10"
              : "border-gray-200/50 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5"
          }`}
        >
          <div className="flex gap-2.5 items-start">
            <AlignLeft className="w-4 h-4 text-teal-500 mt-0.5" />
            <div>
              <div className="text-xs font-medium">Bionic Reading Prefix</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-normal">
                Bolds the first part of words to guide eye scans and boost reading speed.
              </div>
            </div>
          </div>
          <div className={`w-8 h-4 rounded-full transition-all relative ${
            config.bionicReading ? "bg-teal-500" : "bg-gray-300 dark:bg-zinc-700"
          }`}>
            <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-[1px] transition-all ${
              config.bionicReading ? "left-[13px]" : "left-[1px]"
            }`} />
          </div>
        </button>

        {/* Reading Ruler */}
        <button
          onClick={() => update("readingRuler", !config.readingRuler)}
          className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-all ${
            config.readingRuler
              ? "border-teal-500 bg-teal-50/10 dark:bg-teal-900/10"
              : "border-gray-200/50 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5"
          }`}
        >
          <div className="flex gap-2.5 items-start">
            <Eye className="w-4 h-4 text-teal-500 mt-0.5" />
            <div>
              <div className="text-xs font-medium">Reading Ruler Overlay</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-normal">
                Blocks out visual clutter with a tracking horizontal mask focused on your active line.
              </div>
            </div>
          </div>
          <div className={`w-8 h-4 rounded-full transition-all relative ${
            config.readingRuler ? "bg-teal-500" : "bg-gray-300 dark:bg-zinc-700"
          }`}>
            <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-[1px] transition-all ${
              config.readingRuler ? "left-[13px]" : "left-[1px]"
            }`} />
          </div>
        </button>

        {config.readingRuler && (
          <div className="space-y-1 bg-gray-50 dark:bg-zinc-900/50 p-2.5 rounded-lg border border-gray-200/50 dark:border-white/5">
            <div className="flex justify-between text-[10px] font-medium text-gray-500">
              <span>Ruler Height Position</span>
              <span>{config.rulerPosition}%</span>
            </div>
            <input
              type="range"
              min="10"
              max="90"
              value={config.rulerPosition}
              onChange={(e) => update("rulerPosition", parseInt(e.target.value))}
              className="w-full accent-teal-600"
            />
          </div>
        )}
      </div>

      {/* Atkinson and Dyslexia guide notice */}
      <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 flex gap-2">
        <ShieldAlert className="w-4 h-4 shrink-0" />
        <p className="leading-snug">
          Custom font overlays (Atkinson & OpenDyslexic) conform specifically with key low-vision guidelines.
        </p>
      </div>
    </div>
  );
}
