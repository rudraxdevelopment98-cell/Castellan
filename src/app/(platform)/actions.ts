"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { createWorkspaceSchema, inviteSchema, slugify } from "@/server/validation";
import {
  getMembershipsForUser,
  resolveWorkspaceForUser,
  uniqueWorkspaceSlug,
} from "@/server/context";
import { acceptInvite, createWorkspaceWithOwner, inviteMember } from "@/server/tenancy";
import { requireUser } from "@/server/session";
import { PermissionError } from "@/server/rbac";

export async function createWorkspaceAction(formData: FormData): Promise<void> {
  const user = await requireUser("/onboarding");
  const parsed = createWorkspaceSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone") || undefined,
    currency: formData.get("currency") || undefined,
    template: formData.get("template") || undefined,
  });
  if (!parsed.success) {
    redirect(`/onboarding?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check your details.")}`);
  }
  const db = await getDb();
  const slug = await uniqueWorkspaceSlug(slugify(parsed.data.name));
  await createWorkspaceWithOwner(db, {
    ownerUserId: user.id,
    name: parsed.data.name,
    slug,
    timezone: parsed.data.timezone,
    currency: parsed.data.currency,
    defaultTemplate: parsed.data.template,
  });
  redirect(`/w/${slug}`);
}

export async function inviteMemberAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const slug = String(formData.get("slug") ?? "");
  const membership = await resolveWorkspaceForUser(user.id, slug);
  if (!membership) redirect("/signin");

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role") || undefined,
  });
  if (!parsed.success) {
    redirect(`/w/${slug}/members?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the email.")}`);
  }

  const db = await getDb();
  try {
    const { token } = await inviteMember(db, {
      workspaceId: membership!.workspaceId,
      actorUserId: user.id,
      email: parsed.data.email,
      role: parsed.data.role,
    });
    // In production this link is emailed. In local dev (no mail) surface it so
    // the invite can be tested end-to-end.
    const link = `/invite/${token}`;
    redirect(`/w/${slug}/members?invited=${encodeURIComponent(parsed.data.email)}&link=${encodeURIComponent(link)}`);
  } catch (e) {
    if (e instanceof PermissionError) {
      redirect(`/w/${slug}/members?error=${encodeURIComponent("You do not have permission to invite members.")}`);
    }
    throw e;
  }
}

export async function acceptInviteAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const user = await requireUser(`/invite/${token}`);
  const db = await getDb();
  let target: string;
  try {
    const { workspaceId } = await acceptInvite(db, { token, userId: user.id });
    const wss = await getMembershipsForUser(user.id);
    const slug = wss.find((w) => w.workspaceId === workspaceId)?.slug;
    target = slug ? `/w/${slug}` : "/onboarding";
  } catch (e) {
    // redirect() throws NEXT_REDIRECT; never swallow it as an invite error.
    if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) {
      throw e;
    }
    console.error("acceptInvite failed:", e);
    redirect(`/invite/${token}?error=${encodeURIComponent("This invitation is invalid or has expired.")}`);
  }
  redirect(target);
}
