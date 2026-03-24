import { getActiveWorkspaceId } from "@/app/actions/workspace";

type WorkspaceMembership = {
  role: string;
  workspaces: unknown;
};

type ResolvedWorkspace = {
  id: string;
  name: string;
  slug: string;
  onboarding_completed: boolean;
  skyler_onboarding_completed: boolean;
};

/**
 * Resolve the active workspace from cookie, falling back to the first membership.
 * Used by server pages to get the correct workspace instead of always picking [0].
 */
export async function resolveActiveWorkspace(
  memberships: WorkspaceMembership[]
): Promise<ResolvedWorkspace> {
  const allWorkspaces = memberships
    .filter((m) => m.workspaces)
    .map(
      (m) =>
        m.workspaces as unknown as ResolvedWorkspace
    );

  const activeWsId = await getActiveWorkspaceId();
  return (
    (activeWsId ? allWorkspaces.find((w) => w.id === activeWsId) : null) ??
    allWorkspaces[0]
  );
}
