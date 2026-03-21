type Props = {
  text: string;
};

export function SkylerQuote({ text }: Props) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-full bg-[#0086FF] flex items-center justify-center flex-shrink-0 ring-2 ring-[#F2903D]/40">
        <span className="text-white font-bold text-sm">S</span>
      </div>
      <div className="flex-1 bg-[#1C1F24] border border-[#2A2D35] rounded-xl rounded-tl-none px-4 py-3">
        <p className="text-sm text-[#8B8F97] leading-relaxed">{text}</p>
      </div>
    </div>
  );
}
