import Script from "next/script";
import "./Stand.scss";
import "./Adaptations.scss";

const samples = [
	{
		name: "Roller blinds",
		tone: "apricot",
		product: "A single sheet of fabric rolls around a tube.",
	},
	{
		name: "Venetian blinds",
		tone: "mint",
		product: "Tilt the slats to adjust incoming light.",
	},
	{
		name: "Pleated shades",
		tone: "lilac",
		product: "Folded fabric stacks into a compact profile.",
	},
];

export default function StandPage() {
	return (
		<main className="test-stand">
			<h1>Widget test stand</h1>
			<p>Hover over a sample or open it to test the page interactions.</p>
			<section className="sample-grid" aria-label="Product samples">
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
			<Script src="/widget/gorbach.js" data-api="/preview-api" strategy="afterInteractive" />
		</main>
	);
}
