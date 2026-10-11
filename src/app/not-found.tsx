import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-20 font-semibold">Page not found</h1>
      <p className="mt-2 text-mute">
        Go to the <Link href="/" className="text-link underline">feed</Link>.
      </p>
    </div>
  );
}
