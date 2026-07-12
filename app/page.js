"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInAccount } from "../lib/roomApi";

function fileToAvatar(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const s = 128, c = document.createElement("canvas");
      c.width = s; c.height = s;
      const ctx = c.getContext("2d");
      const scale = Math.max(s / img.width, s / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
      cb(c.toDataURL("image/jpeg", 0.82));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

export default function Home() {
  const router = useRouter();
  const [account, setAccount] = useState(undefined); // undefined = loading
  const [code, setCode] = useState("");
  // account form
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    try { setAccount(JSON.parse(localStorage.getItem("hb_account") || "null")); }
    catch (e) { setAccount(null); }
  }, []);

  async function enter() {
    setErr(""); setBusy(true);
    try {
      const acct = await signInAccount(username, pin, avatarUrl);
      localStorage.setItem("hb_account", JSON.stringify(acct));
      setAccount(acct);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  function signOut() {
    localStorage.removeItem("hb_account");
    setAccount(null); setUsername(""); setPin(""); setAvatarUrl(null);
  }

  if (account === undefined) {
    return <div className="landing-lair"><div className="landing-logo brand"><h1>HOARDBOUND</h1></div></div>;
  }

  // ---- Account gate ----
  if (!account) {
    return (
      <div className="landing-lair">
        <div className="landing-logo brand">
          <h1>HOARDBOUND</h1><div className="sub">LIVE</div><div className="mode">◆ Dragon&apos;s Hoard ◆</div>
        </div>
        <div className="landing-controls">
          <div className="label" style={{ marginBottom: 12, textAlign: "center" }}>Create your account</div>
          <div className="profile-edit" style={{ justifyContent: "center", marginBottom: 14 }}>
            <label className="pfp-upload" title="Add a profile picture">
              {avatarUrl
                ? <img className="pfp" src={avatarUrl} alt="" style={{ width: 84, height: 84 }} />
                : <span className="pfp pfp-emoji" style={{ width: 84, height: 84, fontSize: 30 }}>📷</span>}
              <span className="pfp-cam">＋</span>
              <input type="file" accept="image/*" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) fileToAvatar(f, setAvatarUrl); }} />
            </label>
          </div>
          <input className="profile-name" style={{ marginBottom: 10 }} value={username} maxLength={18}
            placeholder="Username" onChange={(e) => setUsername(e.target.value)} />
          <input className="profile-name" inputMode="numeric" value={pin} maxLength={5}
            placeholder="5-digit code" onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 5))}
            onKeyDown={(e) => e.key === "Enter" && enter()} />
          {err && <div className="note" style={{ color: "#ff8a72", marginTop: 8 }}>{err}</div>}
          <button className="btn host-cta" style={{ marginTop: 14 }}
            disabled={busy || !username.trim() || pin.length !== 5} onClick={enter}>
            {busy ? "…" : "Enter the Lair"}
          </button>
          <div className="note" style={{ marginTop: 10 }}>
            New here? Pick a username, a 5-digit code, and a photo.<br />
            Been here before? Enter the same username and code to sign back in.
          </div>
        </div>
      </div>
    );
  }

  // ---- Signed in: normal landing ----
  return (
    <div className="landing-lair">
      <div className="landing-logo brand">
        <h1>HOARDBOUND</h1><div className="sub">LIVE</div><div className="mode">◆ Dragon&apos;s Hoard ◆</div>
      </div>
      <div className="landing-controls">
        <div className="acct-chip">
          {account.avatarUrl
            ? <img className="pfp" src={account.avatarUrl} alt="" style={{ width: 30, height: 30 }} />
            : <span className="pfp pfp-emoji" style={{ width: 30, height: 30, fontSize: 16 }}>🎭</span>}
          <span>{account.username}</span>
          <button className="acct-out" onClick={signOut}>switch</button>
        </div>
        <button className="btn host-cta" onClick={() => router.push("/host")}>👑 Host a Game</button>
        <div className="or-div"><span>OR</span></div>
        <div className="join">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ROOM CODE" maxLength={5}
            onKeyDown={(e) => e.key === "Enter" && code && router.push(`/play/${code}`)} />
          <button className="btn ghost" style={{ width: "auto", padding: "0 26px" }}
            disabled={!code} onClick={() => router.push(`/play/${code}`)}>Join</button>
        </div>
        <button className="leaders-link" onClick={() => router.push("/leaders")}>🏆 Season Leaderboard</button>
      </div>
    </div>
  );
}
