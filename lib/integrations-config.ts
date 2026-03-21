// Available integrations for onboarding Connect Tools steps.
// Add new integrations here — the onboarding pages render dynamically from this list.

export type IntegrationEntry = {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string; // lucide icon name or custom
  nango_id: string;
  status: "available" | "coming_soon";
};

export const GENERAL_INTEGRATIONS: IntegrationEntry[] = [
  // Communication
  { id: "slack", name: "Slack", category: "Communication", description: "Messages, channels, threads", icon: "slack", nango_id: "slack", status: "available" },
  { id: "google-mail", name: "Gmail", category: "Communication", description: "Emails, threads, attachments", icon: "mail", nango_id: "google-mail", status: "available" },
  { id: "outlook", name: "Outlook", category: "Communication", description: "Emails, calendar, contacts", icon: "mail", nango_id: "outlook", status: "available" },
  // Productivity
  { id: "google-calendar", name: "Google Calendar", category: "Productivity", description: "Events, scheduling", icon: "calendar", nango_id: "google-calendar", status: "available" },
  // CRM
  { id: "hubspot", name: "HubSpot", category: "CRM", description: "Contacts, deals, pipeline", icon: "briefcase", nango_id: "hubspot", status: "available" },
];

export type SkylerIntegrationEntry = IntegrationEntry & {
  skylerCategory: string;
  requirement: "required" | "recommended" | "optional";
};

export const SKYLER_INTEGRATIONS: SkylerIntegrationEntry[] = [
  // Email (Required)
  { id: "google-mail", name: "Gmail", category: "Communication", skylerCategory: "Email", requirement: "required", description: "Send and receive emails", icon: "mail", nango_id: "google-mail", status: "available" },
  { id: "outlook", name: "Outlook", category: "Communication", skylerCategory: "Email", requirement: "required", description: "Send and receive emails", icon: "mail", nango_id: "outlook", status: "available" },
  // CRM (Required)
  { id: "hubspot", name: "HubSpot", category: "CRM", skylerCategory: "CRM", requirement: "required", description: "Contacts, deals, pipeline", icon: "briefcase", nango_id: "hubspot", status: "available" },
  { id: "salesforce", name: "Salesforce", category: "CRM", skylerCategory: "CRM", requirement: "required", description: "CRM and pipeline", icon: "briefcase", nango_id: "salesforce", status: "coming_soon" },
  { id: "pipedrive", name: "Pipedrive", category: "CRM", skylerCategory: "CRM", requirement: "required", description: "Deals and contacts", icon: "briefcase", nango_id: "pipedrive", status: "coming_soon" },
  // Lead Intelligence (Recommended)
  { id: "apollo", name: "Apollo.io", category: "Lead Intelligence", skylerCategory: "Lead Intelligence", requirement: "recommended", description: "Lead enrichment and prospecting", icon: "search", nango_id: "apollo", status: "coming_soon" },
  { id: "google-analytics", name: "Google Analytics", category: "Lead Intelligence", skylerCategory: "Lead Intelligence", requirement: "recommended", description: "Web traffic and conversions", icon: "bar-chart-2", nango_id: "google-analytics", status: "coming_soon" },
  // Scheduling (Recommended)
  { id: "calendly", name: "Calendly", category: "Scheduling", skylerCategory: "Scheduling", requirement: "recommended", description: "Booking links, events", icon: "calendar", nango_id: "calendly", status: "available" },
  { id: "google-calendar", name: "Google Calendar", category: "Scheduling", skylerCategory: "Scheduling", requirement: "recommended", description: "Events, scheduling", icon: "calendar", nango_id: "google-calendar", status: "available" },
  // Team Notifications (Optional)
  { id: "slack", name: "Slack", category: "Communication", skylerCategory: "Team Notifications", requirement: "optional", description: "Team alerts and updates", icon: "message-square", nango_id: "slack", status: "available" },
  { id: "ms-teams", name: "MS Teams", category: "Communication", skylerCategory: "Team Notifications", requirement: "optional", description: "Team alerts and updates", icon: "message-square", nango_id: "ms-teams", status: "coming_soon" },
];
