import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Styled native select — reliable cross-browser, matches shadcn visual contract
const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        "flex h-10 w-full appearance-none rounded-md border border-[#2A2D35] bg-[#131619] px-3 py-2 pr-8 text-sm text-white focus-visible:outline-none focus-visible:border-[#3A89FF] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-2.5 top-3 h-4 w-4 text-[#8B8F97]" />
  </div>
));
Select.displayName = "Select";

export { Select };
