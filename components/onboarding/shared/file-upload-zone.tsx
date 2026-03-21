"use client";
import { useState, useRef, useCallback } from "react";
import { Upload, X, FileText } from "lucide-react";

type Props = {
  label: string;
  description?: string;
  accept?: string;
  multiple?: boolean;
  files: File[];
  onFilesChange: (files: File[]) => void;
};

export function FileUploadZone({ label, description, accept, multiple = false, files, onFilesChange }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (multiple) {
      onFilesChange([...files, ...dropped]);
    } else {
      onFilesChange(dropped.slice(0, 1));
    }
  }, [files, multiple, onFilesChange]);

  const handleSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (multiple) {
      onFilesChange([...files, ...selected]);
    } else {
      onFilesChange(selected.slice(0, 1));
    }
  }, [files, multiple, onFilesChange]);

  function removeFile(index: number) {
    onFilesChange(files.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors
          ${isDragging ? "border-[#5B3DC8] bg-[#5B3DC8]/5" : "border-[#2A2D35] hover:border-[#3A3D45]"}
        `}
      >
        <Upload className="w-5 h-5 mx-auto mb-2 text-[#8B8F97]" />
        <div className="text-sm font-medium text-white">{label}</div>
        {description && <div className="text-xs text-[#8B8F97] mt-1">{description}</div>}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleSelect}
          className="hidden"
        />
      </div>
      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((file, i) => (
            <div key={`${file.name}-${i}`} className="flex items-center justify-between bg-[#1C1F24] border border-[#2A2D35] rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 text-sm text-white">
                <FileText className="w-4 h-4 text-[#8B8F97]" />
                {file.name}
              </div>
              <button type="button" onClick={() => removeFile(i)} className="text-[#8B8F97] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
