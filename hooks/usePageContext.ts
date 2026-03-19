"use client";

import { useCallback, useRef } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export type PageType = "lead_qualification" | "sales_closer" | "workflow_settings";

export type VisibleEntity = {
  type: "lead" | "deal";
  id: string;
  name: string;
};

export type PageContext = {
  route: string;
  pageType: PageType;
  visibleEntities: VisibleEntity[];
  timestamp: string;
  recentActions: string[];
};

// ── Action tracking ──────────────────────────────────────────────────────────

const MAX_RECENT_ACTIONS = 5;

// ── Hook ─────────────────────────────────────────────────────────────────────

export function usePageContext(pageType: PageType): {
  getPageContext: () => PageContext;
  trackAction: (action: string) => void;
} {
  const recentActionsRef = useRef<string[]>([]);

  const trackAction = useCallback((action: string) => {
    recentActionsRef.current = [
      action,
      ...recentActionsRef.current.slice(0, MAX_RECENT_ACTIONS - 1),
    ];
  }, []);

  const getPageContext = useCallback((): PageContext => {
    // Scrape visible entities from data attributes on the page
    const entityElements = document.querySelectorAll(
      "[data-entity-type][data-entity-id]"
    );
    const visibleEntities: VisibleEntity[] = [];
    entityElements.forEach((el) => {
      const type = el.getAttribute("data-entity-type") as "lead" | "deal";
      const id = el.getAttribute("data-entity-id");
      const name = el.getAttribute("data-entity-name");
      if (type && id && name) {
        visibleEntities.push({ type, id, name });
      }
    });

    // Derive route from pageType (avoids depending on Next.js router)
    const routeMap: Record<PageType, string> = {
      lead_qualification: "/lead-qualification",
      sales_closer: "/sales-closer",
      workflow_settings: "/workflow-settings",
    };

    return {
      route: routeMap[pageType],
      pageType,
      visibleEntities,
      timestamp: new Date().toISOString(),
      recentActions: [...recentActionsRef.current],
    };
  }, [pageType]);

  return { getPageContext, trackAction };
}
