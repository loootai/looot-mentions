import Link from "next/link";
import { Feed } from "@/components/Feed";
import { requireAdminPage } from "@/lib/auth/guard";
import { loadStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireAdminPage();
  const store = await loadStore();
  if (store.mentions.length === 0) {
    return (
      <div className="py-16 text-center">
        <h1 className="text-20 font-semibold">No mentions yet</h1>
        <p className="mt-2 text-mute">
          Run <code className="num rounded bg-hover px-1">npm run mentions -- --demo</code> or use the <Link href="/run" className="text-link underline">Run page</Link>.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-20 font-semibold">Mentions</h1>
        <p className="text-mute">Last run {store.lastRunAt?.slice(0, 16).replace("T", " ")} UTC. New mentions per day are on the <Link href="/digest" className="text-link underline">Digest</Link> page.</p>
      </div>
      <Feed mentions={store.mentions} />
    </div>
  );
}
