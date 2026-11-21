"use client";
import { useState } from "react";
type Section = { id: string; title: string; text: string };
export default function Editor({
	initial,
	knowledge,
	ru,
}: {
	initial: string;
	knowledge: boolean;
	ru: boolean;
}) {
	const [sections, set] = useState<Section[]>(() =>
		knowledge ? JSON.parse(initial) : [],
	);
	const label = (cs: string, r: string) => (ru ? r : cs);
	if (!knowledge)
		return (
			<label>
				{label("Produkty, služby a otázky (JSON)", "Продукты, услуги и вопросы (JSON)")}
				<textarea name="content" rows={22} defaultValue={initial} required />
			</label>
		);
	const count = sections.reduce((sum, s) => sum + s.text.length, 0);
	return (
		<>
			<input type="hidden" name="content" value={JSON.stringify(sections)} />
			{sections.map((s, i) => (
				<fieldset key={s.id}>
					<legend>{i + 1}</legend>
					{(["title", "text"] as const).map((key) => (
						<label key={key}>
							{key === "title" ? label("Název", "Название") : label("Text", "Текст")}
							<textarea
								rows={key === "title" ? 1 : 6}
								required={key === "title"}
								value={s[key]}
								onChange={(e) =>
									set(
										sections.map((item, j) =>
											j === i ? { ...item, [key]: e.target.value } : item,
										),
									)
								}
							/>
						</label>
					))}
					<button
						type="button"
						disabled={i === 0}
						onClick={() => {
							const next = [...sections];
							[next[i - 1], next[i]] = [next[i], next[i - 1]];
							set(next);
						}}
					>
						{label("Posunout nahoru", "Переместить вверх")}
					</button>{" "}
					<button type="button" onClick={() => set(sections.filter((_, j) => j !== i))}>
						{label("Odebrat", "Убрать")}
					</button>
				</fieldset>
			))}
			<button
				type="button"
				onClick={() => set([...sections, { id: crypto.randomUUID(), title: "", text: "" }])}
			>
				{label("Přidat oddíl", "Добавить раздел")}
			</button>
			<p>
				{count.toLocaleString()} / 160 000 {label("znaků", "знаков")}
			</p>
		</>
	);
}
