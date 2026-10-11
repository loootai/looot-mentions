import { requireAdminPage } from "@/lib/auth/guard";
import { RunForm } from "@/components/RunForm";

export const metadata = { title: "Run" };

export default async function RunPage() {
  await requireAdminPage();
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-20 font-semibold">Search now</h1>
      <p className="text-mute">Enter keywords or brand names. You see the list-price cost before anything is paid. The per-run cap is set on the server in mentions.yaml, not on this page. The server needs LOOOT_TOKEN to run a real search. For a daily run, use the CLI and the GitHub Actions workflow.</p>
      <RunForm />
    </div>
  );
}
