import type { Metadata } from "next";
import Link from "next/link";
import { db, staff, revision } from "@/lib/admin";
import { submit } from "./actions";
import Editor from "./Editor";
import "./Admin.scss";
export const metadata: Metadata = {
	title: "Administrace | Gorbach",
	robots: { index: false },
};
type Params = Record<string, string | string[] | undefined>;
export default async function AdminPage({
	searchParams,
}: {
	searchParams: Promise<Params>;
}) {
	const params = await searchParams;
	const get = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
	const ru = get("lang") === "ru",
		lang = ru ? "ru" : "cs";
	const t = (cs: string, r: string) => (ru ? r : cs);
	const tabs = {
		leads: t("Poptávky", "Заявки"),
		dialogs: t("Rozhovory", "Диалоги"),
		knowledge: t("Znalosti", "База знаний"),
		survey: t("Dotazník", "Опросы"),
		stats: t("Statistiky", "Статистика"),
	};
	const section = Object.hasOwn(tabs, get("section"))
		? (get("section") as keyof typeof tabs)
		: "leads";
	const user = await staff();
	const hidden = (action: string) => (
		<>
			<input type="hidden" name="lang" value={lang} />
			<input type="hidden" name="section" value={section} />
			<input type="hidden" name="action" value={action} />
		</>
	);
	const transcript = (id: string) =>
		db()
			.prepare("SELECT role,body FROM messages WHERE dialog=? ORDER BY id")
			.all(id)
			.map((m, i) => (
				<p key={i}>
					<b>
						{m.role === "bot" ? t("Asistent", "Ассистент") : t("Návštěvník", "Посетитель")}
					</b>{" "}
					· {String(m.body)}
				</p>
			));
	const empty = <p>{t("Žádné záznamy.", "Записей нет.")}</p>;
	const statuses = ["Nová", "V řešení", "Hotovo"];
	const statusLabel = (s: string) =>
		ru ? { Nová: "Новая", "V řešení": "В работе", Hotovo: "Готово" }[s] || s : s;
	function content() {
		if (section === "knowledge" || section === "survey") {
			const rev = revision(section);
			return (
				<form action={submit}>
					{hidden(section)}
					<input type="hidden" name="version" value={Number(rev?.id || 0)} />
					<Editor
						ru={ru}
						knowledge={section === "knowledge"}
						initial={JSON.stringify(
							JSON.parse(
								String(
									rev?.content ??
										(section === "knowledge" ? "[]" : '{"products":{},"services":{}}'),
								),
							),
							null,
							2,
						)}
					/>
					<button>{t("Uložit verzi", "Сохранить версию")}</button>
					{rev && (
						<small>
							{String(rev.editor)} · {String(rev.created)} UTC
						</small>
					)}
				</form>
			);
		}
		if (section === "stats") {
			const metrics = [
				[t("Rozhovory", "Диалоги"), "SELECT COUNT(*) n FROM dialogs"],
				[t("Poptávky", "Заявки"), "SELECT COUNT(*) n FROM leads"],
				[
					t("Konverze (%)", "Конверсия (%)"),
					"SELECT ROUND(100.0*(SELECT COUNT(*) FROM leads)/MAX(COUNT(*),1),1) n FROM dialogs",
				],
				[
					t("Náklady (Kč)", "Расход (Kč)"),
					"SELECT ROUND(COALESCE(SUM(cost),0),2) n FROM messages",
				],
			];
			const breakdowns = [
				[t("Produkty", "Продукты"), "product"],
				[t("Jazyky", "Языки"), "lang"],
				[t("Vstupní stránky", "Страницы входа"), "page"],
				[t("Odchody u otázky", "Выходы на вопросе"), "exit_field"],
				[t("Úvodní tlačítka", "Стартовые кнопки"), "start_chip"],
			];
			return (
				<>
					<div className="metrics">
						{metrics.map(([title, sql]) => (
							<article key={title}>
								<small>{title}</small>
								<strong>{Number(db().prepare(sql).get()?.n)}</strong>
							</article>
						))}
					</div>
					{[
						...breakdowns.map(([title, col]) => [
							title,
							`SELECT ${col} label, COUNT(*) n FROM dialogs WHERE ${col}<>'' GROUP BY ${col} ORDER BY n DESC`,
						]),
						[
							t("Nezodpovězené otázky", "Вопросы без ответа"),
							"SELECT CASE WHEN role='bot' THEN (SELECT body FROM messages v WHERE v.dialog=m.dialog AND v.role<>'bot' AND v.id<m.id ORDER BY id DESC LIMIT 1) ELSE body END label, COUNT(*) n FROM messages m WHERE unknown=1 GROUP BY label ORDER BY n DESC",
						],
					].map(([title, sql]) => {
						const rows = db().prepare(sql).all();
						return (
							<section key={title}>
								<h3>{title}</h3>
								{rows.length
									? rows.map((r, i) => (
											<p key={i}>
												{String(r.label ?? "—")} · {Number(r.n)}
											</p>
										))
									: empty}
							</section>
						);
					})}
				</>
			);
		}
		if (section === "dialogs") {
			const q = get("q");
			const rows = db()
				.prepare(
					"SELECT * FROM dialogs d WHERE instr(lower(d.id),lower(?)) OR EXISTS(SELECT 1 FROM messages m WHERE m.dialog=d.id AND instr(lower(m.body),lower(?))) ORDER BY created DESC",
				)
				.all(q, q);
			return (
				<>
					<form>
						<input type="hidden" name="section" value="dialogs" />
						<input type="hidden" name="lang" value={lang} />
						<label>
							{t("Hledat v rozhovorech", "Поиск по диалогам")}
							<input name="q" defaultValue={q} />
						</label>
						<button>{t("Hledat", "Найти")}</button>
					</form>
					{rows.length
						? rows.map((d) => (
								<details key={String(d.id)}>
									<summary>
										{String(d.created)} · {String(d.lang)} · {String(d.id)}
									</summary>
									{transcript(String(d.id))}
								</details>
							))
						: empty}
				</>
			);
		}
		const labels = {
			kind: t("Typ", "Тип"),
			product: t("Produkt", "Продукт"),
			status: t("Stav", "Статус"),
			langFilter: t("Jazyk", "Язык"),
			date: t("Datum", "Дата"),
		};
		const cols = {
			kind: "l.kind",
			product: "l.product",
			status: "l.status",
			langFilter: "d.lang",
			date: "substr(l.created,1,10)",
		};
		const keys = Object.keys(cols) as (keyof typeof cols)[];
		const source = " FROM leads l JOIN dialogs d ON d.id=l.dialog";
		const active = keys.filter((k) => get(k));
		const rows = db()
			.prepare(
				"SELECT l.*,d.lang,d.page" +
					source +
					(active.length ? " WHERE " + active.map((k) => cols[k] + "=?").join(" AND ") : "") +
					" ORDER BY l.created DESC",
			)
			.all(...active.map(get));
		return (
			<>
				<form className="filters">
					<input type="hidden" name="lang" value={lang} />
					{keys.map((k) => (
						<label key={k}>
							{labels[k]}
							{k === "date" ? (
								<input type="date" name={k} defaultValue={get(k)} />
							) : (
								<select name={k} defaultValue={get(k)}>
									<option value="">{t("Vše", "Все")}</option>
									{(k === "status"
										? statuses
										: db()
												.prepare(
													"SELECT DISTINCT " +
														cols[k] +
														" val" +
														source +
														" WHERE " +
														cols[k] +
														" <> '' ORDER BY val",
												)
												.all()
												.map((r) => String(r.val))
									).map((v) => (
										<option key={v} value={v}>
											{k === "status" ? statusLabel(v) : v}
										</option>
									))}
								</select>
							)}
						</label>
					))}
					<button>{t("Filtrovat", "Применить")}</button>
				</form>
				{rows.length
					? rows.map((l) => (
							<details key={String(l.id)}>
								<summary>
									{String(l.id)} · {String(l.product || l.kind)} · {statusLabel(String(l.status))}
								</summary>
								<p>
									{String(l.created)} · {String(l.kind)} · {String(l.lang)} · {String(l.page)}
								</p>
								<h3>{t("Souhrn", "Сводка")}</h3>
								<p>{String(l.summary)}</p>
								<h3>{t("Kontakt", "Контакт")}</h3>
								<p>{String(l.contact)}</p>
								<pre>{String(l.fields)}</pre>
								<p>{String(l.delivery)}</p>
								{db()
									.prepare("SELECT id,name FROM files WHERE dialog=?")
									.all(l.dialog)
									.map((f) => (
										<p key={String(f.id)}>
											<a href={"/api/admin/files/" + encodeURIComponent(String(f.id))}>
												{String(f.name)}
											</a>
										</p>
									))}
								<h3>{tabs.dialogs}</h3>
								{transcript(String(l.dialog))}
								<form action={submit}>
									{hidden("status")}
									<input type="hidden" name="id" value={String(l.id)} />
									<label>
										{labels.status}
										<select name="status" defaultValue={String(l.status)}>
											{statuses.map((s) => (
												<option key={s} value={s}>
													{statusLabel(s)}
												</option>
											))}
										</select>
									</label>
									<button>{t("Uložit", "Сохранить")}</button>
								</form>
								<form action={submit}>
									{hidden("delete")}
									<input type="hidden" name="id" value={String(l.id)} />
									<label>
										<input type="checkbox" name="confirm" value="yes" required />{" "}
										{t("Odstranit i rozhovor a soubory", "Удалить также диалог и файлы")}
									</label>
									<button>{t("Smazat", "Удалить")}</button>
								</form>
							</details>
						))
					: empty}
			</>
		);
	}
	return (
		<main className="admin-page" lang={lang}>
			<header>
				<h1>{t("Administrace", "Администрирование")}</h1>
				<Link
					href={`/admin?lang=${ru ? "cs" : "ru"}&section=${section}`}
					lang={ru ? "cs" : "ru"}
				>
					{ru ? "Česky" : "Русский"}
				</Link>
			</header>
			{get("error") && (
				<p role="alert">
					{get("error") === "login"
						? t("Nesprávné přihlašovací údaje.", "Неверный логин или пароль.")
						: get("error") === "conflict"
							? t("Verze se změnila. Načtěte ji znovu.", "Версия изменилась. Обновите страницу.")
							: t("Zkontrolujte strukturu a hodnoty.", "Проверьте структуру и значения.")}
				</p>
			)}
			{user ? (
				<>
					<aside>
						<span>{user}</span>
						<form action={submit}>
							{hidden("logout")}
							<button>{t("Odhlásit", "Выйти")}</button>
						</form>
					</aside>
					<nav>
						{Object.entries(tabs).map(([k, title]) => (
							<Link
								key={k}
								aria-current={section === k ? "page" : undefined}
								href={`/admin?lang=${lang}&section=${k}`}
							>
								{title}
							</Link>
						))}
					</nav>
					<h2>{tabs[section]}</h2>
					{get("saved") === "1" && <p role="status">{t("Uloženo.", "Сохранено.")}</p>}
					{content()}
				</>
			) : (
				<form action={submit} className="login">
					{hidden("login")}
					<h2>{t("Přihlášení zaměstnance", "Вход для сотрудников")}</h2>
					<label>
						{t("Uživatelské jméno", "Логин")}
						<input autoComplete="username" name="login" required />
					</label>
					<label>
						{t("Heslo", "Пароль")}
						<input autoComplete="current-password" type="password" name="password" required />
					</label>
					<button>{t("Přihlásit se", "Войти")}</button>
				</form>
			)}
		</main>
	);
}
