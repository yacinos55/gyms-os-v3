import { useState, useEffect, useCallback, useRef } from "react";

// ══ SUPABASE CONFIG ══
const SB_URL = "https://rsuvfbcpribrmkbveiyp.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzdXZmYmNwcmlicm1rYnZlaXlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NzM0MjksImV4cCI6MjA5NDI0OTQyOX0.w76osoCdCN_Jkjge-fhZTHB7XUUM_vVTsFrt-CYCdfo";

// Minimal Supabase REST client (no SDK needed — works in any React env)
const sb = {
  _h: () => ({ "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: "return=representation" }),

  async select(table, filters = "") {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${filters}`, { headers: sb._h() });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },

  async insert(table, data) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: "POST", headers: sb._h(), body: JSON.stringify(Array.isArray(data) ? data : [data])
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },

  async update(table, data, filters) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${filters}`, {
      method: "PATCH", headers: sb._h(), body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },

  async delete(table, filters) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${filters}`, {
      method: "DELETE", headers: sb._h()
    });
    if (!r.ok) throw new Error(await r.text());
    return r.status === 204 ? [] : r.json();
  },

  async upsert(table, data) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { ...sb._h(), Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(Array.isArray(data) ? data : [data])
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
};

// ══════════════════════════════════════════════════════
//  DEVICE FINGERPRINT  — stable ID for this browser
// ══════════════════════════════════════════════════════
function getDeviceId() {
  let id = localStorage.getItem("gymos_device_id");
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("gymos_device_id", id);
  }
  return id;
}

// ══════════════════════════════════════════════════════
//  LICENSE GATE  — wraps the whole app
// ══════════════════════════════════════════════════════
function LicenseGate({ children }) {
  // "checking" = reading localStorage, "locked" = show code entry, 
  // "naming" = show gym name input, "unlocked" = show app
  const [status,   setStatus]   = useState("checking");
  const [inputCode, setInput]   = useState("");
  const [gymName,  setGymName]  = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [gymId,    setGymId]    = useState(null);
  const [licCode,  setLicCode]  = useState("");
  const [pendingCode, setPending] = useState("");  // code waiting for gym name
  const deviceId = getDeviceId();

  // ── On mount: check if already activated ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem("gymos_license");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.gymId && parsed.code) {
          setGymId(parsed.gymId);
          setLicCode(parsed.code);
          setStatus("unlocked");
          return;
        }
      }
    } catch(e) {}
    setStatus("locked");
  }, []);

  // ── Step 1: validate the code ──
  const checkCode = async () => {
    const trimmed = inputCode.trim().toUpperCase();
    if (!trimmed) return setError("Please enter your license code.");
    setLoading(true); setError("");
    try {
      const rows = await sb.select("license_codes", `code=eq.${encodeURIComponent(trimmed)}&select=code,used`);
      if (!rows || rows.length === 0) {
        setError("Code not found. Double-check for typos."); setLoading(false); return;
      }
      if (rows[0].used) {
        setError("This code is already activated on another device."); setLoading(false); return;
      }
      // Code is valid — move to name step
      setPending(trimmed);
      setStatus("naming");
    } catch(e) {
      setError("Connection error: " + e.message);
    }
    setLoading(false);
  };

  // ── Step 2: create gym with the provided name ──
  const confirmName = async () => {
    const name = gymName.trim() || "My Gym";
    setLoading(true); setError("");
    try {
      // 1. Create gym row in Supabase
      const gymsResult = await sb.insert("gyms", {
        license_code: pendingCode,
        gym_name:     name,
        device_id:    deviceId,
        settings:     {}
      });
      if (!gymsResult || gymsResult.length === 0) throw new Error("Failed to create gym record.");
      const gym = gymsResult[0];

      // 2. Mark license as used
      await sb.update(
        "license_codes",
        { used: true, activated_at: new Date().toISOString(), gym_name: name, device_id: deviceId },
        `code=eq.${encodeURIComponent(pendingCode)}`
      );

      // 3. Save to localStorage so next visit skips activation
      localStorage.setItem("gymos_license", JSON.stringify({ code: pendingCode, gymId: gym.id }));

      // 4. Unlock the app
      setGymId(gym.id);
      setLicCode(pendingCode);
      setStatus("unlocked");
    } catch(e) {
      setError("Activation failed: " + e.message);
      setStatus("locked");
    }
    setLoading(false);
  };

  // ── Screens ──
  if (status === "checking") return <SplashScreen label="STARTING UP…" />;
  if (status === "unlocked") return children({ gymId, licenseCode: licCode });

  const btnStyle = (disabled) => ({
    width:"100%", padding:"13px 0", background: disabled ? "#555" : "#e8ff47",
    color: disabled ? "#999" : "#000", border:"none", borderRadius:10,
    fontFamily:"DM Sans, sans-serif", fontWeight:700, fontSize:15,
    cursor: disabled ? "not-allowed" : "pointer", transition:"all 0.2s"
  });

  if (status === "naming") return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#0a0a0f", fontFamily:"DM Sans, sans-serif", padding:20 }}>
      <div style={{ width:"100%", maxWidth:420 }}>
        <LogoBlock />
        <div style={{ background:"#14141e", border:"1px solid #2a2a3a", borderRadius:20, padding:32 }}>
          <div style={{ fontFamily:"Bebas Neue, sans-serif", fontSize:22, letterSpacing:"0.06em", marginBottom:6, color:"#e8ff47" }}>✓ CODE ACCEPTED</div>
          <div style={{ color:"#8888a8", fontSize:13, marginBottom:24, lineHeight:1.6 }}>
            Code <span style={{ color:"#e8ff47", fontFamily:"monospace" }}>{pendingCode}</span> is valid.<br/>
            What is the name of your gym?
          </div>
          <label style={lblActivation}>Gym Name</label>
          <input
            autoFocus
            value={gymName}
            onChange={e => setGymName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && confirmName()}
            placeholder="e.g. Iron Wolf Gym"
            style={{ width:"100%", background:"#1a1a24", border:"1px solid #2a2a3a", color:"#f0f0f5",
              fontFamily:"DM Sans, sans-serif", padding:"12px 16px", borderRadius:10, fontSize:15,
              outline:"none", marginBottom:16, boxSizing:"border-box" }}
          />
          {error && <div style={{ color:"#f43f5e", fontSize:12, marginBottom:12 }}>⚠ {error}</div>}
          <button onClick={confirmName} disabled={loading} style={btnStyle(loading)}>
            {loading ? "Activating…" : "Launch GYM OS →"}
          </button>
          <button onClick={() => { setStatus("locked"); setError(""); }} disabled={loading}
            style={{ width:"100%", marginTop:10, padding:"10px 0", background:"transparent",
              border:"1px solid #2a2a3a", color:"#555570", borderRadius:10, cursor:"pointer", fontSize:13 }}>
            ← Back
          </button>
        </div>
      </div>
    </div>
  );

  // Default: locked (code entry)
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#0a0a0f", fontFamily:"DM Sans, sans-serif", padding:20 }}>
      <div style={{ width:"100%", maxWidth:420 }}>
        <LogoBlock />
        <div style={{ background:"#14141e", border:"1px solid #2a2a3a", borderRadius:20, padding:32 }}>
          <div style={{ fontFamily:"Bebas Neue, sans-serif", fontSize:22, letterSpacing:"0.06em", marginBottom:6, color:"#f0f0f5" }}>ACTIVATE YOUR LICENSE</div>
          <div style={{ color:"#8888a8", fontSize:13, marginBottom:24, lineHeight:1.6 }}>
            Enter the license code you received after purchase.
          </div>
          <label style={lblActivation}>License Code</label>
          <input
            autoFocus
            value={inputCode}
            onChange={e => { setInput(e.target.value.toUpperCase()); setError(""); }}
            onKeyDown={e => e.key === "Enter" && checkCode()}
            placeholder="GYMOS-XXXXX-XXXXX-XXXXX"
            style={{ width:"100%", background:"#1a1a24",
              border:`1px solid ${error ? "#f43f5e" : "#2a2a3a"}`,
              color:"#f0f0f5", fontFamily:"JetBrains Mono, monospace",
              padding:"12px 16px", borderRadius:10, fontSize:15, outline:"none",
              letterSpacing:"0.05em", marginBottom: error ? 8 : 16, boxSizing:"border-box" }}
          />
          {error && <div style={{ color:"#f43f5e", fontSize:12, marginBottom:12 }}>⚠ {error}</div>}
          <button onClick={checkCode} disabled={loading} style={btnStyle(loading)}>
            {loading ? "Checking…" : "Verify Code →"}
          </button>
          <div style={{ marginTop:16, padding:"12px 16px", background:"#111118", borderRadius:8, fontSize:12, color:"#555570", lineHeight:1.7 }}>
            <div style={{ color:"#8888a8", fontWeight:600, marginBottom:4 }}>No code yet?</div>
            Contact your GYM OS distributor to purchase a license.
          </div>
        </div>
        <div style={{ textAlign:"center", marginTop:16, fontSize:11, color:"#333348" }}>
          GYM OS v2.0 · One-time activation · Lifetime access
        </div>
      </div>
    </div>
  );
}

// Small reusable helpers for the activation screens
const LogoBlock = () => (
  <div style={{ textAlign:"center", marginBottom:32 }}>
    <div style={{ display:"inline-flex", width:72, height:72, borderRadius:18, background:"#e8ff47",
      alignItems:"center", justifyContent:"center", fontFamily:"Bebas Neue, sans-serif",
      fontSize:38, color:"#000", marginBottom:12 }}>G</div>
    <div style={{ fontFamily:"Bebas Neue, sans-serif", fontSize:44, letterSpacing:"0.08em", color:"#f0f0f5", lineHeight:1 }}>GYM OS</div>
    <div style={{ color:"#8888a8", fontSize:13, marginTop:4 }}>Professional Gym Management</div>
  </div>
);

const SplashScreen = ({ label }) => (
  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
    height:"100vh", background:"#0a0a0f", gap:16 }}>
    <div style={{ fontFamily:"Bebas Neue, sans-serif", fontSize:48, letterSpacing:"0.08em", color:"#e8ff47" }}>GYM OS</div>
    <div style={{ color:"#8888a8", fontSize:13 }}>{label}</div>
    <div style={{ width:180, height:3, background:"#1a1a24", borderRadius:99, overflow:"hidden", marginTop:8 }}>
      <div style={{ height:"100%", width:"50%", background:"#e8ff47", borderRadius:99, animation:"pulse 1.2s ease-in-out infinite" }} />
    </div>
  </div>
);

const lblActivation = { display:"block", fontSize:11, color:"#555570", fontWeight:600,
  textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 };

// ══════════════════════════════════════════════════════
//  SHAPE CONVERTERS  (pure functions, no hooks)
// ══════════════════════════════════════════════════════
const dbToMember  = r => ({ id: r.id, name: r.name, email: r.email||"", phone: r.phone||"", offerId: r.offer_id, startDate: r.start_date, photo: r.photo||null, avatar: r.avatar||(r.name||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2), checkins:[] });
const dbToTx      = r => ({ id: r.id, date: r.date, type: r.type, category: r.category, desc: r.description, amount: parseFloat(r.amount) });
const dbToItem    = r => ({ id: r.id, name: r.name, category: r.category, price: parseFloat(r.price), cost: parseFloat(r.cost||0), qty: r.qty });
const dbToCheckin = r => ({ memberId: r.member_id, time: r.checked_in_at });

// ══════════════════════════════════════════════════════
//  DATA HOOKS  — clean version, NO async inside setState
// ══════════════════════════════════════════════════════
function useGymData(gymId) {
  const [members,     setMembersRaw]     = useState([]);
  const [transactions,setTransactionsRaw]= useState([]);
  const [inventory,   setInventoryRaw]   = useState([]);
  const [checkins,    setCheckinsRaw]    = useState([]);
  const [gymSettings, setGymSettingsRaw] = useState(null);
  const [loading,     setLoading]        = useState(false);

  // Keep a ref so sync helpers can read latest state without stale closure
  const membersRef     = useRef([]);
  const txRef          = useRef([]);
  const invRef         = useRef([]);
  const checkinsRef    = useRef([]);

  // ── Initial load ──
  useEffect(() => {
    if (!gymId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [mems, txs, inv, chks, gym] = await Promise.all([
          sb.select("members",      `gym_id=eq.${gymId}&order=created_at.asc`),
          sb.select("transactions", `gym_id=eq.${gymId}&order=created_at.asc`),
          sb.select("inventory",    `gym_id=eq.${gymId}&order=created_at.asc`),
          sb.select("checkins",     `gym_id=eq.${gymId}&order=checked_in_at.desc&limit=500`),
          sb.select("gyms",         `id=eq.${gymId}`),
        ]);
        if (cancelled) return;
        const m = mems.map(dbToMember);
        const t = txs.map(dbToTx);
        const i = inv.map(dbToItem);
        const c = chks.map(dbToCheckin);
        membersRef.current  = m;
        txRef.current       = t;
        invRef.current      = i;
        checkinsRef.current = c;
        setMembersRaw(m);
        setTransactionsRaw(t);
        setInventoryRaw(i);
        setCheckinsRaw(c);
        if (gym[0]?.settings && Object.keys(gym[0].settings).length) {
          setGymSettingsRaw({ ...DEFAULT_SETTINGS, ...gym[0].settings });
        }
      } catch(e) {
        console.error("GymOS load error:", e);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [gymId]);

  // ── MEMBERS setter — compute diff THEN update state, THEN sync DB ──
  const setMembers = (updater) => {
    const prev = membersRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    // Compute diff before touching state
    const prevIds = new Set(prev.map(m => m.id));
    const nextIds = new Set(next.map(m => m.id));
    const added   = next.filter(m => !prevIds.has(m.id));
    const removed = prev.filter(m => !nextIds.has(m.id));
    const changed = next.filter(m => {
      const old = prev.find(p => p.id === m.id);
      return old && JSON.stringify(old) !== JSON.stringify(m);
    });
    // Update state + ref
    membersRef.current = next;
    setMembersRaw(next);
    // Fire-and-forget DB sync (outside setState — no hook violation)
    added.forEach(m => sb.insert("members", {
      gym_id: gymId, name: m.name, email: m.email, phone: m.phone,
      offer_id: m.offerId, start_date: m.startDate, photo: m.photo, avatar: m.avatar
    }).then(rows => {
      // If DB returned a real UUID replace the temp id
      if (rows && rows[0] && rows[0].id !== m.id) {
        membersRef.current = membersRef.current.map(x => x.id === m.id ? { ...x, id: rows[0].id } : x);
        setMembersRaw([...membersRef.current]);
      }
    }).catch(console.error));
    removed.forEach(m => sb.delete("members", `id=eq.${m.id}`).catch(console.error));
    changed.forEach(m => sb.update("members", {
      name: m.name, email: m.email, phone: m.phone,
      offer_id: m.offerId, start_date: m.startDate, photo: m.photo
    }, `id=eq.${m.id}`).catch(console.error));
  };

  // ── TRANSACTIONS setter ──
  const setTransactions = (updater) => {
    const prev = txRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    const prevIds = new Set(prev.map(t => t.id));
    const nextIds = new Set(next.map(t => t.id));
    const added   = next.filter(t => !prevIds.has(t.id));
    const removed = prev.filter(t => !nextIds.has(t.id));
    txRef.current = next;
    setTransactionsRaw(next);
    added.forEach(t => sb.insert("transactions", {
      gym_id: gymId, date: t.date, type: t.type,
      category: t.category, description: t.desc, amount: t.amount
    }).catch(console.error));
    removed.forEach(t => sb.delete("transactions", `id=eq.${t.id}`).catch(console.error));
  };

  // ── INVENTORY setter ──
  const setInventory = (updater) => {
    const prev = invRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    const prevIds = new Set(prev.map(i => i.id));
    const nextIds = new Set(next.map(i => i.id));
    const added   = next.filter(i => !prevIds.has(i.id));
    const removed = prev.filter(i => !nextIds.has(i.id));
    const changed = next.filter(i => {
      const old = prev.find(p => p.id === i.id);
      return old && JSON.stringify(old) !== JSON.stringify(i);
    });
    invRef.current = next;
    setInventoryRaw(next);
    added.forEach(i => sb.insert("inventory", {
      gym_id: gymId, name: i.name, category: i.category,
      price: i.price, cost: i.cost, qty: i.qty
    }).catch(console.error));
    removed.forEach(i => sb.delete("inventory", `id=eq.${i.id}`).catch(console.error));
    changed.forEach(i => sb.update("inventory", {
      name: i.name, category: i.category,
      price: i.price, cost: i.cost, qty: i.qty
    }, `id=eq.${i.id}`).catch(console.error));
  };

  // ── CHECKINS setter ──
  const setCheckins = (updater) => {
    const prev = checkinsRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    const added = next.filter(c => !prev.some(p => p.memberId === c.memberId && p.time === c.time));
    checkinsRef.current = next;
    setCheckinsRaw(next);
    added.forEach(c => sb.insert("checkins", {
      gym_id: gymId, member_id: c.memberId, checked_in_at: c.time
    }).catch(console.error));
  };

  // ── SETTINGS saver ──
  const saveSettings = (s) => {
    setGymSettingsRaw(s);
    sb.update("gyms", { settings: s, updated_at: new Date().toISOString() }, `id=eq.${gymId}`).catch(console.error);
  };

  return { members, setMembers, transactions, setTransactions, inventory, setInventory, checkins, setCheckins, gymSettings, saveSettings, loading };
}


// ─── Fonts via Google Fonts injected in head ───
const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&family=JetBrains+Mono:wght@400;500&display=swap";
document.head.appendChild(fontLink);

// ─── Global Styles ───
const globalStyle = document.createElement("style");
globalStyle.textContent = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0a0a0f;
    --bg2: #111118;
    --bg3: #1a1a24;
    --card: #14141e;
    --border: #2a2a3a;
    --accent: #e8ff47;
    --accent2: #ff4757;
    --accent3: #00d4aa;
    --text: #f0f0f5;
    --text2: #8888a8;
    --text3: #555570;
    --font-display: 'Bebas Neue', sans-serif;
    --font-body: 'DM Sans', sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
  }
  body { background: var(--bg); color: var(--text); font-family: var(--font-body); }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: var(--bg2); }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
  input, select, textarea {
    background: var(--bg3); border: 1px solid var(--border);
    color: var(--text); font-family: var(--font-body);
    padding: 10px 14px; border-radius: 8px; font-size: 14px;
    outline: none; width: 100%;
    transition: border-color 0.2s;
  }
  input:focus, select:focus, textarea:focus { border-color: var(--accent); }
  select option { background: var(--bg3); }
  button { cursor: pointer; font-family: var(--font-body); border: none; }
  @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes blink { 0%,100% { opacity:1; } 50% { opacity:0; } }
  .fade-up { animation: fadeUp 0.4s ease both; }
`;
document.head.appendChild(globalStyle);

// ─── Seed Data ───
const OFFERS = [
  { id: "monthly", label: "Monthly", price: 45, days: 30, color: "#e8ff47" },
  { id: "quarterly", label: "Quarterly", price: 120, days: 90, color: "#00d4aa" },
  { id: "annual", label: "Annual", price: 399, days: 365, color: "#a78bfa" },
  { id: "student", label: "Student", price: 25, days: 30, color: "#fb923c" },
  { id: "vip", label: "VIP", price: 89, days: 30, color: "#f43f5e" },
  { id: "day", label: "Day Pass", price: 12, days: 1, color: "#38bdf8" },
];

const seedMembers = [
  { id: 1, name: "Marcus Reid", email: "marcus@email.com", phone: "555-0101", offerId: "vip", startDate: "2026-04-15", avatar: "MR", checkins: [] },
  { id: 2, name: "Sofia Chen", email: "sofia@email.com", phone: "555-0102", offerId: "monthly", startDate: "2026-05-01", avatar: "SC", checkins: [] },
  { id: 3, name: "Darius Webb", email: "darius@email.com", phone: "555-0103", offerId: "student", startDate: "2026-04-20", avatar: "DW", checkins: [] },
  { id: 4, name: "Priya Sharma", email: "priya@email.com", phone: "555-0104", offerId: "quarterly", startDate: "2026-03-01", avatar: "PS", checkins: [] },
  { id: 5, name: "Jake Torres", email: "jake@email.com", phone: "555-0105", offerId: "annual", startDate: "2026-01-10", avatar: "JT", checkins: [] },
  { id: 6, name: "Leila Osei", email: "leila@email.com", phone: "555-0106", offerId: "monthly", startDate: "2026-05-05", avatar: "LO", checkins: [] },
];

const seedInventory = [
  { id: 1, name: "Water Bottle (500ml)", category: "drinks", price: 2.5, cost: 0.8, qty: 48 },
  { id: 2, name: "Protein Shake (Vanilla)", category: "shakes", price: 6, cost: 2.2, qty: 20 },
  { id: 3, name: "Protein Shake (Choc)", category: "shakes", price: 6, cost: 2.2, qty: 18 },
  { id: 4, name: "Energy Bar", category: "snacks", price: 3.5, cost: 1.2, qty: 30 },
  { id: 5, name: "Electrolyte Drink", category: "drinks", price: 4, cost: 1.5, qty: 24 },
  { id: 6, name: "Banana", category: "snacks", price: 1.5, cost: 0.3, qty: 15 },
  { id: 7, name: "Pre-Workout Shot", category: "supplements", price: 5, cost: 1.8, qty: 12 },
  { id: 8, name: "Creatine Sachet", category: "supplements", price: 4, cost: 1.4, qty: 25 },
];

const now = new Date();
const today = now.toISOString().split("T")[0];
const seedTransactions = [
  { id: 1, date: "2026-05-01", type: "in", category: "membership", desc: "VIP - Marcus Reid", amount: 89 },
  { id: 2, date: "2026-05-01", type: "in", category: "membership", desc: "Monthly - Sofia Chen", amount: 45 },
  { id: 3, date: "2026-05-02", type: "out", category: "rent", desc: "Monthly Rent", amount: 2200 },
  { id: 4, date: "2026-05-03", type: "out", category: "electricity", desc: "Electricity Bill", amount: 380 },
  { id: 5, date: "2026-05-04", type: "in", category: "fridge", desc: "Fridge Sales", amount: 47.5 },
  { id: 6, date: "2026-05-05", type: "in", category: "membership", desc: "Monthly - Leila Osei", amount: 45 },
  { id: 7, date: "2026-05-06", type: "out", category: "salary", desc: "Staff Salaries", amount: 3200 },
  { id: 8, date: "2026-05-07", type: "out", category: "supplies", desc: "Equipment Maintenance", amount: 145 },
  { id: 9, date: "2026-05-08", type: "in", category: "fridge", desc: "Fridge Sales", amount: 63 },
  { id: 10, date: "2026-05-09", type: "in", category: "membership", desc: "Student - Darius Webb", amount: 25 },
  { id: 11, date: today, type: "out", category: "supplies", desc: "Cleaning Supplies", amount: 58 },
  { id: 12, date: today, type: "in", category: "fridge", desc: "Fridge Sales", amount: 28.5 },
];

// ─── Helpers ───
const getOffer = (id) => OFFERS.find((o) => o.id === id) || OFFERS[0];
const daysLeft = (startDate, offerDays) => {
  const end = new Date(startDate);
  end.setDate(end.getDate() + offerDays);
  const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
};

// ─── Default Settings ───
const DEFAULT_SETTINGS = {
  gymName: "GYM OS",
  currency: "USD",
  currencySymbol: "$",
  currencyPos: "before",
  dateFormat: "YYYY-MM-DD",
  capacity: 40,
  accentColor: "#e8ff47",
  renewMode: "extend",
  taxRate: 0,
};

// Settings-aware formatters (call makeFmt(settings) to get a formatter)
const makeFmt  = (s) => (n) => { const sym = s.currencySymbol || "$"; const val = new Intl.NumberFormat("en-US",{maximumFractionDigits:0}).format(Math.abs(n)); return s.currencyPos==="after" ? `${n<0?"-":""}${val}${sym}` : `${n<0?"-":""}${sym}${val}`; };
const makeFmtD = (s) => (n) => { const sym = s.currencySymbol || "$"; const val = Math.abs(n).toFixed(2); return s.currencyPos==="after" ? `${n<0?"-":""}${val}${sym}` : `${n<0?"-":""}${sym}${val}`; };
const fmtDate  = (dateStr, format) => { if (!dateStr) return ""; const [y,m,d] = dateStr.split("-"); if (format==="MM/DD/YYYY") return `${m}/${d}/${y}`; if (format==="DD/MM/YYYY") return `${d}/${m}/${y}`; return dateStr; };
// Static fallback formatters (no settings context)
const fmt  = makeFmt(DEFAULT_SETTINGS);
const fmtD = makeFmtD(DEFAULT_SETTINGS);

// ─── Components ───
const Badge = ({ color, children }) => (
  <span style={{
    background: color + "22", color, border: `1px solid ${color}55`,
    borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 600,
    letterSpacing: "0.03em", whiteSpace: "nowrap"
  }}>{children}</span>
);

const Btn = ({ children, onClick, variant = "primary", size = "md", style: s = {}, disabled }) => {
  const sizes = { sm: { padding: "6px 14px", fontSize: 12 }, md: { padding: "10px 20px", fontSize: 14 }, lg: { padding: "13px 28px", fontSize: 15 } };
  const variants = {
    primary: { background: "var(--accent)", color: "#000", fontWeight: 700 },
    danger: { background: "var(--accent2)", color: "#fff", fontWeight: 700 },
    ghost: { background: "transparent", color: "var(--text)", border: "1px solid var(--border)", fontWeight: 500 },
    success: { background: "var(--accent3)", color: "#000", fontWeight: 700 },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...sizes[size], ...variants[variant], borderRadius: 8,
      transition: "opacity 0.15s, transform 0.1s",
      opacity: disabled ? 0.5 : 1, ...s
    }}
      onMouseEnter={e => !disabled && (e.target.style.opacity = "0.85")}
      onMouseLeave={e => !disabled && (e.target.style.opacity = "1")}
    >{children}</button>
  );
};

const Card = ({ children, style: s = {}, className = "" }) => (
  <div className={className} style={{
    background: "var(--card)", border: "1px solid var(--border)",
    borderRadius: 16, padding: 24, ...s
  }}>{children}</div>
);

const StatCard = ({ label, value, sub, accent, icon, delay = 0 }) => (
  <Card style={{ animationDelay: `${delay}ms` }} className="fade-up">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <div>
        <div style={{ color: "var(--text2)", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
        <div style={{ fontSize: 32, fontFamily: "var(--font-display)", letterSpacing: "0.02em", color: accent || "var(--text)" }}>{value}</div>
        {sub && <div style={{ color: "var(--text2)", fontSize: 12, marginTop: 4 }}>{sub}</div>}
      </div>
      {icon && <div style={{ fontSize: 28, opacity: 0.6 }}>{icon}</div>}
    </div>
  </Card>
);

const TrafficMeter = ({ pct, label }) => {
  const color = pct < 40 ? "var(--accent3)" : pct < 70 ? "var(--accent)" : "var(--accent2)";
  const status = pct < 40 ? "QUIET" : pct < 70 ? "MODERATE" : "BUSY";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "var(--text2)", fontWeight: 500 }}>{label}</span>
        <Badge color={color}>{status}</Badge>
      </div>
      <div style={{ background: "var(--bg3)", borderRadius: 99, height: 10, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, background: color,
          borderRadius: 99, transition: "width 1s cubic-bezier(0.34,1.56,0.64,1)",
          boxShadow: `0 0 12px ${color}`
        }} />
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, color, fontWeight: 500 }}>{pct}%</div>
    </div>
  );
};

// ─── Root App with License Gate ───
export default function App() {
  return (
    <LicenseGate>
      {({ gymId, licenseCode }) => <GymOS gymId={gymId} licenseCode={licenseCode} />}
    </LicenseGate>
  );
}

// ─── Main App ───
function GymOS({ gymId, licenseCode }) {
  const [view, setView] = useState("dashboard");
  const [userMode, setUserMode] = useState("admin"); // admin | member
  const [activeMemberId, setActiveMemberId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [clock, setClock] = useState(new Date());
  const [notification, setNotification] = useState(null);

  const { members, setMembers, transactions, setTransactions, inventory, setInventory, checkins, setCheckins, gymSettings, saveSettings, loading } = useGymData(gymId);

  const [settings, setSettingsLocal] = useState(DEFAULT_SETTINGS);

  // Sync gymSettings from DB into local once loaded
  useEffect(() => { if (gymSettings) setSettingsLocal(gymSettings); }, [gymSettings]);

  const setSettings = (s) => { setSettingsLocal(s); saveSettings(s); };

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"var(--bg)", flexDirection:"column", gap:16 }}>
      <div style={{ fontFamily:"var(--font-display)", fontSize:48, letterSpacing:"0.08em", color:"var(--accent)" }}>GYM OS</div>
      <div style={{ color:"var(--text2)", fontSize:14 }}>Loading your gym data…</div>
      <div style={{ width:200, height:3, background:"var(--bg3)", borderRadius:99, overflow:"hidden", marginTop:8 }}>
        <div style={{ height:"100%", width:"60%", background:"var(--accent)", borderRadius:99, animation:"pulse 1.5s infinite" }} />
      </div>
    </div>
  );

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", settings.accentColor || "#e8ff47");
  }, [settings.accentColor]);

  const notify = (msg, type = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // Busyness: checkins in last 2 hours / total members * 100
  const recentCheckins = checkins.filter(c => (clock - new Date(c.time)) < 2 * 3600 * 1000);
  const uniqueRecent = [...new Set(recentCheckins.map(c => c.memberId))].length;
  const busynessPct = settings.capacity > 0 ? Math.min(100, Math.round((uniqueRecent / settings.capacity) * 100)) : 0;

  // Finance totals
  const totalIn = transactions.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
  const totalOut = transactions.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
  const net = totalIn - totalOut;

  const navItems = [
    { id: "dashboard", icon: "⬡", label: "Dashboard" },
    { id: "members", icon: "◈", label: "Members" },
    { id: "finances", icon: "◉", label: "Finances" },
    { id: "fridge", icon: "◫", label: "Fridge & POS" },
    { id: "checkin", icon: "◎", label: "Check-In" },
    { id: "settings", icon: "◐", label: "Settings" },
  ];

  const memberNavItems = [
    { id: "portal", icon: "◎", label: "My Dashboard" },
  ];

  const activeNav = userMode === "admin" ? navItems : memberNavItems;

  // Switch to member view — pick first member
  const handleMemberLogin = (id) => {
    setActiveMemberId(id);
    setUserMode("member");
    setView("portal");
  };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg)", fontFamily: "var(--font-body)" }}>
      {/* Notification Toast */}
      {notification && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999,
          background: notification.type === "success" ? "var(--accent3)" : notification.type === "error" ? "var(--accent2)" : "var(--accent)",
          color: "#000", padding: "12px 20px", borderRadius: 10,
          fontWeight: 600, fontSize: 13, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          animation: "fadeUp 0.3s ease"
        }}>{notification.msg}</div>
      )}

      {/* Sidebar */}
      <aside style={{
        width: sidebarOpen ? 220 : 64, minWidth: sidebarOpen ? 220 : 64,
        background: "var(--bg2)", borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column", transition: "width 0.3s cubic-bezier(0.4,0,0.2,1)",
        overflow: "hidden", zIndex: 100, flexShrink: 0
      }}>
        {/* Logo */}
        <div style={{ padding: "20px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-display)", color: "#000", fontSize: 16, letterSpacing: "0.05em"
          }}>G</div>
          {sidebarOpen && <div style={{ fontFamily: "var(--font-display)", fontSize: 20, letterSpacing: "0.08em", color: "var(--text)", whiteSpace: "nowrap" }}>{settings.gymName || "GYM OS"}</div>}
        </div>

        {/* Mode toggle */}
        {sidebarOpen && (
          <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", background: "var(--bg3)", borderRadius: 8, padding: 3 }}>
              {["admin", "member"].map(m => (
                <button key={m} onClick={() => {
                  if (m === "member") { setView("portal"); setUserMode("member"); }
                  else { setView("dashboard"); setUserMode("admin"); }
                }} style={{
                  flex: 1, padding: "5px 0", borderRadius: 6, fontSize: 11, fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  background: userMode === m ? "var(--accent)" : "transparent",
                  color: userMode === m ? "#000" : "var(--text2)", border: "none",
                  transition: "all 0.2s"
                }}>{m}</button>
              ))}
            </div>
          </div>
        )}

        {/* Nav */}
        <nav style={{ flex: 1, padding: "12px 10px", display: "flex", flexDirection: "column", gap: 4, overflowY: "auto" }}>
          {activeNav.map(item => (
            <button key={item.id} onClick={() => setView(item.id)} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 10px", borderRadius: 10, border: "none",
              background: view === item.id ? "var(--accent)22" : "transparent",
              color: view === item.id ? "var(--accent)" : "var(--text2)",
              borderLeft: view === item.id ? "2px solid var(--accent)" : "2px solid transparent",
              fontWeight: view === item.id ? 600 : 400, fontSize: 13,
              transition: "all 0.15s", textAlign: "left", whiteSpace: "nowrap",
              cursor: "pointer"
            }}>
              <span style={{ fontSize: 18, flexShrink: 0, minWidth: 22, textAlign: "center" }}>{item.icon}</span>
              {sidebarOpen && item.label}
            </button>
          ))}
        </nav>

        {/* Clock */}
        {sidebarOpen && (
          <div style={{ padding: "16px 18px", borderTop: "1px solid var(--border)" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, color: "var(--accent)", letterSpacing: "0.05em" }}>
              {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
            <div style={{ color: "var(--text3)", fontSize: 11, marginTop: 2 }}>
              {clock.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
            </div>
          </div>
        )}

        {/* Toggle */}
        <button onClick={() => setSidebarOpen(p => !p)} style={{
          margin: "0 10px 12px", padding: "8px 0", borderRadius: 8, border: "1px solid var(--border)",
          background: "transparent", color: "var(--text3)", fontSize: 14, transition: "color 0.2s"
        }}>
          {sidebarOpen ? "←" : "→"}
        </button>
      </aside>

      {/* Main Content */}
      <main style={{ flex: 1, overflowY: "auto", padding: 28 }}>
        {view === "dashboard" && <Dashboard members={members} transactions={transactions} busynessPct={busynessPct} uniqueRecent={uniqueRecent} net={net} totalIn={totalIn} totalOut={totalOut} inventory={inventory} recentCheckins={recentCheckins} settings={settings} />}
        {view === "members" && <Members members={members} setMembers={setMembers} transactions={transactions} setTransactions={setTransactions} notify={notify} onMemberLogin={handleMemberLogin} settings={settings} />}
        {view === "finances" && <Finances transactions={transactions} setTransactions={setTransactions} notify={notify} totalIn={totalIn} totalOut={totalOut} net={net} settings={settings} />}
        {view === "fridge" && <FridgePOS inventory={inventory} setInventory={setInventory} transactions={transactions} setTransactions={setTransactions} notify={notify} settings={settings} />}
        {view === "checkin" && <CheckIn members={members} checkins={checkins} setCheckins={setCheckins} recentCheckins={recentCheckins} notify={notify} settings={settings} />}
        {view === "portal" && <MemberPortal memberId={activeMemberId} members={members} busynessPct={busynessPct} uniqueRecent={uniqueRecent} onSelectMember={setActiveMemberId} settings={settings} />}
        {view === "settings" && <Settings settings={settings} setSettings={setSettings} notify={notify} />}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════
function Dashboard({ members, transactions, busynessPct, uniqueRecent, net, totalIn, totalOut, inventory, recentCheckins, settings }) {
  const fmt = makeFmt(settings); const fmtD = makeFmtD(settings);
  const todayTx = transactions.filter(t => t.date === today);
  const todayIn = todayTx.filter(t => t.type === "in").reduce((s, t) => s + t.amount, 0);
  const todayOut = todayTx.filter(t => t.type === "out").reduce((s, t) => s + t.amount, 0);
  const expiringSoon = members.filter(m => {
    const offer = getOffer(m.offerId);
    return daysLeft(m.startDate, offer.days) <= 7 && daysLeft(m.startDate, offer.days) > 0;
  });
  const lowStock = inventory.filter(i => i.qty <= 5);

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ marginBottom: 28 }} className="fade-up">
        <div style={{ fontFamily: "var(--font-display)", fontSize: 42, letterSpacing: "0.05em", lineHeight: 1 }}>COMMAND CENTER</div>
        <div style={{ color: "var(--text2)", fontSize: 14, marginTop: 6 }}>Live overview — {new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>
      </div>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
        <StatCard label="Active Members" value={members.length} icon="◈" delay={0} />
        <StatCard label="In Gym Now" value={uniqueRecent} sub="checked in ≤ 2 hrs" accent="var(--accent3)" icon="◉" delay={60} />
        <StatCard label="Today Revenue" value={fmt(todayIn)} sub={`${todayTx.filter(t => t.type === "in").length} transactions`} accent="var(--accent)" icon="▲" delay={120} />
        <StatCard label="Monthly Net" value={fmt(net)} sub={net >= 0 ? "Profitable" : "In deficit"} accent={net >= 0 ? "var(--accent3)" : "var(--accent2)"} icon={net >= 0 ? "↑" : "↓"} delay={180} />
      </div>

      {/* Two col */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Busyness */}
        <Card className="fade-up" style={{ animationDelay: "240ms" }}>
          <div style={{ fontWeight: 700, marginBottom: 20, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text2)" }}>Live Gym Traffic</div>
          <TrafficMeter pct={busynessPct} label={`${uniqueRecent} of ${members.length} members present`} />
          <div style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[0, 25, 50, 75, 100].map(p => (
              <div key={p} style={{ flex: 1, minWidth: 40, textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>{p}%</div>
                <div style={{ height: 3, background: busynessPct >= p ? "var(--accent3)" : "var(--bg3)", borderRadius: 2, marginTop: 2 }} />
              </div>
            ))}
          </div>
        </Card>

        {/* Finance mini-summary */}
        <Card className="fade-up" style={{ animationDelay: "300ms" }}>
          <div style={{ fontWeight: 700, marginBottom: 20, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text2)" }}>Finance Pulse</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { label: "Revenue", val: totalIn, color: "var(--accent3)" },
              { label: "Expenses", val: totalOut, color: "var(--accent2)" },
              { label: "Net Profit", val: net, color: net >= 0 ? "var(--accent)" : "var(--accent2)" },
            ].map(row => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text2)", fontSize: 13 }}>{row.label}</span>
                <span style={{ fontFamily: "var(--font-mono)", color: row.color, fontSize: 16, fontWeight: 500 }}>{fmt(row.val)}</span>
              </div>
            ))}
            <div style={{ height: 1, background: "var(--border)", marginTop: 4 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, background: "var(--bg3)", borderRadius: 99, height: 6, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(100, (totalIn / (totalIn + totalOut)) * 100)}%`, background: "var(--accent3)", borderRadius: 99 }} />
              </div>
            </div>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>Margin: {totalIn > 0 ? ((net / totalIn) * 100).toFixed(1) : 0}%</div>
          </div>
        </Card>
      </div>

      {/* Alerts */}
      {(expiringSoon.length > 0 || lowStock.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          {expiringSoon.length > 0 && (
            <Card className="fade-up" style={{ borderColor: "var(--accent)44" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span style={{ color: "var(--accent)", fontSize: 16 }}>⚠</span>
                <div style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--accent)" }}>Expiring Soon</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {expiringSoon.map(m => {
                  const offer = getOffer(m.offerId);
                  return (
                    <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 13 }}>{m.name}</div>
                      <Badge color="var(--accent)">{daysLeft(m.startDate, offer.days)}d left</Badge>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
          {lowStock.length > 0 && (
            <Card className="fade-up" style={{ borderColor: "var(--accent2)44" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span style={{ color: "var(--accent2)", fontSize: 16 }}>⚠</span>
                <div style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--accent2)" }}>Low Stock</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {lowStock.map(item => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 13 }}>{item.name}</div>
                    <Badge color="var(--accent2)">{item.qty} left</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Recent transactions */}
      <Card className="fade-up" style={{ animationDelay: "360ms" }}>
        <div style={{ fontWeight: 700, marginBottom: 16, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text2)" }}>Recent Transactions</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Date", "Type", "Category", "Description", "Amount"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, color: "var(--text3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...transactions].reverse().slice(0, 8).map(tx => (
                <tr key={tx.id} style={{ borderBottom: "1px solid var(--border)55" }}>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text2)", fontFamily: "var(--font-mono)" }}>{tx.date}</td>
                  <td style={{ padding: "10px 12px" }}><Badge color={tx.type === "in" ? "var(--accent3)" : "var(--accent2)"}>{tx.type === "in" ? "IN" : "OUT"}</Badge></td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text2)", textTransform: "capitalize" }}>{tx.category}</td>
                  <td style={{ padding: "10px 12px", fontSize: 13 }}>{tx.desc}</td>
                  <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)", fontSize: 13, color: tx.type === "in" ? "var(--accent3)" : "var(--accent2)", fontWeight: 500 }}>
                    {tx.type === "in" ? "+" : "-"}{fmtD(tx.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════
// MEMBERS
// ═══════════════════════════════════════
function Members({ members, setMembers, transactions, setTransactions, notify, onMemberLogin, settings }) {
  const fmt = makeFmt(settings); const fmtD = makeFmtD(settings);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", offerId: "monthly", startDate: today, photo: null });
  const [xlsxPreview, setXlsxPreview] = useState(null); // [{name,email,phone,offerId,startDate}]
  const [xlsxLoading, setXlsxLoading] = useState(false);
  const photoInputRef = useState(null);
  const xlsxInputRef = useState(null);

  const filtered = members.filter(m => m.name.toLowerCase().includes(search.toLowerCase()) || m.email.toLowerCase().includes(search.toLowerCase()));

  // ── Photo upload handler ──
  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setForm(p => ({ ...p, photo: ev.target.result }));
    reader.readAsDataURL(file);
  };

  const addMember = () => {
    if (!form.name || !form.email) return notify("Name and email required", "error");
    const offer = getOffer(form.offerId);
    const newMember = {
      ...form,
      id: Date.now(),
      avatar: form.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2),
      checkins: []
    };
    setMembers(p => [...p, newMember]);
    setTransactions(p => [...p, { id: Date.now(), date: today, type: "in", category: "membership", desc: `${offer.label} - ${form.name}`, amount: offer.price }]);
    setForm({ name: "", email: "", phone: "", offerId: "monthly", startDate: today, photo: null });
    setShowAdd(false);
    notify(`${form.name} registered & charged ${fmt(offer.price)}`);
  };

  const removeMember = (id) => {
    setMembers(p => p.filter(m => m.id !== id));
    notify("Member removed");
  };

  const [renewModal, setRenewModal] = useState(null); // member obj being renewed
  const [renewOfferId, setRenewOfferId] = useState("monthly");

  const openRenew = (member) => {
    setRenewOfferId(member.offerId);
    setRenewModal(member);
  };

  const confirmRenew = () => {
    if (!renewModal) return;
    const offer = getOffer(renewOfferId);
    const currentDL = daysLeft(renewModal.startDate, getOffer(renewModal.offerId).days);
    // Extend mode: if still active, add days from expiry; else reset from today
    let newStart;
    if (settings.renewMode === "extend" && currentDL > 0) {
      const expiry = new Date(renewModal.startDate);
      expiry.setDate(expiry.getDate() + getOffer(renewModal.offerId).days);
      newStart = expiry.toISOString().split("T")[0];
    } else {
      newStart = today;
    }
    setMembers(p => p.map(m => m.id === renewModal.id
      ? { ...m, offerId: renewOfferId, startDate: newStart }
      : m
    ));
    setTransactions(p => [...p, {
      id: Date.now(), date: today, type: "in", category: "membership",
      desc: `Renewal ${offer.label} - ${renewModal.name}`,
      amount: offer.price
    }]);
    notify(`${renewModal.name} renewed — ${offer.label} · ${fmt(offer.price)}`);
    setRenewModal(null);
  };

  // ── XLSX import ──
  const handleXlsxUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setXlsxLoading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        // Parse XLSX using SheetJS loaded via CDN script
        const XLSX = window.XLSX;
        if (!XLSX) { notify("XLSX library not ready, try again", "error"); setXlsxLoading(false); return; }
        const wb = XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        // Map columns (flexible: name/Name/full_name, email/Email, phone/Phone, offer/Offer/offerId, startDate/start_date)
        const parsed = rows.map(r => {
          const name = r.name || r.Name || r.full_name || r["Full Name"] || "";
          const email = r.email || r.Email || "";
          const phone = String(r.phone || r.Phone || "");
          const rawOffer = String(r.offer || r.Offer || r.offerId || r["Offer"] || "monthly").toLowerCase().trim();
          const offerId = OFFERS.find(o => o.id === rawOffer || o.label.toLowerCase() === rawOffer)?.id || "monthly";
          const startDate = r.startDate || r.start_date || r["Start Date"] || today;
          return { name, email, phone, offerId, startDate };
        }).filter(r => r.name && r.email);
        setXlsxPreview(parsed);
        setXlsxLoading(false);
        if (!parsed.length) notify("No valid rows found. Ensure Name & Email columns exist.", "error");
      } catch (err) {
        notify("Failed to parse XLSX file", "error");
        setXlsxLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const confirmXlsxImport = () => {
    if (!xlsxPreview?.length) return;
    const newMembers = xlsxPreview.map((r, i) => ({
      ...r,
      id: Date.now() + i,
      avatar: r.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2),
      photo: null,
      checkins: []
    }));
    const newTxs = newMembers.map((m, i) => {
      const offer = getOffer(m.offerId);
      return { id: Date.now() + 10000 + i, date: today, type: "in", category: "membership", desc: `${offer.label} - ${m.name}`, amount: offer.price };
    });
    setMembers(p => [...p, ...newMembers]);
    setTransactions(p => [...p, ...newTxs]);
    notify(`${newMembers.length} members imported successfully`);
    setXlsxPreview(null);
  };

  // Inject SheetJS if not present
  useEffect(() => {
    if (!window.XLSX) {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      document.head.appendChild(s);
    }
  }, []);

  const offer = getOffer(form.offerId);

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28 }} className="fade-up">
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 42, letterSpacing: "0.05em", lineHeight: 1 }}>MEMBERS</div>
          <div style={{ color: "var(--text2)", fontSize: 14, marginTop: 6 }}>{members.length} registered athletes</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {/* XLSX Import button */}
          <label style={{
            display: "flex", alignItems: "center", gap: 7, padding: "10px 18px",
            background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8,
            cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--accent3)",
            transition: "border-color 0.2s", whiteSpace: "nowrap"
          }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent3)"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
          >
            <span style={{ fontSize: 16 }}>⬇</span> Import XLSX
            <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={handleXlsxUpload} />
          </label>
          <Btn onClick={() => setShowAdd(p => !p)}>{showAdd ? "Cancel" : "+ Register Member"}</Btn>
        </div>
      </div>

      {/* XLSX preview / confirm */}
      {xlsxPreview && (
        <Card style={{ marginBottom: 24, borderColor: "var(--accent3)44" }} className="fade-up">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--accent3)" }}>XLSX Preview — {xlsxPreview.length} members found</div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>Review before importing. Each will be charged their plan fee.</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="ghost" size="sm" onClick={() => setXlsxPreview(null)}>Discard</Btn>
              <Btn variant="success" size="sm" onClick={confirmXlsxImport}>Confirm Import ({xlsxPreview.length})</Btn>
            </div>
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Name", "Email", "Phone", "Offer", "Start Date"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 12px", fontSize: 10, color: "var(--text3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {xlsxPreview.map((r, i) => {
                  const o = getOffer(r.offerId);
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)44" }}>
                      <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 500 }}>{r.name}</td>
                      <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--text2)" }}>{r.email}</td>
                      <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--text2)" }}>{r.phone || "—"}</td>
                      <td style={{ padding: "8px 12px" }}><Badge color={o.color}>{o.label}</Badge></td>
                      <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text2)" }}>{r.startDate}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--bg3)", borderRadius: 8, fontSize: 11, color: "var(--text3)" }}>
            <strong style={{ color: "var(--text2)" }}>Expected columns:</strong> Name, Email, Phone (optional), Offer (monthly/vip/student/quarterly/annual/day), Start Date (optional)
          </div>
        </Card>
      )}

      {/* Add form */}
      {showAdd && (
        <Card style={{ marginBottom: 24, borderColor: "var(--accent)44", animationDelay: "0ms" }} className="fade-up">
          <div style={{ fontWeight: 700, marginBottom: 20, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--accent)" }}>New Member Registration</div>
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
            {/* Photo uploader */}
            <div style={{ flexShrink: 0 }}>
              <label style={lbl}>Photo</label>
              <label style={{ display: "block", cursor: "pointer" }}>
                <div style={{
                  width: 90, height: 90, borderRadius: "50%",
                  border: `2px dashed ${form.photo ? offer.color : "var(--border)"}`,
                  background: form.photo ? "transparent" : "var(--bg3)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  overflow: "hidden", position: "relative", transition: "border-color 0.2s"
                }}>
                  {form.photo
                    ? <img src={form.photo} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <div style={{ textAlign: "center", color: "var(--text3)" }}>
                        <div style={{ fontSize: 22, marginBottom: 2 }}>+</div>
                        <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>Photo</div>
                      </div>
                  }
                </div>
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoChange} />
              </label>
              {form.photo && (
                <button onClick={() => setForm(p => ({ ...p, photo: null }))}
                  style={{ background: "transparent", border: "none", color: "var(--text3)", fontSize: 11, cursor: "pointer", marginTop: 6, width: 90, textAlign: "center" }}>
                  Remove
                </button>
              )}
            </div>

            {/* Fields */}
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14, minWidth: 0 }}>
              <div><label style={lbl}>Full Name</label><input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Alex Johnson" /></div>
              <div><label style={lbl}>Email</label><input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@gym.com" /></div>
              <div><label style={lbl}>Phone</label><input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="555-0000" /></div>
              <div>
                <label style={lbl}>Offer</label>
                <select value={form.offerId} onChange={e => setForm(p => ({ ...p, offerId: e.target.value }))}>
                  {OFFERS.map(o => <option key={o.id} value={o.id}>{o.label} — ${o.price}/period</option>)}
                </select>
              </div>
              <div><label style={lbl}>Start Date</label><input type="date" value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} /></div>
            </div>
          </div>
          <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "center" }}>
            <Btn onClick={addMember}>Register & Charge {fmt(getOffer(form.offerId).price)}</Btn>
            <div style={{ fontSize: 12, color: "var(--text2)" }}>Subscription: {getOffer(form.offerId).days} days</div>
          </div>
        </Card>
      )}

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search members…" style={{ maxWidth: 320 }} />
      </div>

      {/* Table */}
      <Card className="fade-up" style={{ animationDelay: "120ms" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Member", "Offer", "Start", "Expires", "Days Left", "Status", "Actions"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 14px", fontSize: 11, color: "var(--text3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => {
                const offer = getOffer(m.offerId);
                const dl = daysLeft(m.startDate, offer.days);
                const end = new Date(m.startDate);
                end.setDate(end.getDate() + offer.days);
                const active = dl > 0;
                return (
                  <tr key={m.id} style={{ borderBottom: "1px solid var(--border)55" }}>
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {/* Avatar: photo or initials */}
                        <div style={{
                          width: 36, height: 36, borderRadius: "50%",
                          background: offer.color + "33", border: `1px solid ${offer.color}55`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontWeight: 700, fontSize: 11, color: offer.color, flexShrink: 0,
                          overflow: "hidden"
                        }}>
                          {m.photo
                            ? <img src={m.photo} alt={m.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            : m.avatar
                          }
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{m.name}</div>
                          <div style={{ color: "var(--text3)", fontSize: 11 }}>{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "12px 14px" }}><Badge color={offer.color}>{offer.label}</Badge></td>
                    <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--text2)", fontFamily: "var(--font-mono)" }}>{m.startDate}</td>
                    <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--text2)", fontFamily: "var(--font-mono)" }}>{end.toISOString().split("T")[0]}</td>
                    <td style={{ padding: "12px 14px", fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 500, color: dl <= 7 ? "var(--accent2)" : dl <= 14 ? "var(--accent)" : "var(--accent3)" }}>{dl}d</td>
                    <td style={{ padding: "12px 14px" }}><Badge color={active ? "var(--accent3)" : "var(--accent2)"}>{active ? "Active" : "Expired"}</Badge></td>
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <Btn size="sm" variant="success" onClick={() => openRenew(m)}>↻ Renew</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => onMemberLogin(m.id)}>Portal</Btn>
                        <Btn size="sm" variant="danger" onClick={() => removeMember(m.id)}>✕</Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Renew Modal */}
      {renewModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9000,
          background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center"
        }} onClick={() => setRenewModal(null)}>
          <div onClick={e => e.stopPropagation()} className="fade-up" style={{
            background: "var(--card)", border: "1px solid var(--border)", borderRadius: 20,
            padding: 32, width: 420, maxWidth: "90vw", boxShadow: "0 24px 80px rgba(0,0,0,0.6)"
          }}>
            {/* Member header */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
              <div style={{
                width: 52, height: 52, borderRadius: "50%", flexShrink: 0,
                background: getOffer(renewModal.offerId).color + "22",
                border: `2px solid ${getOffer(renewModal.offerId).color}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 16, color: getOffer(renewModal.offerId).color,
                overflow: "hidden"
              }}>
                {renewModal.photo
                  ? <img src={renewModal.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : renewModal.avatar}
              </div>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 24, letterSpacing: "0.05em" }}>{renewModal.name.toUpperCase()}</div>
                <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>
                  Current plan: <span style={{ color: getOffer(renewModal.offerId).color, fontWeight: 600 }}>{getOffer(renewModal.offerId).label}</span>
                  {" · "}{daysLeft(renewModal.startDate, getOffer(renewModal.offerId).days)}d remaining
                </div>
              </div>
            </div>

            <div style={{ height: 1, background: "var(--border)", marginBottom: 24 }} />

            {/* Plan selector */}
            <label style={lbl}>Select New Plan</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
              {OFFERS.map(o => (
                <button key={o.id} onClick={() => setRenewOfferId(o.id)} style={{
                  padding: "10px 8px", borderRadius: 10, border: `2px solid ${renewOfferId === o.id ? o.color : "var(--border)"}`,
                  background: renewOfferId === o.id ? o.color + "18" : "var(--bg3)",
                  cursor: "pointer", transition: "all 0.15s"
                }}>
                  <div style={{ fontWeight: 700, fontSize: 11, color: o.color, textTransform: "uppercase", letterSpacing: "0.05em" }}>{o.label}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, color: "var(--text)", marginTop: 3 }}>{fmtD(o.price)}</div>
                  <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 1 }}>{o.days}d</div>
                </button>
              ))}
            </div>

            {/* Renewal info */}
            <div style={{ background: "var(--bg3)", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 12, color: "var(--text2)", lineHeight: 1.7 }}>
              {(() => {
                const offer = getOffer(renewOfferId);
                const currentDL = daysLeft(renewModal.startDate, getOffer(renewModal.offerId).days);
                let newStart, newEnd;
                if (settings.renewMode === "extend" && currentDL > 0) {
                  const expiry = new Date(renewModal.startDate);
                  expiry.setDate(expiry.getDate() + getOffer(renewModal.offerId).days);
                  newStart = expiry.toISOString().split("T")[0];
                } else {
                  newStart = today;
                }
                const endD = new Date(newStart);
                endD.setDate(endD.getDate() + offer.days);
                newEnd = endD.toISOString().split("T")[0];
                return <>
                  <div><span style={{ color: "var(--text3)" }}>Mode:</span> <span style={{ color: "var(--text)" }}>{settings.renewMode === "extend" && currentDL > 0 ? "Extend from expiry" : "Reset from today"}</span></div>
                  <div><span style={{ color: "var(--text3)" }}>New start:</span> <span style={{ color: "var(--text)", fontFamily: "var(--font-mono)" }}>{fmtDate(newStart, settings.dateFormat)}</span></div>
                  <div><span style={{ color: "var(--text3)" }}>New expiry:</span> <span style={{ color: "var(--accent3)", fontFamily: "var(--font-mono)" }}>{fmtDate(newEnd, settings.dateFormat)}</span></div>
                  <div><span style={{ color: "var(--text3)" }}>Charge:</span> <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{fmtD(offer.price)}</span></div>
                </>;
              })()}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <Btn variant="ghost" onClick={() => setRenewModal(null)} style={{ flex: 1 }}>Cancel</Btn>
              <Btn variant="primary" onClick={confirmRenew} style={{ flex: 2 }}>
                Confirm Renewal · {fmtD(getOffer(renewOfferId).price)}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// FINANCES
// ═══════════════════════════════════════
function Finances({ transactions, setTransactions, notify, totalIn, totalOut, net, settings }) {
  const fmt = makeFmt(settings); const fmtD = makeFmtD(settings);
  const [form, setForm] = useState({ date: today, type: "out", category: "rent", desc: "", amount: "" });
  const [filter, setFilter] = useState("all");

  const cats = { in: ["membership", "fridge", "events", "other"], out: ["rent", "electricity", "salary", "supplies", "equipment", "marketing", "other"] };

  const addTx = () => {
    if (!form.desc || !form.amount) return notify("Fill all fields", "error");
    setTransactions(p => [...p, { ...form, id: Date.now(), amount: parseFloat(form.amount) }]);
    setForm(p => ({ ...p, desc: "", amount: "" }));
    notify("Transaction recorded");
  };

  const filtered = transactions.filter(t => filter === "all" ? true : t.type === filter);
  const grouped = {};
  filtered.forEach(t => { if (!grouped[t.date]) grouped[t.date] = []; grouped[t.date].push(t); });

  const catTotals = {};
  transactions.filter(t => t.type === "out").forEach(t => { catTotals[t.category] = (catTotals[t.category] || 0) + t.amount; });

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 28 }} className="fade-up">
        <div style={{ fontFamily: "var(--font-display)", fontSize: 42, letterSpacing: "0.05em", lineHeight: 1 }}>FINANCES</div>
        <div style={{ color: "var(--text2)", fontSize: 14, marginTop: 6 }}>Every cent tracked</div>
      </div>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 24 }}>
        <StatCard label="Total Revenue" value={fmt(totalIn)} accent="var(--accent3)" delay={0} />
        <StatCard label="Total Expenses" value={fmt(totalOut)} accent="var(--accent2)" delay={60} />
        <StatCard label="Net Profit" value={fmt(net)} accent={net >= 0 ? "var(--accent)" : "var(--accent2)"} delay={120} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Add Transaction */}
        <Card className="fade-up" style={{ animationDelay: "180ms" }}>
          <div style={{ fontWeight: 700, marginBottom: 18, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text2)" }}>Log Transaction</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div><label style={lbl}>Date</label><input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} /></div>
            <div>
              <label style={lbl}>Type</label>
              <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value, category: cats[e.target.value][0] }))}>
                <option value="in">Income</option><option value="out">Expense</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Category</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                {cats[form.type].map(c => <option key={c} value={c} style={{ textTransform: "capitalize" }}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Amount ($)</label><input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" /></div>
          </div>
          <div style={{ marginBottom: 14 }}><label style={lbl}>Description</label><input value={form.desc} onChange={e => setForm(p => ({ ...p, desc: e.target.value }))} placeholder="Brief description…" /></div>
          <Btn onClick={addTx} variant={form.type === "in" ? "success" : "danger"}>
            + Log {form.type === "in" ? "Income" : "Expense"}
          </Btn>
        </Card>

        {/* Expense breakdown */}
        <Card className="fade-up" style={{ animationDelay: "240ms" }}>
          <div style={{ fontWeight: 700, marginBottom: 18, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text2)" }}>Expense Breakdown</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {Object.entries(catTotals).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
              <div key={cat}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: "var(--text2)", textTransform: "capitalize" }}>{cat}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)" }}>{fmt(amt)}</span>
                </div>
                <div style={{ height: 4, background: "var(--bg3)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(amt / totalOut) * 100}%`, background: "var(--accent2)", borderRadius: 99 }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Transaction ledger */}
      <Card className="fade-up" style={{ animationDelay: "300ms" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text2)" }}>Ledger</div>
          <div style={{ display: "flex", gap: 8 }}>
            {["all", "in", "out"].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                border: "1px solid var(--border)", textTransform: "uppercase", letterSpacing: "0.06em",
                background: filter === f ? "var(--accent)" : "transparent",
                color: filter === f ? "#000" : "var(--text2)"
              }}>{f}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto", maxHeight: 460, overflowY: "auto" }}>
          {Object.entries(grouped).sort((a, b) => b[0] > a[0] ? 1 : -1).map(([date, txs]) => (
            <div key={date} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "var(--text3)", padding: "6px 12px", background: "var(--bg3)", borderRadius: 6, marginBottom: 6, fontFamily: "var(--font-mono)" }}>{date}</div>
              {txs.map(tx => (
                <div key={tx.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 12, alignItems: "center", padding: "9px 12px", borderBottom: "1px solid var(--border)44" }}>
                  <Badge color={tx.type === "in" ? "var(--accent3)" : "var(--accent2)"}>{tx.type === "in" ? "IN" : "OUT"}</Badge>
                  <div>
                    <div style={{ fontSize: 13 }}>{tx.desc}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "capitalize" }}>{tx.category}</div>
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, color: tx.type === "in" ? "var(--accent3)" : "var(--accent2)" }}>
                    {tx.type === "in" ? "+" : "-"}{fmtD(tx.amount)}
                  </div>
                  <button onClick={() => setTransactions(p => p.filter(t => t.id !== tx.id))} style={{ background: "transparent", color: "var(--text3)", fontSize: 16, border: "none", cursor: "pointer" }}>✕</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════
// FRIDGE & POS
// ═══════════════════════════════════════
function FridgePOS({ inventory, setInventory, transactions, setTransactions, notify, settings }) {
  const fmt = makeFmt(settings); const fmtD = makeFmtD(settings);
  const [cart, setCart] = useState([]);
  const [activeTab, setActiveTab] = useState("pos");
  const [stockForm, setStockForm] = useState({ id: null, qty: "" });
  const [newItem, setNewItem] = useState({ name: "", category: "drinks", price: "", cost: "", qty: "" });
  const [editingId, setEditingId] = useState(null); // id of item being inline-edited
  const [editDraft, setEditDraft] = useState({});   // draft values while editing

  const cats = [...new Set(inventory.map(i => i.category))];
  const cartTotal = cart.reduce((s, c) => s + c.price * c.qty, 0);

  const addToCart = (item) => {
    setCart(p => {
      const ex = p.find(c => c.id === item.id);
      if (ex) return p.map(c => c.id === item.id ? { ...c, qty: c.qty + 1 } : c);
      return [...p, { ...item, qty: 1 }];
    });
  };

  const checkout = () => {
    if (!cart.length) return;
    setInventory(p => p.map(item => {
      const cartItem = cart.find(c => c.id === item.id);
      return cartItem ? { ...item, qty: Math.max(0, item.qty - cartItem.qty) } : item;
    }));
    setTransactions(p => [...p, {
      id: Date.now(), date: today, type: "in", category: "fridge",
      desc: `POS Sale: ${cart.map(c => `${c.qty}x ${c.name}`).join(", ")}`,
      amount: cartTotal
    }]);
    notify(`Sale recorded: ${fmtD(cartTotal)}`);
    setCart([]);
  };

  const restockItem = (id) => {
    const qty = parseInt(stockForm.qty);
    if (!qty || qty <= 0) return notify("Enter valid quantity", "error");
    setInventory(p => p.map(i => i.id === id ? { ...i, qty: i.qty + qty } : i));
    setStockForm({ id: null, qty: "" });
    notify("Stock updated");
  };

  const addNewItem = () => {
    if (!newItem.name || !newItem.price || !newItem.qty) return notify("Fill required fields", "error");
    setInventory(p => [...p, { ...newItem, id: Date.now(), price: parseFloat(newItem.price), cost: parseFloat(newItem.cost) || 0, qty: parseInt(newItem.qty) }]);
    setNewItem({ name: "", category: "drinks", price: "", cost: "", qty: "" });
    notify("Item added to fridge");
  };

  const deleteItem = (id) => {
    setInventory(p => p.filter(i => i.id !== id));
    setCart(p => p.filter(c => c.id !== id));
    notify("Item removed");
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditDraft({ name: item.name, category: item.category, price: item.price, cost: item.cost, qty: item.qty });
  };

  const saveEdit = (id) => {
    if (!editDraft.name || editDraft.price === "" || editDraft.qty === "") return notify("Name, price and qty required", "error");
    setInventory(p => p.map(i => i.id === id ? {
      ...i,
      name: editDraft.name,
      category: editDraft.category,
      price: parseFloat(editDraft.price),
      cost: parseFloat(editDraft.cost) || 0,
      qty: parseInt(editDraft.qty)
    } : i));
    setEditingId(null);
    notify("Product updated");
  };

  const cancelEdit = () => setEditingId(null);

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ marginBottom: 28 }} className="fade-up">
        <div style={{ fontFamily: "var(--font-display)", fontSize: 42, letterSpacing: "0.05em", lineHeight: 1 }}>FRIDGE & POS</div>
        <div style={{ color: "var(--text2)", fontSize: 14, marginTop: 6 }}>{inventory.length} products · Point of Sale terminal</div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--bg2)", padding: 4, borderRadius: 10, width: "fit-content" }}>
        {[["pos", "⬢ Point of Sale"], ["inventory", "◫ Inventory"], ["restock", "↑ Restock"]].map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)} style={{
            padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: activeTab === id ? "var(--accent)" : "transparent",
            color: activeTab === id ? "#000" : "var(--text2)", border: "none",
            transition: "all 0.2s"
          }}>{label}</button>
        ))}
      </div>

      {activeTab === "pos" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr", gap: 20 }} className="fade-up">
          {/* Products grid */}
          <div>
            {cats.map(cat => (
              <div key={cat} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>{cat}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
                  {inventory.filter(i => i.category === cat).map(item => (
                    <button key={item.id} onClick={() => item.qty > 0 && addToCart(item)} style={{
                      background: "var(--card)", border: `1px solid ${item.qty <= 3 ? "var(--accent2)44" : "var(--border)"}`,
                      borderRadius: 12, padding: 16, textAlign: "left", cursor: item.qty > 0 ? "pointer" : "not-allowed",
                      opacity: item.qty === 0 ? 0.5 : 1, transition: "all 0.15s"
                    }}
                      onMouseEnter={e => item.qty > 0 && (e.currentTarget.style.borderColor = "var(--accent)")}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = item.qty <= 3 ? "var(--accent2)44" : "var(--border)")}
                    >
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6, lineHeight: 1.3 }}>{item.name}</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, color: "var(--accent)", fontWeight: 500 }}>${item.price}</div>
                      <div style={{ fontSize: 10, color: item.qty <= 3 ? "var(--accent2)" : "var(--text3)", marginTop: 4 }}>{item.qty} in stock</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Cart */}
          <Card style={{ position: "sticky", top: 0, alignSelf: "flex-start" }}>
            <div style={{ fontWeight: 700, marginBottom: 16, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text2)" }}>Cart</div>
            {cart.length === 0 ? (
              <div style={{ color: "var(--text3)", fontSize: 13, textAlign: "center", padding: "32px 0" }}>Tap products to add</div>
            ) : (
              <>
                {cart.map(c => (
                  <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text3)" }}>${c.price} × {c.qty}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--accent)" }}>${(c.price * c.qty).toFixed(2)}</span>
                      <button onClick={() => setCart(p => p.map(x => x.id === c.id && x.qty > 1 ? { ...x, qty: x.qty - 1 } : x).filter(x => !(x.id === c.id && x.qty === 1)))}
                        style={{ background: "var(--bg3)", border: "none", color: "var(--text2)", width: 24, height: 24, borderRadius: 4, cursor: "pointer", fontSize: 14 }}>−</button>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, minWidth: 16, textAlign: "center" }}>{c.qty}</span>
                      <button onClick={() => addToCart(c)}
                        style={{ background: "var(--bg3)", border: "none", color: "var(--text2)", width: 24, height: 24, borderRadius: 4, cursor: "pointer", fontSize: 14 }}>+</button>
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0 12px" }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Total</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 22, color: "var(--accent)", fontWeight: 500 }}>{fmtD(cartTotal)}</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn variant="ghost" onClick={() => setCart([])} style={{ flex: 1 }}>Clear</Btn>
                  <Btn onClick={checkout} style={{ flex: 2 }}>Charge {fmtD(cartTotal)}</Btn>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {activeTab === "inventory" && (
        <div className="fade-up">
          {/* Add new product */}
          <Card style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 700, marginBottom: 16, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text2)" }}>Add New Product</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 14 }}>
              <div><label style={lbl}>Name</label><input value={newItem.name} onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))} placeholder="Product name" /></div>
              <div>
                <label style={lbl}>Category</label>
                <select value={newItem.category} onChange={e => setNewItem(p => ({ ...p, category: e.target.value }))}>
                  {["drinks", "shakes", "snacks", "supplements", "other"].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Sell Price ($)</label><input type="number" value={newItem.price} onChange={e => setNewItem(p => ({ ...p, price: e.target.value }))} placeholder="0.00" /></div>
              <div><label style={lbl}>Cost ($)</label><input type="number" value={newItem.cost} onChange={e => setNewItem(p => ({ ...p, cost: e.target.value }))} placeholder="0.00" /></div>
              <div><label style={lbl}>Initial Qty</label><input type="number" value={newItem.qty} onChange={e => setNewItem(p => ({ ...p, qty: e.target.value }))} placeholder="0" /></div>
            </div>
            <Btn onClick={addNewItem}>+ Add to Fridge</Btn>
          </Card>

          {/* Editable inventory table */}
          <Card>
            <div style={{ fontWeight: 700, marginBottom: 16, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text2)" }}>
              Products — click ✎ to edit any row inline
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Product", "Category", "Sell Price", "Cost", "Margin", "Stock", "Status", "Actions"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "10px 14px", fontSize: 11, color: "var(--text3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inventory.map(item => {
                    const isEditing = editingId === item.id;
                    const margin = ((item.price - item.cost) / item.price * 100).toFixed(0);
                    if (isEditing) {
                      return (
                        <tr key={item.id} style={{ borderBottom: "1px solid var(--border)44", background: "var(--accent)08" }}>
                          <td style={{ padding: "8px 10px" }}>
                            <input value={editDraft.name} onChange={e => setEditDraft(p => ({ ...p, name: e.target.value }))}
                              style={{ padding: "6px 10px", fontSize: 12, minWidth: 120 }} />
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            <select value={editDraft.category} onChange={e => setEditDraft(p => ({ ...p, category: e.target.value }))}
                              style={{ padding: "6px 10px", fontSize: 12 }}>
                              {["drinks", "shakes", "snacks", "supplements", "other"].map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            <input type="number" value={editDraft.price} onChange={e => setEditDraft(p => ({ ...p, price: e.target.value }))}
                              style={{ padding: "6px 10px", fontSize: 12, width: 80 }} />
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            <input type="number" value={editDraft.cost} onChange={e => setEditDraft(p => ({ ...p, cost: e.target.value }))}
                              style={{ padding: "6px 10px", fontSize: 12, width: 80 }} />
                          </td>
                          <td style={{ padding: "8px 10px", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)" }}>
                            {editDraft.price && editDraft.cost ? (((editDraft.price - editDraft.cost) / editDraft.price) * 100).toFixed(0) : "—"}%
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            <input type="number" value={editDraft.qty} onChange={e => setEditDraft(p => ({ ...p, qty: e.target.value }))}
                              style={{ padding: "6px 10px", fontSize: 12, width: 70 }} />
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            <Badge color="var(--accent)">Editing</Badge>
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            <div style={{ display: "flex", gap: 6 }}>
                              <Btn size="sm" variant="success" onClick={() => saveEdit(item.id)}>Save</Btn>
                              <Btn size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Btn>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={item.id} style={{ borderBottom: "1px solid var(--border)44", transition: "background 0.15s" }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--bg3)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        <td style={{ padding: "12px 14px", fontWeight: 500, fontSize: 13 }}>{item.name}</td>
                        <td style={{ padding: "12px 14px" }}><Badge color="var(--accent3)">{item.category}</Badge></td>
                        <td style={{ padding: "12px 14px", fontFamily: "var(--font-mono)", color: "var(--accent3)" }}>${item.price}</td>
                        <td style={{ padding: "12px 14px", fontFamily: "var(--font-mono)", color: "var(--text2)" }}>${item.cost}</td>
                        <td style={{ padding: "12px 14px", fontFamily: "var(--font-mono)", color: "var(--accent)" }}>{margin}%</td>
                        <td style={{ padding: "12px 14px", fontFamily: "var(--font-mono)", fontWeight: 600, color: item.qty <= 5 ? "var(--accent2)" : item.qty <= 10 ? "var(--accent)" : "var(--text)" }}>{item.qty}</td>
                        <td style={{ padding: "12px 14px" }}><Badge color={item.qty === 0 ? "var(--accent2)" : item.qty <= 5 ? "var(--accent)" : "var(--accent3)"}>{item.qty === 0 ? "OUT" : item.qty <= 5 ? "LOW" : "OK"}</Badge></td>
                        <td style={{ padding: "12px 14px" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <Btn size="sm" variant="ghost" onClick={() => startEdit(item)}>✎ Edit</Btn>
                            <Btn size="sm" variant="danger" onClick={() => deleteItem(item.id)}>✕</Btn>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {activeTab === "restock" && (
        <div className="fade-up" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {inventory.map(item => (
            <Card key={item.id} style={{ borderColor: item.qty <= 5 ? "var(--accent2)33" : "var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{item.category}</div>
                </div>
                <Badge color={item.qty <= 5 ? "var(--accent2)" : "var(--accent3)"}>{item.qty} in stock</Badge>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="number" placeholder="Add qty" value={stockForm.id === item.id ? stockForm.qty : ""}
                  onChange={e => setStockForm({ id: item.id, qty: e.target.value })}
                  style={{ flex: 1 }} />
                <Btn size="sm" variant="success" onClick={() => restockItem(item.id)}>+ Add</Btn>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// CHECK-IN
// ═══════════════════════════════════════
function CheckIn({ members, checkins, setCheckins, recentCheckins, notify, settings }) {
  const [search, setSearch] = useState("");
  const filtered = members.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
  const checkedInNow = new Set(recentCheckins.map(c => c.memberId));

  const doCheckin = (member) => {
    const offer = getOffer(member.offerId);
    const dl = daysLeft(member.startDate, offer.days);
    if (dl === 0) return notify(`${member.name}'s membership has expired!`, "error");
    setCheckins(p => [...p, { memberId: member.id, time: new Date().toISOString() }]);
    notify(`${member.name} checked in ✓`);
  };

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: 28 }} className="fade-up">
        <div style={{ fontFamily: "var(--font-display)", fontSize: 42, letterSpacing: "0.05em", lineHeight: 1 }}>CHECK-IN</div>
        <div style={{ color: "var(--text2)", fontSize: 14, marginTop: 6 }}>{checkedInNow.size} members currently in gym</div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search member to check in…" style={{ maxWidth: 380 }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
        {filtered.map(m => {
          const offer = getOffer(m.offerId);
          const dl = daysLeft(m.startDate, offer.days);
          const isIn = checkedInNow.has(m.id);
          return (
            <Card key={m.id} className="fade-up" style={{ borderColor: isIn ? "var(--accent3)44" : "var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: "50%",
                  background: offer.color + "22", border: `2px solid ${isIn ? "var(--accent3)" : offer.color + "55"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: 14, color: offer.color, flexShrink: 0,
                  overflow: "hidden"
                }}>
                  {m.photo ? <img src={m.photo} alt={m.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : m.avatar}
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>{m.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text3)" }}>{m.email}</div>
                </div>
                {isIn && <div style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", background: "var(--accent3)", boxShadow: "0 0 8px var(--accent3)", animation: "pulse 2s infinite" }} />}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <Badge color={offer.color}>{offer.label}</Badge>
                <span style={{ fontSize: 11, color: dl <= 7 ? "var(--accent2)" : "var(--text3)", fontFamily: "var(--font-mono)" }}>{dl}d remaining</span>
              </div>
              <Btn
                onClick={() => doCheckin(m)}
                variant={isIn ? "ghost" : dl === 0 ? "danger" : "success"}
                style={{ width: "100%" }}
                disabled={isIn}
              >
                {isIn ? "✓ Checked In" : dl === 0 ? "✕ Expired" : "Check In"}
              </Btn>
            </Card>
          );
        })}
      </div>

      {checkins.length > 0 && (
        <Card style={{ marginTop: 24 }} className="fade-up">
          <div style={{ fontWeight: 700, marginBottom: 14, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text2)" }}>Recent Check-Ins</div>
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            {[...checkins].reverse().slice(0, 20).map((c, i) => {
              const m = members.find(x => x.id === c.memberId);
              const t = new Date(c.time);
              return (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)44", alignItems: "center" }}>
                  <span style={{ fontSize: 13 }}>{m?.name || "Unknown"}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text3)" }}>{t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// MEMBER PORTAL
// ═══════════════════════════════════════
function MemberPortal({ memberId, members, busynessPct, uniqueRecent, onSelectMember, settings }) {
  const fmt = makeFmt(settings); const fmtD = makeFmtD(settings);
  const member = members.find(m => m.id === memberId);
  const offer = member ? getOffer(member.offerId) : null;
  const dl = member && offer ? daysLeft(member.startDate, offer.days) : 0;
  const pct = offer ? Math.round((dl / offer.days) * 100) : 0;

  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      <div style={{ marginBottom: 28 }} className="fade-up">
        <div style={{ fontFamily: "var(--font-display)", fontSize: 42, letterSpacing: "0.05em", lineHeight: 1 }}>MEMBER PORTAL</div>
        <div style={{ color: "var(--text2)", fontSize: 14, marginTop: 6 }}>Your personal dashboard</div>
      </div>

      {/* Member selector */}
      {!member && (
        <Card className="fade-up">
          <div style={{ fontWeight: 700, marginBottom: 16, fontSize: 13, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Select Your Profile</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {members.map(m => {
              const o = getOffer(m.offerId);
              return (
                <button key={m.id} onClick={() => onSelectMember(m.id)} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                  background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 10,
                  cursor: "pointer", textAlign: "left", transition: "border-color 0.2s"
                }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent)"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
                >
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: o.color + "22", border: `1px solid ${o.color}55`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, color: o.color, overflow: "hidden", flexShrink: 0 }}>
                    {m.photo ? <img src={m.photo} alt={m.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : m.avatar}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>{m.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>{o.label} member</div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {member && offer && (
        <>
          {/* Profile card */}
          <Card className="fade-up" style={{ marginBottom: 16, borderColor: offer.color + "44", background: `linear-gradient(135deg, var(--card) 0%, ${offer.color}08 100%)` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
              <div style={{
                width: 60, height: 60, borderRadius: "50%",
                background: offer.color + "22", border: `2px solid ${offer.color}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 20, color: offer.color,
                overflow: "hidden", flexShrink: 0
              }}>
                {member.photo
                  ? <img src={member.photo} alt={member.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : member.avatar}
              </div>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 28, letterSpacing: "0.05em", lineHeight: 1 }}>{member.name.toUpperCase()}</div>
                <Badge color={offer.color}>{offer.label} Member</Badge>
              </div>
              <button onClick={() => onSelectMember(null)} style={{ marginLeft: "auto", background: "transparent", color: "var(--text3)", border: "1px solid var(--border)", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Switch</button>
            </div>

            {/* Subscription ring */}
            <div style={{ display: "flex", gap: 24, alignItems: "center", marginBottom: 24 }}>
              <div style={{ position: "relative", width: 100, height: 100, flexShrink: 0 }}>
                <svg width="100" height="100" style={{ transform: "rotate(-90deg)" }}>
                  <circle cx="50" cy="50" r="42" fill="none" stroke="var(--bg3)" strokeWidth="8" />
                  <circle cx="50" cy="50" r="42" fill="none" stroke={dl <= 7 ? "var(--accent2)" : offer.color} strokeWidth="8"
                    strokeDasharray={`${2 * Math.PI * 42}`}
                    strokeDashoffset={`${2 * Math.PI * 42 * (1 - pct / 100)}`}
                    strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s ease" }}
                  />
                </svg>
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 26, letterSpacing: "0.02em", color: dl <= 7 ? "var(--accent2)" : offer.color, lineHeight: 1 }}>{dl}</div>
                  <div style={{ fontSize: 9, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>days</div>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                  {dl === 0 ? "Membership Expired" : dl <= 7 ? "Expiring Soon!" : "Membership Active"}
                </div>
                <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 4 }}>
                  {dl > 0 ? `${dl} days remaining of ${offer.days}` : "Please renew to continue"}
                </div>
                <div style={{ height: 6, background: "var(--bg3)", borderRadius: 99, width: 160, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: dl <= 7 ? "var(--accent2)" : offer.color, borderRadius: 99, transition: "width 1s ease" }} />
                </div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{pct}% of subscription remaining</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[["Start Date", member.startDate], ["Plan", offer.label], ["Cost", `$${offer.price}/period`], ["Phone", member.phone || "—"]].map(([k, v]) => (
                <div key={k} style={{ background: "var(--bg3)", borderRadius: 8, padding: "10px 14px" }}>
                  <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>{k}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{v}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Gym traffic */}
          <Card className="fade-up" style={{ animationDelay: "120ms" }}>
            <div style={{ fontWeight: 700, marginBottom: 20, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text2)" }}>Live Gym Traffic</div>
            <TrafficMeter pct={busynessPct} label={`${uniqueRecent} people in gym right now`} />
            <div style={{ marginTop: 16, padding: "12px 16px", background: "var(--bg3)", borderRadius: 8, fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
              <strong style={{ color: "var(--text)" }}>Best time to visit:</strong>{" "}
              {busynessPct < 30 ? "Now's a great time — gym is quiet!" : busynessPct < 60 ? "Moderate traffic. Good conditions." : "Peak hours. Consider coming back in 1-2 hours."}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════
function Settings({ settings, setSettings, notify }) {
  const [draft, setDraft] = useState({ ...settings });

  const save = () => {
    setSettings({ ...draft });
    // Apply accent color to CSS var
    document.documentElement.style.setProperty("--accent", draft.accentColor);
    notify("Settings saved");
  };

  const reset = () => {
    setDraft({ ...DEFAULT_SETTINGS });
    document.documentElement.style.setProperty("--accent", DEFAULT_SETTINGS.accentColor);
    setSettings({ ...DEFAULT_SETTINGS });
    notify("Settings reset to defaults");
  };

  const set = (key, val) => setDraft(p => ({ ...p, [key]: val }));

  const CURRENCIES = [
    { code: "USD", symbol: "$", label: "USD — US Dollar" },
    { code: "EUR", symbol: "€", label: "EUR — Euro" },
    { code: "GBP", symbol: "£", label: "GBP — British Pound" },
    { code: "DZD", symbol: "DA", label: "DZD — Algerian Dinar" },
    { code: "MAD", symbol: "MAD", label: "MAD — Moroccan Dirham" },
    { code: "SAR", symbol: "﷼", label: "SAR — Saudi Riyal" },
    { code: "AED", symbol: "AED", label: "AED — UAE Dirham" },
    { code: "TRY", symbol: "₺", label: "TRY — Turkish Lira" },
    { code: "JPY", symbol: "¥", label: "JPY — Japanese Yen" },
    { code: "CAD", symbol: "CA$", label: "CAD — Canadian Dollar" },
    { code: "AUD", symbol: "A$", label: "AUD — Australian Dollar" },
    { code: "CHF", symbol: "Fr", label: "CHF — Swiss Franc" },
    { code: "INR", symbol: "₹", label: "INR — Indian Rupee" },
    { code: "BRL", symbol: "R$", label: "BRL — Brazilian Real" },
  ];

  const previewFmt = makeFmt(draft);
  const previewFmtD = makeFmtD(draft);

  const ACCENT_PRESETS = [
    "#e8ff47", "#00d4aa", "#f43f5e", "#a78bfa",
    "#fb923c", "#38bdf8", "#facc15", "#34d399",
  ];

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ marginBottom: 28 }} className="fade-up">
        <div style={{ fontFamily: "var(--font-display)", fontSize: 42, letterSpacing: "0.05em", lineHeight: 1 }}>SETTINGS</div>
        <div style={{ color: "var(--text2)", fontSize: 14, marginTop: 6 }}>Gym configuration & preferences</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* ── Gym Identity ── */}
        <Card className="fade-up">
          <SectionTitle icon="◈" label="Gym Identity" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label style={lbl}>Gym Name</label>
              <input value={draft.gymName} onChange={e => set("gymName", e.target.value)} placeholder="My Gym" />
            </div>
            <div>
              <label style={lbl}>Member Capacity</label>
              <input type="number" value={draft.capacity} onChange={e => set("capacity", parseInt(e.target.value) || 40)} placeholder="40" />
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 5 }}>Used to calculate gym traffic percentage</div>
            </div>
          </div>
        </Card>

        {/* ── Currency & Formatting ── */}
        <Card className="fade-up" style={{ animationDelay: "60ms" }}>
          <SectionTitle icon="◉" label="Currency & Formatting" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div>
              <label style={lbl}>Currency</label>
              <select value={draft.currency} onChange={e => {
                const c = CURRENCIES.find(x => x.code === e.target.value);
                set("currency", e.target.value);
                if (c) set("currencySymbol", c.symbol);
              }}>
                {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Custom Symbol Override</label>
              <input value={draft.currencySymbol} onChange={e => set("currencySymbol", e.target.value)} placeholder="$" maxLength={6} />
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 5 }}>Leave as-is or override the symbol</div>
            </div>
            <div>
              <label style={lbl}>Symbol Position</label>
              <select value={draft.currencyPos} onChange={e => set("currencyPos", e.target.value)}>
                <option value="before">Before amount — {draft.currencySymbol}99</option>
                <option value="after">After amount — 99{draft.currencySymbol}</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Date Format</label>
              <select value={draft.dateFormat} onChange={e => set("dateFormat", e.target.value)}>
                <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (US)</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY (EU)</option>
              </select>
            </div>
          </div>
          {/* Live preview */}
          <div style={{ background: "var(--bg3)", borderRadius: 10, padding: "14px 18px", display: "flex", gap: 32, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Amount preview</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, color: "var(--accent)" }}>{previewFmt(1299)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Decimal preview</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, color: "var(--accent3)" }}>{previewFmtD(49.99)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Date preview</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, color: "var(--text2)" }}>{fmtDate(today, draft.dateFormat)}</div>
            </div>
          </div>
        </Card>

        {/* ── Membership & Renewals ── */}
        <Card className="fade-up" style={{ animationDelay: "120ms" }}>
          <SectionTitle icon="↻" label="Memberships & Renewals" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label style={lbl}>Renewal Mode</label>
              <select value={draft.renewMode} onChange={e => set("renewMode", e.target.value)}>
                <option value="extend">Extend — add days from current expiry</option>
                <option value="reset">Reset — always start from today</option>
              </select>
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 5 }}>
                {draft.renewMode === "extend"
                  ? "If a member still has days left, they won't lose them."
                  : "Renewal always starts counting from today regardless of expiry."}
              </div>
            </div>
            <div>
              <label style={lbl}>POS Tax Rate (%)</label>
              <input type="number" min="0" max="100" step="0.5"
                value={draft.taxRate} onChange={e => set("taxRate", parseFloat(e.target.value) || 0)} placeholder="0" />
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 5 }}>Applied to fridge / POS sales. 0 = no tax.</div>
            </div>
          </div>
        </Card>

        {/* ── Offer Prices ── */}
        <Card className="fade-up" style={{ animationDelay: "180ms" }}>
          <SectionTitle icon="◫" label="Offer Plan Reference" />
          <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 14 }}>Current plan pricing. To change prices, update the OFFERS array in code.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
            {OFFERS.map(o => (
              <div key={o.id} style={{ background: "var(--bg3)", borderRadius: 10, padding: "12px 14px", border: `1px solid ${o.color}33` }}>
                <div style={{ fontSize: 10, color: o.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{o.label}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, color: "var(--text)" }}>{previewFmtD(o.price)}</div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{o.days} days</div>
              </div>
            ))}
          </div>
        </Card>

        {/* ── Appearance ── */}
        <Card className="fade-up" style={{ animationDelay: "240ms" }}>
          <SectionTitle icon="◐" label="Appearance" />
          <div>
            <label style={lbl}>Accent Color</label>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
              {ACCENT_PRESETS.map(c => (
                <button key={c} onClick={() => set("accentColor", c)} style={{
                  width: 34, height: 34, borderRadius: "50%", background: c, border: "none",
                  outline: draft.accentColor === c ? `3px solid ${c}` : "3px solid transparent",
                  outlineOffset: 3, cursor: "pointer", transition: "outline 0.15s", flexShrink: 0
                }} />
              ))}
              <input type="color" value={draft.accentColor} onChange={e => set("accentColor", e.target.value)}
                style={{ width: 34, height: 34, padding: 2, borderRadius: "50%", cursor: "pointer", flexShrink: 0 }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text2)" }}>{draft.accentColor}</span>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ width: 48, height: 48, borderRadius: 10, background: draft.accentColor, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", color: "#000", fontSize: 20 }}>G</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, color: draft.accentColor }}>{draft.gymName || "GYM OS"}</div>
            </div>
          </div>
        </Card>

        {/* Save / Reset */}
        <div className="fade-up" style={{ display: "flex", gap: 12, animationDelay: "300ms", paddingBottom: 40 }}>
          <Btn onClick={save} style={{ flex: 2 }}>Save Settings</Btn>
          <Btn variant="ghost" onClick={reset} style={{ flex: 1 }}>Reset Defaults</Btn>
        </div>

      </div>
    </div>
  );
}

const SectionTitle = ({ icon, label }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
    <span style={{ color: "var(--accent)", fontSize: 18 }}>{icon}</span>
    <div style={{ fontWeight: 700, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text2)" }}>{label}</div>
  </div>
);

const lbl = { display: "block", fontSize: 11, color: "var(--text3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 };
