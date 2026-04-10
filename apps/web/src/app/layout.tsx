export const metadata = {
  title: "SNS Agent",
  description: "Unified SNS management platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
