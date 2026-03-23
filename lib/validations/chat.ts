import { z } from "zod";

export const cleverBrainChatSchema = z.object({
  message: z.string().min(1).max(50000),
  workspaceId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
});

export const skylerChatSchema = z.object({
  message: z.string().min(1).max(50000),
  workspaceId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  pipelineContext: z
    .record(z.string(), z.any())
    .optional()
    .nullable(),
  pageContext: z
    .record(z.string(), z.any())
    .optional()
    .nullable(),
});

export type CleverBrainChatInput = z.infer<typeof cleverBrainChatSchema>;
export type SkylerChatInput = z.infer<typeof skylerChatSchema>;
