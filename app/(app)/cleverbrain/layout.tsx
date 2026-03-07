export default function CleverBrainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // CleverBrain has its own 3-column layout, so we override the parent's
  // sidebar + main wrapper by rendering children directly in a full-screen container.
  return (
    <div className="!fixed inset-0 z-50 bg-[#151515]">
      {children}
    </div>
  );
}
