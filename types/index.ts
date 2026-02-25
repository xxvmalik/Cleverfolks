// Global type definitions for Cleverfolks

export type NavItem = {
  label: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
};

export type User = {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
};
