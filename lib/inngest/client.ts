import { Inngest } from "inngest";

// NOTE: Event type schemas are intentionally not enforced here because the
// codebase emits 20+ event types across many files. Adding strict typing
// would require a large refactor of all call sites. The event names and
// their payloads are documented in each Inngest function's trigger config.
export const inngest = new Inngest({ id: "cleverfolks" });
