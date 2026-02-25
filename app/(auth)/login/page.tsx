"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmail, signUpWithEmail, signInWithGoogle } from "@/lib/auth";
import { getUserWorkspaces } from "@/lib/workspace";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "login") {
        const { error } = await signInWithEmail(email, password);
        if (error) throw error;
      } else {
        const { error } = await signUpWithEmail(email, password, fullName);
        if (error) throw error;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Authentication failed");

      const { data: memberships } = await getUserWorkspaces(supabase, user.id);
      if (memberships && memberships.length > 0) {
        router.push("/");
      } else {
        router.push("/create-workspace");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    const { error } = await signInWithGoogle();
    if (error) setError(error.message);
  }

  return (
    <div className="w-full max-w-[400px]">
      <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl p-8 space-y-6">
        <div className="text-center space-y-1">
          <h1 className="font-heading font-bold text-2xl text-white tracking-tight">
            Cleverfolks
          </h1>
          <p className="text-[#8B8F97] text-sm">
            {mode === "login" ? "Sign in to your account" : "Create a new account"}
          </p>
        </div>

        {error && (
          <div className="px-4 py-3 rounded-lg bg-[#F87171]/10 border border-[#F87171]/30 text-[#F87171] text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <div className="space-y-1.5">
              <label className="text-sm text-[#8B8F97]" htmlFor="fullName">
                Full name
              </label>
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-lg bg-[#131619] border border-[#2A2D35] text-white text-sm placeholder-[#8B8F97] focus:outline-none focus:border-[#3A89FF] transition-colors"
                placeholder="Your name"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm text-[#8B8F97]" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg bg-[#131619] border border-[#2A2D35] text-white text-sm placeholder-[#8B8F97] focus:outline-none focus:border-[#3A89FF] transition-colors"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm text-[#8B8F97]" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg bg-[#131619] border border-[#2A2D35] text-white text-sm placeholder-[#8B8F97] focus:outline-none focus:border-[#3A89FF] transition-colors"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-[#3A89FF] text-white text-sm font-medium hover:bg-[#3A89FF]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[#2A2D35]" />
          </div>
          <div className="relative flex justify-center text-xs text-[#8B8F97]">
            <span className="bg-[#1C1F24] px-2">or continue with</span>
          </div>
        </div>

        <button
          onClick={handleGoogle}
          className="w-full py-2.5 rounded-lg bg-[#131619] border border-[#2A2D35] text-white text-sm font-medium hover:bg-[#2A2D35] transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Google
        </button>

        <p className="text-center text-sm text-[#8B8F97]">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                onClick={() => { setMode("signup"); setError(null); }}
                className="text-[#3A89FF] hover:underline"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => { setMode("login"); setError(null); }}
                className="text-[#3A89FF] hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
