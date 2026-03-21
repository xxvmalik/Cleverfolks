"use client";
import { cn } from "@/lib/utils";

type Props = {
  options: string[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  multi?: boolean;
  accentColor?: string; // hex color for selected state
};

export function SelectableChips({ options, value, onChange, multi = false, accentColor = "#5B3DC8" }: Props) {
  const selected = Array.isArray(value) ? value : [value];

  function toggle(option: string) {
    if (multi) {
      const arr = Array.isArray(value) ? value : [];
      if (arr.includes(option)) {
        onChange(arr.filter(v => v !== option));
      } else {
        onChange([...arr, option]);
      }
    } else {
      onChange(option);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            onClick={() => toggle(option)}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-medium transition-all border",
              isSelected
                ? "text-white"
                : "bg-[#1C1F24] border-[#2A2D35] text-[#8B8F97] hover:border-[#3A3D45] hover:text-white"
            )}
            style={isSelected ? { backgroundColor: `${accentColor}20`, borderColor: accentColor, color: "white" } : undefined}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
