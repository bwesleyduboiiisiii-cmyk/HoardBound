"use client";
// Shows a player's uploaded profile picture, falling back to their emoji avatar.
export default function Avatar({ url, emoji, size = 34 }) {
  if (url) {
    return <img className="pfp" src={url} alt="" style={{ width: size, height: size }} />;
  }
  return (
    <span className="pfp pfp-emoji" style={{ width: size, height: size, fontSize: Math.round(size * 0.56) }}>
      {emoji || "🎭"}
    </span>
  );
}
