import type { Metadata } from "next";
import Link from "next/link";
import "@/styles/style.scss";

export const metadata: Metadata = { title: "Gorbach | Ukázka chatu" };

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="cs">
			<body>
				<header className="site-header">
					<Link href="/">Gorbach / Ukázka chatu</Link>
				</header>
				{children}
				<footer className="site-footer">
					<span>Gorbach</span>
					<Link href="/">Testovací stránka</Link>
				</footer>
			</body>
		</html>
	);
}
