import type { Metadata } from "next";
import "./Admin.scss";

export const metadata: Metadata = { title: "Administration | Gorbach" };
const sections = ["Leads", "Conversations", "Knowledge base", "Questionnaires", "Statistics"];

export default function AdminPage() {
	return (
		<main className="admin-page">
			<h1>Administration</h1>
			<p>Workspace preview. Live data will appear after the backend is connected.</p>
			<h2>Workspace sections</h2>
			<ul>{sections.map((section) => <li key={section}>{section}</li>)}</ul>
		</main>
	);
}
