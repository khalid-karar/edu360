import { ROLES } from "../../demo-data";
import Dash from "./Dash";

export const dynamicParams = false;
export function generateStaticParams() {
  return ROLES.map((r) => ({ role: r.key }));
}
export const metadata = { title: "لوحة تجريبية | عِلمك", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  return <Dash role={role} />;
}
