import { z } from "zod";

/**
 * Shared Zod schemas. In v2.0's full pipeline these drive both client and server
 * validation (spec instructions_to_builder). Phase 1 uses them on the server for
 * auth, workspace and invite input.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(320);

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200);

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  email: emailSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
  totp: z.string().trim().optional(),
});

export const roleSchema = z.enum(["admin", "manager", "member", "viewer", "guest"]);

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Name your workspace").max(120),
  timezone: z.string().trim().min(1).max(64).default("Europe/London"),
  currency: z.string().trim().length(3).default("GBP"),
  template: z.string().trim().max(64).optional(),
});

export const inviteSchema = z.object({
  email: emailSchema,
  role: roleSchema.default("member"),
});

/** Slugify a workspace name into a URL-safe, reasonably unique slug seed. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  return base || "workspace";
}
