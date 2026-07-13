export const metadata = {
  title: "MentaLink",
  description: "AI-powered therapist matchmaking platform",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
