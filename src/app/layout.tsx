import type { Metadata } from "next";
import Link from "next/link";
import "@/styles/style.scss";

export const metadata: Metadata = { title: "Gorbach | Widget lab" };

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en">
			<body>
				<header className="site-header">
					<Link href="/">Gorbach / Widget lab</Link>
					<Link href="/admin">Administration ↗</Link>
				</header>
				{children}
				<footer className="site-footer">
					<span>Gorbach</span>
					<Link href="/">Test stand</Link>
				</footer>
			</body>
		</html>
	);
}
