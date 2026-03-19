export default function ConnectorsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Connectors has its own full-width layout with sidebar, so override the parent shell.
  return (
    <div className="!fixed inset-0 z-50 bg-[#001022]">
      {children}
    </div>
  );
}
