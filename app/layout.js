import "./globals.css";

export const metadata = {
  title: "Hoardbound — Dragon's Hoard",
  description: "Every stream changes the world.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
