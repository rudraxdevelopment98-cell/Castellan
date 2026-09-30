import { getWorkspaceData } from "../data/store";
import { templates } from "../data/templates";
import type { WorkspaceData } from "../data/types";
import { getToday } from "./clock";
import type { IsoDate } from "../rules/dates";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Resolve the active workspace + today from a page's searchParams. */
export async function resolveContext(
  searchParams?: SearchParams,
): Promise<{ data: WorkspaceData; today: IsoDate; templateId: string }> {
  const sp = searchParams ? await searchParams : {};
  const raw = sp.t;
  const templateId = typeof raw === "string" && templates.some((t) => t.id === raw)
    ? raw
    : "uk-landlord";
  return { data: getWorkspaceData(templateId), today: getToday(), templateId };
}

export function withTemplate(href: string, templateId: string): string {
  if (templateId === "uk-landlord") return href;
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}t=${templateId}`;
}
