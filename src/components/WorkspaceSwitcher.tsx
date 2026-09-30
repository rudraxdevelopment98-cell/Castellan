"use client";

import { useRouter } from "next/navigation";

/** Switch the active workspace (spec: a user can belong to several). */
export function WorkspaceSwitcher({
  current,
  options,
}: {
  current: string;
  options: { slug: string; name: string }[];
}) {
  const router = useRouter();
  return (
    <select
      value={current}
      onChange={(e) => {
        if (e.target.value === "__new") router.push("/onboarding?new=1");
        else router.push(`/w/${e.target.value}`);
      }}
      aria-label="Switch workspace"
      className="rounded-ctl border border-rule bg-surface px-2 py-1.5 text-table text-ink"
    >
      {options.map((o) => (
        <option key={o.slug} value={o.slug}>
          {o.name}
        </option>
      ))}
      <option value="__new">+ New workspace…</option>
    </select>
  );
}
