export default function SkylerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="skyler-theme !fixed inset-0 z-50" style={{ fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif" }}>
      {children}
    </div>
  );
}
