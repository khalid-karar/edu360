import ShareButtons from "../../../components/ShareButtons";

export default function Thanks() {
  return (
    <main className="thanks">
      <h1>شكراً لك</h1>
      <p>تم تسجيل اهتمامك. سنتواصل معك عند فتح التجربة الأولى.</p>
      <ShareButtons />
      <a className="btn ghost-dark" href="/">
        العودة للرئيسية
      </a>
    </main>
  );
}
