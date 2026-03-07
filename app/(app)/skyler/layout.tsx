export default function SkylerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="!fixed inset-0 z-50 bg-[#1B1B1B]">
      {children}
    </div>
  );
}
