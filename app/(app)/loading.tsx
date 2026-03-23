export default function AppLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#131619]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-[#3A89FF] border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-[#8B8F97]">Loading...</span>
      </div>
    </div>
  );
}
