"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  return (
    <div className="landing">
      <div className="brand">
        <h1>HOARDBOUND</h1>
        <div className="sub">LIVE</div>
        <div className="mode">◆ Dragon&apos;s Hoard ◆</div>
      </div>

      <button className="btn" onClick={() => router.push("/host")}>👑 Host a Game</button>

      <div className="join">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ROOM CODE"
          maxLength={5}
          onKeyDown={(e) => e.key === "Enter" && code && router.push(`/play/${code}`)}
        />
        <button className="btn ghost" style={{ width: "auto", padding: "0 22px" }}
          disabled={!code} onClick={() => router.push(`/play/${code}`)}>Join</button>
      </div>

      <div className="note">
        Host on desktop, add the viewer overlay to OBS at <b>/live/CODE</b>,<br />
        and players join from their phones with the room code.
      </div>
    </div>
  );
}
