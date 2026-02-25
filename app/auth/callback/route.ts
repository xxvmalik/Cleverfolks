import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getUserWorkspaces } from "@/lib/workspace";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const cookieStore = await cookies();

  // Capture cookies that exchangeCodeForSession wants to set so we can
  // attach them explicitly to the redirect response.
  const cookiesToSet: Array<{
    name: string;
    value: string;
    options: Record<string, unknown>;
  }> = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(incoming) {
          cookiesToSet.push(...incoming);
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Auth callback error:", error.message);
    return NextResponse.redirect(`${origin}/login`);
  }

  // Determine redirect destination based on whether the user has a workspace.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let redirectPath = "/create-workspace";
  if (user) {
    const { data: memberships } = await getUserWorkspaces(supabase, user.id);
    if (memberships && memberships.length > 0) {
      redirectPath = "/";
    }
  }

  const response = NextResponse.redirect(`${origin}${redirectPath}`);

  // Write session cookies onto the redirect response so the browser
  // receives them before the next page load.
  cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
  });

  return response;
}
