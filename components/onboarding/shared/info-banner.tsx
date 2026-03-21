type Props = {
  title: string;
  description: string;
  accentColor?: string;
};

export function InfoBanner({ title, description, accentColor = "#5B3DC8" }: Props) {
  return (
    <div
      className="rounded-xl p-5 border"
      style={{
        backgroundColor: `${accentColor}08`,
        borderColor: `${accentColor}30`,
      }}
    >
      <div className="font-semibold text-white text-sm">{title}</div>
      <div className="text-xs mt-1" style={{ color: `${accentColor}CC` }}>
        {description}
      </div>
    </div>
  );
}
