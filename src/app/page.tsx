import Script from "next/script";
import "./Stand.scss";
import "./Adaptations.scss";

const samples = [
	{
		name: "Rolety",
		tone: "apricot",
		product: "Látka se navíjí na trubku.",
	},
	{
		name: "Žaluzie",
		tone: "mint",
		product: "Naklopením lamel upravíte množství světla.",
	},
	{
		name: "Plisé",
		tone: "lilac",
		product: "Skládaná látka se stáhne do kompaktního profilu.",
	},
];

export default function StandPage() {
	return (
		<main className="test-stand">
			<h1>Testovací stránka chatu</h1>
			<p>Otevřete ukázku a prohlédněte si popis produktu.</p>
			<section className="sample-grid" aria-label="Ukázky produktů">
				{samples.map(({ name, tone, product }) => (
					<details key={tone} className={`sample sample-${tone}`}>
						<summary>
							<span aria-hidden="true" className="swatch" />
							{name}
						</summary>
						<p>{product}</p>
					</details>
				))}
			</section>
			<Script src="/widget/gorbach.js" data-api="/api" strategy="afterInteractive" />
		</main>
	);
}
