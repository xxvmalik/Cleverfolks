"use client";

import { useEffect } from "react";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[auth-error]", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#131619]">
      <div className="max-w-md text-center px-6">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[#F87171]/10 flex items-center justify-center">
          <span className="text-[#F87171] text-xl">!</span>
        </div>
        <h2 className="text-white text-lg font-semibold mb-2">Authentication error</h2>
        <p className="text-[#8B8F97] text-sm mb-6">
          Something went wrong during authentication. Please try again.
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-[#3A89FF] hover:bg-[#3A89FF]/90 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
