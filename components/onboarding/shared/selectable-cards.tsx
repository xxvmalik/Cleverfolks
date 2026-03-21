"use client";
import { cn } from "@/lib/utils";

type CardOption = {
  value: string;
  title: string;
  description: string;
};

type Props = {
  options: CardOption[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  multi?: boolean;
  columns?: 2 | 3 | 4;
  accentColor?: string;
};

export function SelectableCards({ options, value, onChange, multi = false, columns = 3, accentColor = "#5B3DC8" }: Props) {
  const selected = Array.isArray(value) ? value : [value];

  function toggle(val: string) {
    if (multi) {
      const arr = Array.isArray(value) ? value : [];
      if (arr.includes(val)) {
        onChange(arr.filter(v => v !== val));
      } else {
        onChange([...arr, val]);
      }
    } else {
      onChange(val);
    }
  }

  const gridClass = columns === 2 ? "grid-cols-2" : columns === 4 ? "grid-cols-4" : "grid-cols-3";

  return (
    <div className={cn("grid gap-3", gridClass)}>
      {options.map((opt) => {
        const isSelected = selected.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            className={cn(
              "p-4 rounded-xl text-left transition-all border",
              isSelected
                ? "text-white"
                : "bg-[#1C1F24] border-[#2A2D35] hover:border-[#3A3D45]"
            )}
            style={isSelected ? { backgroundColor: `${accentColor}15`, borderColor: accentColor } : undefined}
          >
            <div className="font-semibold text-sm text-white">{opt.title}</div>
            <div className="text-xs text-[#8B8F97] mt-1">{opt.description}</div>
          </button>
        );
      })}
    </div>
  );
}
