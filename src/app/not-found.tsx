import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-20 font-semibold">No such battlecard</h1>
      <p className="mt-2 text-mute">
        Build one on the <Link href="/build" className="text-link underline">Build page</Link> or with the CLI.
      </p>
    </div>
  );
}
