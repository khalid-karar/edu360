import { SessionProvider } from "../../../lib/session";



export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="pt">{children}</div>
    </SessionProvider>
  );
}
