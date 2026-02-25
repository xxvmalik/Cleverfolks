export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-screen p-8">
      <div className="text-center space-y-4 max-w-lg">
        <h1 className="font-heading font-bold text-4xl text-white tracking-tight">
          Welcome to Cleverfolks
        </h1>
        <p className="text-[#8B8F97] text-lg font-sans">
          Your AI-powered platform is ready. Start building something great.
        </p>
        <div className="inline-flex items-center gap-2 mt-6 px-4 py-2 rounded-full bg-[#3A89FF]/15 border border-[#3A89FF]/30 text-[#3A89FF] text-sm font-medium">
          <span className="w-2 h-2 rounded-full bg-[#4ADE80] animate-pulse" />
          Platform online
        </div>
      </div>
    </div>
  );
}
