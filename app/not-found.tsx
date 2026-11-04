import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty-state" style={{ marginTop: 40 }}>
      <span className="empty-icon">🧭</span>
      <strong>Сторінку не знайдено</strong>
      <p>Можливо, посилання застаріло. Поверніться на головну через нижнє меню.</p>
      <Link href="/" className="button-primary" style={{ marginTop: 8, textDecoration: "none" }}>
        На головну
      </Link>
    </div>
  );
}
