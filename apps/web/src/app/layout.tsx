import "./globals.css";

export const metadata = {
  title: "SNS Agent",
  description: "Unified SNS management platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" data-theme="sns-agent">
      <body className="min-h-screen bg-base-100 font-sans text-base-content antialiased">
        {children}
      </body>
    </html>
  );
}
