"use client";
import { useState } from "react";
import { X, Plus } from "lucide-react";

type Props = {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  maxTags?: number;
  accentColor?: string;
};

export function TagInput({ tags, onChange, placeholder = "Type and press Enter", maxTags = 5, accentColor = "#5B3DC8" }: Props) {
  const [input, setInput] = useState("");

  function addTag() {
    const trimmed = input.trim();
    if (!trimmed || tags.includes(trimmed) || tags.length >= maxTags) return;
    onChange([...tags, trimmed]);
    setInput("");
  }

  function removeTag(tag: string) {
    onChange(tags.filter(t => t !== tag));
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
          placeholder={placeholder}
          className="flex-1 bg-[#1C1F24] border border-[#2A2D35] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#8B8F97]/50 focus:outline-none focus:border-[#3A3D45]"
        />
        <button
          type="button"
          onClick={addTag}
          disabled={!input.trim() || tags.length >= maxTags}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-40 transition-colors"
          style={{ backgroundColor: accentColor }}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs text-white border"
              style={{ backgroundColor: `${accentColor}20`, borderColor: `${accentColor}40` }}
            >
              {tag}
              <button type="button" onClick={() => removeTag(tag)} className="hover:opacity-70">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
