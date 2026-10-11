import Link from "next/link";
import { needsReply } from "@/engine/digest";
import { MentionRow } from "@/components/Pills";
import { requireAdminPage } from "@/lib/auth/guard";
import { loadStore } from "@/lib/store";
import type { Mention } from "@/engine/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Digest" };

const count = (xs: string[]) => Object.entries(xs.reduce<Record<string, number>>((a, x) => ({ ...a, [x]: (a[x] ?? 0) + 1 }), {})).map(([k, n]) => `${k} ${n}`).join(", ");

export default async function DigestPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireAdminPage();
  const store = await loadStore();
  const days = [...new Set(store.mentions.map((m) => m.firstSeenAt.slice(0, 10)))].sort().reverse();
  const { date } = await searchParams;
  const day = date && days.includes(date) ? date : days[0];
  if (!day) return <p className="py-16 text-center text-mute">No digest yet. Run the CLI first.</p>;
  const fresh = store.mentions.filter((m) => m.firstSeenAt.startsWith(day));
  const groups: [string, Mention[]][] = [
    ["Needs a reply", fresh.filter(needsReply)],
    ["Comparisons", fresh.filter((m) => !needsReply(m) && m.intents.includes("comparison"))],
    ["Everything else", fresh.filter((m) => !needsReply(m) && !m.intents.includes("comparison"))],
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-20 font-semibold">Digest for {day}</h1>
        <p className="text-mute">{fresh.length} new mentions. By source: {count(fresh.map((m) => m.source))}. By sentiment: {count(fresh.map((m) => m.sentiment.label))}.</p>
        {days.length > 1 && <p className="mt-1 text-13">{days.map((d) => <Link key={d} href={`/digest?date=${d}`} className="mr-3 text-link underline">{d}</Link>)}</p>}
      </div>
      {groups.filter(([, ms]) => ms.length > 0).map(([title, ms]) => (
        <section key={title}>
          <h2 className="mb-2 text-14 font-semibold">{title} <span className="num text-mute">{ms.length}</span></h2>
          <ul className="rounded-panel border border-line bg-panel">{ms.map((m) => <MentionRow key={m.fingerprint} m={m} />)}</ul>
        </section>
      ))}
    </div>
  );
}
