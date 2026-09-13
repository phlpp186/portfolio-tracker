import { useState, useEffect, useCallback, useRef } from "react";
import { PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, Legend } from "recharts";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const SHEET_ID = "1W6pjLjdWNqMAV4UOI8XxLIvMZIeiyjDzFCqfHqheKXc";
const API_KEY  = "AIzaSyC25q2UfO6EgP_Mu_w-CKyjbsRSZM4ABnE";
const BASE     = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;

// Sheet tab names — each becomes one tab in the spreadsheet
const TABS = {
  ASSETS:      "assets",
  P2P_LOANS:   "p2p_loans",
  P2P_INTEREST:"p2p_interest",
  RECURRING:   "recurring_rules",
  REAL_ESTATE: "real_estate",
  COMMODITIES: "commodities",
  DIVIDENDS:   "dividends",
  SNAPSHOTS:   "snapshots",
};

// ─── SHEETS API HELPERS ────────────────────────────────────────────────────
async function sheetsGet(range) {
  const url = `${BASE}/values/${encodeURIComponent(range)}?key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets GET failed: ${res.status}`);
  const json = await res.json();
  return json.values || [];
}

async function sheetsAppend(tab, rows) {
  const url = `${BASE}/values/${encodeURIComponent(tab)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&key=${API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows }),
  });
  if (!res.ok) throw new Error(`Sheets APPEND failed: ${res.status}`);
  return res.json();
}

async function sheetsClear(tab) {
  const url = `${BASE}/values/${encodeURIComponent(tab)}:clear?key=${API_KEY}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`Sheets CLEAR failed: ${res.status}`);
}

async function sheetsWrite(tab, rows) {
  await sheetsClear(tab);
  if (rows.length === 0) return;
  await sheetsAppend(tab, rows);
}

// Ensure all tabs exist in the spreadsheet
async function ensureTabs() {
  const metaUrl = `${BASE}?key=${API_KEY}`;
  const res = await fetch(metaUrl);
  const meta = await res.json();
  const existing = (meta.sheets || []).map(s => s.properties.title);
  const missing = Object.values(TABS).filter(t => !existing.includes(t));
  if (missing.length === 0) return;
  const addUrl = `${BASE}:batchUpdate?key=${API_KEY}`;
  await fetch(addUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: missing.map(t => ({ addSheet: { properties: { title: t } } })) }),
  });
}

// ─── ROW SERIALIZERS / DESERIALIZERS ──────────────────────────────────────
// Each entity has a toRow() and fromRow() function
// Schema is documented as comments — easy to replicate in SQL later

// assets: id | name | ticker | type | shares | avgCost | currentPrice | lastUpdated
const assetToRow = a => [a.id, a.name, a.ticker, a.type, a.shares, a.avgCost, a.currentPrice, a.lastUpdated || ""];
const rowToAsset = r => ({ id: r[0], name: r[1], ticker: r[2], type: r[3], shares: Number(r[4]), avgCost: Number(r[5]), currentPrice: Number(r[6]), lastUpdated: r[7] });

// p2p_loans: id | platform | loanId | amount | interestRate | startDate | endDate | note
const loanToRow = l => [l.id, l.platform, l.loanId || "", l.amount, l.interestRate, l.startDate || "", l.endDate || "", l.note || ""];
const rowToLoan = r => ({ id: r[0], platform: r[1], loanId: r[2], amount: Number(r[3]), interestRate: Number(r[4]), startDate: r[5], endDate: r[6], note: r[7] });

// p2p_interest: id | loanId | platform | amount | date | note | auto
const interestToRow = i => [i.id, i.loanId || "", i.platform || "", i.amount, i.date, i.note || "", i.auto ? "1" : "0"];
const rowToInterest = r => ({ id: r[0], loanId: r[1], platform: r[2], amount: Number(r[3]), date: r[4], note: r[5], auto: r[6] === "1" });

// recurring_rules: id | platform | loanId | amountPerDay | startDate | lastRunDate | active
const ruleToRow = r => [r.id, r.platform, r.loanId || "", r.amountPerDay, r.startDate, r.lastRunDate || "", r.active ? "1" : "0"];
const rowToRule = r => ({ id: r[0], platform: r[1], loanId: r[2], amountPerDay: Number(r[3]), startDate: r[4], lastRunDate: r[5], active: r[6] === "1" });

// real_estate: id | name | currentValue | note
const propToRow = p => [p.id, p.name, p.currentValue, p.note || ""];
const rowToProp = r => ({ id: r[0], name: r[1], currentValue: Number(r[2]), note: r[3] });

// commodities: id | name | weight | unit | pricePerUnit | note | lastUpdated
const commToRow = c => [c.id, c.name, c.weight, c.unit, c.pricePerUnit, c.note || "", c.lastUpdated || ""];
const rowToComm = r => ({ id: r[0], name: r[1], weight: Number(r[2]), unit: r[3], pricePerUnit: Number(r[4]), note: r[5], lastUpdated: r[6] });

// dividends: id | assetId | amount | date | note
const divToRow = d => [d.id, d.assetId || "", d.amount, d.date, d.note || ""];
const rowToDiv = r => ({ id: r[0], assetId: r[1], amount: Number(r[2]), date: r[3], note: r[4] });

// snapshots: id | date | totalValue | totalAssetsValue | totalP2PValue | totalRealEstateValue | totalCommoditiesValue | totalIncome
const snapToRow = s => [s.id, s.date, s.totalValue, s.totalAssetsValue, s.totalP2PValue, s.totalRealEstateValue, s.totalCommoditiesValue, s.totalIncome];
const rowToSnap = r => ({ id: r[0], date: r[1], totalValue: Number(r[2]), totalAssetsValue: Number(r[3]), totalP2PValue: Number(r[4]), totalRealEstateValue: Number(r[5]), totalCommoditiesValue: Number(r[6]), totalIncome: Number(r[7] || 0) });

// ─── LIVE PRICE FETCHERS ───────────────────────────────────────────────────
async function fetchStockPrice(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
    const res = await fetch(url);
    const json = await res.json();
    return json?.chart?.result?.[0]?.meta?.regularMarketPrice || null;
  } catch { return null; }
}

async function fetchCryptoPrice(ticker) {
  try {
    const idMap = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin", XRP: "ripple", ADA: "cardano", DOGE: "dogecoin", DOT: "polkadot", AVAX: "avalanche-2", MATIC: "matic-network", LINK: "chainlink", LTC: "litecoin" };
    const id = idMap[ticker.toUpperCase()] || ticker.toLowerCase();
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=eur`);
    const json = await res.json();
    return json?.[id]?.eur || null;
  } catch { return null; }
}

async function fetchMetalPrice(name) {
  try {
    const metalMap = { Gold: "XAU", Silver: "XAG", Platinum: "XPT", Palladium: "XPD" };
    const symbol = metalMap[name] || null;
    if (!symbol) return null;
    const res = await fetch(`https://metals.live/api/latest?base=EUR`);
    const json = await res.json();
    // metals.live returns prices per troy oz in USD; approximate EUR via rate
    const usdPrice = json?.[symbol];
    if (!usdPrice) return null;
    const rateRes = await fetch(`https://api.exchangerate.host/latest?base=USD&symbols=EUR`);
    const rateJson = await rateRes.json();
    const rate = rateJson?.rates?.EUR || 0.92;
    return usdPrice * rate;
  } catch { return null; }
}

// ─── HELPERS ───────────────────────────────────────────────────────────────
const COLORS = ["#C8A97E", "#7EB5C8", "#9B7EC8", "#7EC89B", "#C87E9B", "#C8BC7E", "#7E8DC8", "#C8957E", "#B8C87E", "#C8987E"];
const ASSET_TYPES = ["Stock", "ETF", "Crypto", "P2P Credit"];
const COMMODITY_UNITS = ["oz", "troy oz", "g", "kg"];

function formatCurrency(val) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(val || 0);
}
function formatPct(val) {
  const sign = val >= 0 ? "+" : "";
  return `${sign}${(val || 0).toFixed(2)}%`;
}
function today() { return new Date().toISOString().split("T")[0]; }

function datesBetween(startStr, endStr) {
  const dates = [], cur = new Date(startStr), end = new Date(endStr);
  cur.setDate(cur.getDate() + 1);
  while (cur <= end) { dates.push(cur.toISOString().split("T")[0]); cur.setDate(cur.getDate() + 1); }
  return dates;
}

// ─── UI PRIMITIVES ─────────────────────────────────────────────────────────
const inputStyle = { width: "100%", background: "#0D0F0E", border: "1px solid #2A2D2B", borderRadius: "2px", color: "#E8E0D0", fontSize: "14px", padding: "10px 12px", outline: "none", boxSizing: "border-box", fontFamily: "Georgia, serif" };
const btnStyle = { width: "100%", background: "#C8A97E", border: "none", borderRadius: "2px", color: "#0D0F0E", fontSize: "11px", letterSpacing: "3px", padding: "12px", cursor: "pointer", textTransform: "uppercase", fontWeight: "700", fontFamily: "Georgia, serif" };
const primaryBtnStyle = { background: "#C8A97E", border: "none", borderRadius: "2px", color: "#0D0F0E", fontSize: "11px", letterSpacing: "2px", padding: "10px 20px", cursor: "pointer", textTransform: "uppercase", fontWeight: "600", fontFamily: "Georgia, serif" };
const labelStyle = { display: "block", fontSize: "10px", letterSpacing: "2px", color: "#5A6057", textTransform: "uppercase", marginBottom: "6px" };
const thStyle = { padding: "12px 16px", textAlign: "left", fontSize: "10px", letterSpacing: "2px", color: "#5A6057", textTransform: "uppercase", fontWeight: "400" };
const tdStyle = { padding: "14px 16px", color: "#C0B8A8", fontSize: "13px" };
const smallBtnStyle = (color) => ({ background: "none", border: "1px solid #2A2D2B", borderRadius: "2px", color, fontSize: "10px", padding: "4px 10px", cursor: "pointer" });

function EmptyState({ children }) {
  return <div style={{ background: "#161918", border: "1px solid #2A2D2B", borderRadius: "4px", padding: "60px", textAlign: "center", color: "#3A3D3B", fontSize: "13px" }}>{children}</div>;
}

function TypeBadge({ type }) {
  const colors = { Crypto: { bg: "#1A1A2E", color: "#9B7EC8", border: "#2A2A3E" }, "P2P Credit": { bg: "#1A2A1E", color: "#7EC89B", border: "#2A3A2E" }, ETF: { bg: "#1A1E2A", color: "#7EB5C8", border: "#2A2E3A" }, Stock: { bg: "#2A2010", color: "#C8A97E", border: "#3A3020" } };
  const c = colors[type] || colors.Stock;
  return <span style={{ fontSize: "10px", letterSpacing: "1px", padding: "3px 8px", borderRadius: "2px", background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>{type}</span>;
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#161918", border: "1px solid #2A2D2B", borderRadius: "4px", padding: "32px", width: "460px", maxWidth: "90vw", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
          <div style={{ fontSize: "11px", letterSpacing: "3px", color: "#C8A97E", textTransform: "uppercase" }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#5A6057", cursor: "pointer", fontSize: "18px", lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatusBar({ status }) {
  if (!status) return null;
  const colors = { loading: "#7A8077", saving: "#C8A97E", success: "#7EC89B", error: "#C87E7E", prices: "#7EB5C8" };
  return (
    <div style={{ background: "#161918", borderBottom: "1px solid #2A2D2B", padding: "8px 32px", display: "flex", alignItems: "center", gap: "8px" }}>
      {status.type === "loading" || status.type === "saving" || status.type === "prices" ? (
        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: colors[status.type], display: "inline-block", animation: "pulse 1s infinite" }} />
      ) : (
        <span style={{ color: colors[status.type], fontSize: "14px" }}>{status.type === "success" ? "✓" : "✕"}</span>
      )}
      <span style={{ fontSize: "12px", color: colors[status.type] }}>{status.msg}</span>
    </div>
  );
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────
export default function PortfolioTracker() {
  const [data, setData] = useState({
    assets: [], p2pLoans: [], p2pInterest: [], recurringRules: [],
    realEstate: [], commodities: [], dividends: [], snapshots: [],
  });
  const [status, setStatus] = useState({ type: "loading", msg: "Connecting to Google Sheets…" });
  const [activeTab, setActiveTab] = useState("overview");
  const [priceUpdates, setPriceUpdates] = useState({});
  const saving = useRef(false);

  // Modal / editing state
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [showAddDividend, setShowAddDividend] = useState(false);
  const [showAddP2P, setShowAddP2P] = useState(false);
  const [showAddInterest, setShowAddInterest] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [showAddCommodity, setShowAddCommodity] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [editingP2P, setEditingP2P] = useState(null);
  const [editingRule, setEditingRule] = useState(null);
  const [editingProperty, setEditingProperty] = useState(null);
  const [editingCommodity, setEditingCommodity] = useState(null);

  // Forms
  const [assetForm, setAssetForm] = useState({ name: "", ticker: "", type: "Stock", shares: "", avgCost: "", currentPrice: "" });
  const [dividendForm, setDividendForm] = useState({ assetId: "", amount: "", date: today(), note: "" });
  const [p2pForm, setP2pForm] = useState({ platform: "", loanId: "", amount: "", interestRate: "", startDate: today(), endDate: "", note: "" });
  const [interestForm, setInterestForm] = useState({ loanId: "", amount: "", date: today(), note: "" });
  const [ruleForm, setRuleForm] = useState({ platform: "", loanId: "", amountPerDay: "", startDate: today() });
  const [propertyForm, setPropertyForm] = useState({ name: "", currentValue: "", note: "" });
  const [commodityForm, setCommodityForm] = useState({ name: "Gold", weight: "", unit: "oz", pricePerUnit: "", note: "" });
  const [snapshotDate, setSnapshotDate] = useState(today());
  const [showSnapshot, setShowSnapshot] = useState(false);

  // ── Load all data from Sheets ──────────────────────────────────────────
  const loadAll = useCallback(async () => {
    try {
      setStatus({ type: "loading", msg: "Setting up sheets…" });
      await ensureTabs();
      setStatus({ type: "loading", msg: "Loading portfolio data…" });

      const [aRows, lRows, iRows, rRows, pRows, cRows, dRows, sRows] = await Promise.all([
        sheetsGet(TABS.ASSETS), sheetsGet(TABS.P2P_LOANS), sheetsGet(TABS.P2P_INTEREST),
        sheetsGet(TABS.RECURRING), sheetsGet(TABS.REAL_ESTATE), sheetsGet(TABS.COMMODITIES),
        sheetsGet(TABS.DIVIDENDS), sheetsGet(TABS.SNAPSHOTS),
      ]);

      const loaded = {
        assets:         aRows.map(rowToAsset),
        p2pLoans:       lRows.map(rowToLoan),
        p2pInterest:    iRows.map(rowToInterest),
        recurringRules: rRows.map(rowToRule),
        realEstate:     pRows.map(rowToProp),
        commodities:    cRows.map(rowToComm),
        dividends:      dRows.map(rowToDiv),
        snapshots:      sRows.map(rowToSnap),
      };

      // Apply recurring rules
      const todayStr = today();
      let newInterest = [...loaded.p2pInterest];
      let rulesChanged = false;
      let autoAdded = 0;
      const updatedRules = loaded.recurringRules.map(rule => {
        if (!rule.active) return rule;
        const from = rule.lastRunDate || rule.startDate;
        if (!from || from >= todayStr) return rule;
        const missed = datesBetween(from, todayStr);
        if (missed.length === 0) return rule;
        missed.forEach(date => {
          newInterest.push({ id: `auto-${rule.id}-${date}`, loanId: rule.loanId || "", platform: rule.platform, amount: Number(rule.amountPerDay), date, note: `Auto — ${rule.platform}`, auto: true });
          autoAdded++;
        });
        rulesChanged = true;
        return { ...rule, lastRunDate: todayStr };
      });

      loaded.p2pInterest = newInterest;
      loaded.recurringRules = updatedRules;
      setData(loaded);

      // Save recurring changes back
      if (rulesChanged) {
        await sheetsWrite(TABS.RECURRING, updatedRules.map(ruleToRow));
        await sheetsWrite(TABS.P2P_INTEREST, newInterest.map(interestToRow));
      }

      // Fetch live prices
      setStatus({ type: "prices", msg: "Fetching live prices…" });
      await refreshPrices(loaded);

      const msg = autoAdded > 0 ? `Loaded · ${autoAdded} interest entries auto-added` : "All data loaded from Google Sheets";
      setStatus({ type: "success", msg });
      setTimeout(() => setStatus(null), 4000);
    } catch (err) {
      setStatus({ type: "error", msg: `Failed to load: ${err.message}` });
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Refresh live prices ────────────────────────────────────────────────
  const refreshPrices = async (currentData) => {
    const src = currentData || data;
    const updates = {};
    const updatedAssets = [...src.assets];
    const updatedCommodities = [...src.commodities];

    await Promise.all([
      // Stocks / ETFs / Crypto
      ...updatedAssets.map(async (a, idx) => {
        let price = null;
        if (a.type === "Crypto") price = await fetchCryptoPrice(a.ticker);
        else if (a.ticker) price = await fetchStockPrice(a.ticker);
        if (price && Math.abs(price - a.currentPrice) / (a.currentPrice || 1) > 0.0001) {
          updatedAssets[idx] = { ...a, currentPrice: price, lastUpdated: today() };
          updates[a.id] = price;
        }
      }),
      // Commodities
      ...updatedCommodities.map(async (c, idx) => {
        const price = await fetchMetalPrice(c.name);
        if (price && Math.abs(price - c.pricePerUnit) / (c.pricePerUnit || 1) > 0.0001) {
          updatedCommodities[idx] = { ...c, pricePerUnit: price, lastUpdated: today() };
          updates[`comm-${c.id}`] = price;
        }
      }),
    ]);

    if (Object.keys(updates).length > 0) {
      setPriceUpdates(updates);
      const newData = { ...(currentData || data), assets: updatedAssets, commodities: updatedCommodities };
      setData(newData);
      await sheetsWrite(TABS.ASSETS, updatedAssets.map(assetToRow));
      await sheetsWrite(TABS.COMMODITIES, updatedCommodities.map(commToRow));
    }
  };

  // ── Save helpers ───────────────────────────────────────────────────────
  const saveTab = useCallback(async (tab, rows, serializer) => {
    try {
      await sheetsWrite(tab, rows.map(serializer));
    } catch (err) {
      setStatus({ type: "error", msg: `Save failed: ${err.message}` });
    }
  }, []);

  const updateData = useCallback(async (patch, tab, serializer) => {
    const newData = { ...data, ...patch };
    setData(newData);
    const key = Object.keys(patch)[0];
    await saveTab(tab, newData[key], serializer);
    setStatus({ type: "success", msg: "Saved to Google Sheets" });
    setTimeout(() => setStatus(null), 2000);
  }, [data, saveTab]);

  // ── Computed totals ────────────────────────────────────────────────────
  const totalAssetsValue      = data.assets.reduce((s, a) => s + a.shares * a.currentPrice, 0);
  const totalP2PValue         = data.p2pLoans.reduce((s, l) => s + Number(l.amount), 0);
  const totalRealEstateValue  = data.realEstate.reduce((s, p) => s + Number(p.currentValue), 0);
  const totalCommoditiesValue = data.commodities.reduce((s, c) => s + Number(c.weight) * Number(c.pricePerUnit), 0);
  const totalRealAssetsValue  = totalRealEstateValue + totalCommoditiesValue;
  const totalValue            = totalAssetsValue + totalP2PValue + totalRealAssetsValue;
  const totalAssetsCost       = data.assets.reduce((s, a) => s + a.shares * a.avgCost, 0);
  const totalGain             = totalAssetsValue - totalAssetsCost;
  const totalGainPct          = totalAssetsCost > 0 ? (totalGain / totalAssetsCost) * 100 : 0;
  const totalDividends        = data.dividends.reduce((s, d) => s + Number(d.amount), 0);
  const totalP2PInterest      = data.p2pInterest.reduce((s, i) => s + Number(i.amount), 0);
  const totalIncome           = totalDividends + totalP2PInterest;

  const allocationData = [
    ...data.assets.map(a => ({ name: a.ticker || a.name, value: a.shares * a.currentPrice })),
    ...data.p2pLoans.map(l => ({ name: l.platform, value: Number(l.amount) })),
    ...data.realEstate.map(p => ({ name: p.name, value: Number(p.currentValue) })),
    ...data.commodities.map(c => ({ name: c.name, value: Number(c.weight) * Number(c.pricePerUnit) })),
  ].filter(a => a.value > 0);

  const snapshotChartData = [...data.snapshots]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(s => ({ date: s.date, total: s.totalValue, securities: s.totalAssetsValue, p2p: s.totalP2PValue, realEstate: s.totalRealEstateValue, commodities: s.totalCommoditiesValue }));

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleAddAsset = async () => {
    if (!assetForm.name || !assetForm.shares || !assetForm.currentPrice) return;
    const asset = { id: String(Date.now()), name: assetForm.name, ticker: assetForm.ticker.toUpperCase(), type: assetForm.type, shares: Number(assetForm.shares), avgCost: Number(assetForm.avgCost) || Number(assetForm.currentPrice), currentPrice: Number(assetForm.currentPrice), lastUpdated: today() };
    await updateData({ assets: [...data.assets, asset] }, TABS.ASSETS, assetToRow);
    setAssetForm({ name: "", ticker: "", type: "Stock", shares: "", avgCost: "", currentPrice: "" });
    setShowAddAsset(false);
  };
  const handleEditAsset = async () => { if (!editingAsset) return; await updateData({ assets: data.assets.map(a => a.id === editingAsset.id ? editingAsset : a) }, TABS.ASSETS, assetToRow); setEditingAsset(null); };
  const handleDeleteAsset = async (id) => { await updateData({ assets: data.assets.filter(a => a.id !== id) }, TABS.ASSETS, assetToRow); };

  const handleAddSnapshot = async () => {
    if (!snapshotDate) return;
    const snap = { id: String(Date.now()), date: snapshotDate, totalValue, totalAssetsValue, totalP2PValue, totalRealEstateValue, totalCommoditiesValue, totalIncome };
    const existing = data.snapshots.filter(s => s.date !== snapshotDate);
    await updateData({ snapshots: [...existing, snap] }, TABS.SNAPSHOTS, snapToRow);
    setShowSnapshot(false);
  };

  const handleAddDividend = async () => {
    if (!dividendForm.amount || !dividendForm.date) return;
    await updateData({ dividends: [...data.dividends, { id: String(Date.now()), ...dividendForm, amount: Number(dividendForm.amount) }] }, TABS.DIVIDENDS, divToRow);
    setDividendForm({ assetId: "", amount: "", date: today(), note: "" });
    setShowAddDividend(false);
  };

  const handleAddP2P = async () => {
    if (!p2pForm.platform || !p2pForm.amount || !p2pForm.interestRate) return;
    await updateData({ p2pLoans: [...data.p2pLoans, { id: String(Date.now()), ...p2pForm, amount: Number(p2pForm.amount), interestRate: Number(p2pForm.interestRate) }] }, TABS.P2P_LOANS, loanToRow);
    setP2pForm({ platform: "", loanId: "", amount: "", interestRate: "", startDate: today(), endDate: "", note: "" });
    setShowAddP2P(false);
  };
  const handleEditP2P = async () => { if (!editingP2P) return; await updateData({ p2pLoans: data.p2pLoans.map(l => l.id === editingP2P.id ? { ...editingP2P, amount: Number(editingP2P.amount), interestRate: Number(editingP2P.interestRate) } : l) }, TABS.P2P_LOANS, loanToRow); setEditingP2P(null); };
  const handleDeleteP2P = async (id) => { await updateData({ p2pLoans: data.p2pLoans.filter(l => l.id !== id) }, TABS.P2P_LOANS, loanToRow); };

  const handleAddInterest = async () => {
    if (!interestForm.amount || !interestForm.date) return;
    await updateData({ p2pInterest: [...data.p2pInterest, { id: String(Date.now()), ...interestForm, amount: Number(interestForm.amount), auto: false }] }, TABS.P2P_INTEREST, interestToRow);
    setInterestForm({ loanId: "", amount: "", date: today(), note: "" });
    setShowAddInterest(false);
  };

  const handleAddRule = async () => {
    if (!ruleForm.platform || !ruleForm.amountPerDay) return;
    await updateData({ recurringRules: [...data.recurringRules, { id: String(Date.now()), ...ruleForm, amountPerDay: Number(ruleForm.amountPerDay), lastRunDate: ruleForm.startDate, active: true }] }, TABS.RECURRING, ruleToRow);
    setRuleForm({ platform: "", loanId: "", amountPerDay: "", startDate: today() });
    setShowAddRule(false);
  };
  const handleEditRule = async () => { if (!editingRule) return; await updateData({ recurringRules: data.recurringRules.map(r => r.id === editingRule.id ? { ...editingRule, amountPerDay: Number(editingRule.amountPerDay) } : r) }, TABS.RECURRING, ruleToRow); setEditingRule(null); };
  const handleToggleRule = async (id) => { await updateData({ recurringRules: data.recurringRules.map(r => r.id === id ? { ...r, active: !r.active } : r) }, TABS.RECURRING, ruleToRow); };
  const handleDeleteRule = async (id) => { await updateData({ recurringRules: data.recurringRules.filter(r => r.id !== id) }, TABS.RECURRING, ruleToRow); };

  const handleAddProperty = async () => {
    if (!propertyForm.name || !propertyForm.currentValue) return;
    await updateData({ realEstate: [...data.realEstate, { id: String(Date.now()), ...propertyForm, currentValue: Number(propertyForm.currentValue) }] }, TABS.REAL_ESTATE, propToRow);
    setPropertyForm({ name: "", currentValue: "", note: "" });
    setShowAddProperty(false);
  };
  const handleEditProperty = async () => { if (!editingProperty) return; await updateData({ realEstate: data.realEstate.map(p => p.id === editingProperty.id ? { ...editingProperty, currentValue: Number(editingProperty.currentValue) } : p) }, TABS.REAL_ESTATE, propToRow); setEditingProperty(null); };
  const handleDeleteProperty = async (id) => { await updateData({ realEstate: data.realEstate.filter(p => p.id !== id) }, TABS.REAL_ESTATE, propToRow); };

  const handleAddCommodity = async () => {
    if (!commodityForm.name || !commodityForm.weight || !commodityForm.pricePerUnit) return;
    await updateData({ commodities: [...data.commodities, { id: String(Date.now()), ...commodityForm, weight: Number(commodityForm.weight), pricePerUnit: Number(commodityForm.pricePerUnit), lastUpdated: today() }] }, TABS.COMMODITIES, commToRow);
    setCommodityForm({ name: "Gold", weight: "", unit: "oz", pricePerUnit: "", note: "" });
    setShowAddCommodity(false);
  };
  const handleEditCommodity = async () => { if (!editingCommodity) return; await updateData({ commodities: data.commodities.map(c => c.id === editingCommodity.id ? { ...editingCommodity, weight: Number(editingCommodity.weight), pricePerUnit: Number(editingCommodity.pricePerUnit) } : c) }, TABS.COMMODITIES, commToRow); setEditingCommodity(null); };
  const handleDeleteCommodity = async (id) => { await updateData({ commodities: data.commodities.filter(c => c.id !== id) }, TABS.COMMODITIES, commToRow); };

  const tabs = ["overview", "holdings", "real assets", "p2p", "recurring", "history", "income"];

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Georgia', 'Times New Roman', serif", background: "#0D0F0E", minHeight: "100vh", color: "#E8E0D0" }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>

      {/* Header */}
      <div style={{ borderBottom: "1px solid #2A2D2B", padding: "24px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: "11px", letterSpacing: "4px", color: "#7A8077", textTransform: "uppercase", marginBottom: "4px" }}>Investment Portfolio</div>
          <div style={{ fontSize: "28px", fontWeight: "400", letterSpacing: "-0.5px", color: "#E8E0D0" }}>Performance Tracker</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "11px", letterSpacing: "3px", color: "#7A8077", textTransform: "uppercase", marginBottom: "4px" }}>Total Value</div>
          <div style={{ fontSize: "32px", fontWeight: "300", color: "#C8A97E" }}>{formatCurrency(totalValue)}</div>
          <div style={{ fontSize: "12px", color: "#7A8077", marginTop: "2px" }}>
            {formatCurrency(totalAssetsValue)} sec · {formatCurrency(totalP2PValue)} P2P · {formatCurrency(totalRealAssetsValue)} real
          </div>
          <button onClick={() => refreshPrices()} style={{ marginTop: "8px", background: "none", border: "1px solid #2A2D2B", borderRadius: "2px", color: "#7EB5C8", fontSize: "10px", letterSpacing: "2px", padding: "4px 12px", cursor: "pointer", textTransform: "uppercase" }}>↻ Refresh Prices</button>
        </div>
      </div>

      <StatusBar status={status} />

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #2A2D2B", padding: "0 32px", overflowX: "auto" }}>
        {tabs.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{ background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap", padding: "16px 18px", fontSize: "11px", letterSpacing: "3px", textTransform: "uppercase", color: activeTab === tab ? "#C8A97E" : "#5A6057", borderBottom: activeTab === tab ? "1px solid #C8A97E" : "1px solid transparent", marginBottom: "-1px" }}>
            {tab === "recurring" && data.recurringRules.filter(r => r.active).length > 0
              ? <span>Recurring <span style={{ fontSize: "9px", background: "#7EC89B", color: "#0D0F0E", borderRadius: "10px", padding: "1px 5px" }}>{data.recurringRules.filter(r => r.active).length}</span></span>
              : tab}
          </button>
        ))}
      </div>

      <div style={{ padding: "32px" }}>

        {/* ── OVERVIEW ── */}
        {activeTab === "overview" && (
          <div>
            {/* Category tiles */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "20px" }}>
              {[
                { label: "Securities", val: totalAssetsValue, sub: `${formatCurrency(totalGain)} return (${formatPct(totalGainPct)})`, color: "#C8A97E" },
                { label: "P2P Credit", val: totalP2PValue, sub: `${formatCurrency(totalP2PInterest)} interest earned`, color: "#7EC89B" },
                { label: "Real Estate", val: totalRealEstateValue, sub: `${data.realEstate.length} properties`, color: "#7EB5C8" },
                { label: "Commodities", val: totalCommoditiesValue, sub: `${data.commodities.length} holdings`, color: "#C8BC7E" },
              ].map(s => (
                <div key={s.label} style={{ background: "#161918", border: "1px solid #2A2D2B", borderRadius: "4px", padding: "20px 24px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                    <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: s.color }} />
                    <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#5A6057", textTransform: "uppercase" }}>{s.label}</div>
                  </div>
                  <div style={{ fontSize: "22px", fontWeight: "300", color: s.color }}>{formatCurrency(s.val)}</div>
                  <div style={{ fontSize: "11px", color: "#5A6057", marginTop: "4px" }}>{s.sub}</div>
                  <div style={{ fontSize: "11px", color: "#3A4038", marginTop: "2px" }}>{totalValue > 0 ? ((s.val / totalValue) * 100).toFixed(1) : 0}% of portfolio</div>
                </div>
              ))}
            </div>

            {/* Total + Income */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
              <div style={{ background: "#161918", border: "1px solid #2A2D2B", borderRadius: "4px", padding: "20px 24px" }}>
                <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#5A6057", textTransform: "uppercase", marginBottom: "8px" }}>Total Portfolio</div>
                <div style={{ fontSize: "32px", fontWeight: "300", color: "#C8A97E" }}>{formatCurrency(totalValue)}</div>
              </div>
              <div style={{ background: "#161918", border: "1px solid #2A2D2B", borderRadius: "4px", padding: "20px 24px" }}>
                <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#5A6057", textTransform: "uppercase", marginBottom: "8px" }}>Total Income Earned</div>
                <div style={{ fontSize: "32px", fontWeight: "300", color: "#7EC89B" }}>{formatCurrency(totalIncome)}</div>
                <div style={{ fontSize: "11px", color: "#4A7A5A", marginTop: "4px" }}>{formatCurrency(totalDividends)} div · {formatCurrency(totalP2PInterest)} P2P interest</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
              {/* Allocation pie */}
              <div style={{ background: "#161918", border: "1px solid #2A2D2B", borderRadius: "4px", padding: "24px" }}>
                <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#5A6057", textTransform: "uppercase", marginBottom: "20px" }}>Asset Allocation</div>
                {allocationData.length === 0 ? <div style={{ color: "#3A3D3B", textAlign: "center", padding: "40px 0", fontSize: "13px" }}>No assets yet</div> : (
                  <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
                    <PieChart width={160} height={160}>
                      <Pie data={allocationData} cx={75} cy={75} innerRadius={45} outerRadius={72} dataKey="value" paddingAngle={2}>
                        {allocationData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                    </PieChart>
                    <div style={{ flex: 1 }}>
                      {allocationData.map((item, i) => (
                        <div key={item.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                            <span style={{ fontSize: "12px", color: "#C0B8A8" }}>{item.name}</span>
                          </div>
                          <span style={{ fontSize: "11px", color: "#7A8077" }}>{totalValue > 0 ? ((item.value / totalValue) * 100).toFixed(1) : 0}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Portfolio over time */}
              <div style={{ background: "#161918", border: "1px solid #2A2D2B", borderRadius: "4px", padding: "24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                  <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#5A6057", textTransform: "uppercase" }}>Portfolio Over Time</div>
                  <button onClick={() => setShowSnapshot(true)} style={{ background: "none", border: "1px solid #2A2D2B", borderRadius: "2px", color: "#C8A97E", fontSize: "10px", letterSpacing: "2px", padding: "6px 12px", cursor: "pointer", textTransform: "uppercase" }}>+ Snapshot</button>
                </div>
                {snapshotChartData.length < 2 ? (
                  <div style={{ color: "#3A3D3B", textAlign: "center", padding: "40px 0", fontSize: "13px" }}>Save snapshots to track growth</div>
                ) : (
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={snapshotChartData}>
                      <defs>
                        <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#C8A97E" stopOpacity={0.3}/><stop offset="95%" stopColor="#C8A97E" stopOpacity={0}/></linearGradient>
                      </defs>
                      <XAxis dataKey="date" tick={{ fill: "#5A6057", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "#5A6057", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `€${(v/1000).toFixed(0)}k`} />
                      <Tooltip contentStyle={{ background: "#0D0F0E", border: "1px solid #2A2D2B", color: "#E8E0D0" }} formatter={v => [formatCurrency(v)]} />
                      <Area type="monotone" dataKey="total" stroke="#C8A97E" strokeWidth={2} fill="url(#gTotal)" name="Total" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── HOLDINGS ── */}
        {activeTab === "holdings" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#5A6057", textTransform: "uppercase" }}>{data.assets.length} Securities</div>
              <button onClick={() => setShowAddAsset(true)} style={primaryBtnStyle}>+ Add Holding</button>
            </div>
            {data.assets.length === 0 ? <EmptyState>No holdings yet.</EmptyState> : (
              <div style={{ background: "#161918", border: "1px solid #2A2D2B", borderRadius: "4px", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ borderBottom: "1px solid #2A2D2B" }}>{["Asset", "Type", "Shares", "Avg Cost", "Price", "Value", "Gain/Loss", "Updated", ""].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.assets.map((a, i) => {
                      const mv = a.shares * a.currentPrice, cost = a.shares * a.avgCost, gain = mv - cost, gainPct = cost > 0 ? (gain/cost)*100 : 0;
                      const updated = priceUpdates[a.id];
                      return (
                        <tr key={a.id} style={{ borderBottom: i < data.assets.length-1 ? "1px solid #1E2120" : "none" }}
                          onMouseEnter={e => e.currentTarget.style.background="#1A1D1B"} onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                          <td style={{ padding: "14px 16px" }}>
                            <div style={{ fontSize: "14px", color: "#E8E0D0" }}>{a.ticker || a.name}</div>
                            <div style={{ fontSize: "11px", color: "#5A6057" }}>{a.name}</div>
                          </td>
                          <td style={{ padding: "14px 16px" }}><TypeBadge type={a.type} /></td>
                          <td style={tdStyle}>{a.shares}</td>
                          <td style={tdStyle}>{formatCurrency(a.avgCost)}</td>
                          <td style={{ padding: "14px 16px" }}>
                            <div style={{ color: "#E8E0D0", fontSize: "13px" }}>{formatCurrency(a.currentPrice)}</div>
                            {updated && <div style={{ fontSize: "9px", color: "#7EB5C8", letterSpacing: "1px" }}>LIVE</div>}
                          </td>
                          <td style={{ padding: "14px 16px", color: "#E8E0D0", fontSize: "14px", fontWeight: "500" }}>{formatCurrency(mv)}</td>
                          <td style={{ padding: "14px 16px" }}>
                            <div style={{ color: gain >= 0 ? "#7EC89B" : "#C87E7E", fontSize: "13px" }}>{formatCurrency(gain)}</div>
                            <div style={{ color: gain >= 0 ? "#4A8A6A" : "#8A4A4A", fontSize: "11px" }}>{formatPct(gainPct)}</div>
                          </td>
                          <td style={{ padding: "14px 16px", color: "#3A4038", fontSize: "11px" }}>{a.lastUpdated || "—"}</td>
                          <td style={{ padding: "14px 16px" }}><div style={{ display: "flex", gap: "8px" }}><button onClick={() => setEditingAsset({...a})} style={smallBtnStyle("#C8A97E")}>Edit</button><button onClick={() => handleDeleteAsset(a.id)} style={smallBtnStyle("#C87E7E")}>✕</button></div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── REAL ASSETS ── */}
        {activeTab === "real assets" && (
          <div>
            {/* Real Estate */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#5A6057", textTransform: "uppercase", marginBottom: "4px" }}>Real Estate</div>
                <div style={{ fontSize: "20px", fontWeight: "300", color: "#7EB5C8" }}>{formatCurrency(totalRealEstateValue)}</div>
              </div>
              <button onClick={() => setShowAddProperty(true)} style={primaryBtnStyle}>+ Add Property</button>
            </div>
            {data.realEstate.length === 0 ? <EmptyState>No properties yet.</EmptyState> : (
              <div style={{ background: "#161918", border: "1px solid #2A2D2B", borderRadius: "4px", overflow: "hidden", marginBottom: "36px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ borderBottom: "1px solid #2A2D2B" }}>{["Property", "Current Value", "Portfolio Share", "Note", ""].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.realEstate.map((p, i) => (
                      <tr key={p.id} style={{ borderBottom: i < data.realEstate.length-1 ? "1px solid #1E2120" : "none" }}
                        onMouseEnter={e => e.currentTarget.style.background="#1A1D1B"} onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                        <td style={{ padding: "14px 16px", color: "#E8E0D0", fontSize: "14px" }}>{p.name}</td>
                        <td style={{ padding: "14px 16px", color: "#7EB5C8", fontSize: "16px", fontWeight: "300" }}>{formatCurrency(p.currentValue)}</td>
                        <td style={tdStyle}>{totalValue > 0 ? ((p.currentValue/totalValue)*100).toFixed(1) : 0}%</td>
                        <td style={{ padding: "14px 16px", color: "#5A6057", fontSize: "12px" }}>{p.note || "—"}</td>
                        <td style={{ padding: "14px 16px" }}><div style={{ display: "flex", gap: "8px" }}><button onClick={() => setEditingProperty({...p})} style={smallBtnStyle("#C8A97E")}>Edit</button><button onClick={() => handleDeleteProperty(p.id)} style={smallBtnStyle("#C87E7E")}>✕</button></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Commodities */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#5A6057", textTransform: "uppercase", marginBottom: "4px" }}>Commodities</div>
                <div style={{ fontSize: "20px", fontWeight: "300", color: "#C8BC7E" }}>{formatCurrency(totalCommoditiesValue)}</div>
              </div>
              <button onClick={() => setShowAddCommodity(true)} style={primaryBtnStyle}>+ Add Commodity</button>
            </div>
            {data.commodities.length === 0 ? <EmptyState>No commodities yet. Add gold or other physical assets.</EmptyState> : (
              <div style={{ background: "#161918", border: "1px solid #2A2D2B", borderRadius: "4px", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ borderBottom: "1px solid #2A2D2B" }}>{["Asset", "Weight", "Price / Unit", "Total Value", "Share", "Updated", ""].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.commodities.map((c, i) => {
                      const val = Number(c.weight) * Number(c.pricePerUnit);
                      const updated = priceUpdates[`comm-${c.id}`];
                      return (
                        <tr key={c.id} style={{ borderBottom: i < data.commodities.length-1 ? "1px solid #1E2120" : "none" }}
                          onMouseEnter={e => e.currentTarget.style.background="#1A1D1B"} onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                          <td style={{ padding: "14px 16px", color: "#E8E0D0", fontSize: "14px" }}>{c.name}</td>
                          <td style={tdStyle}>{c.weight} {c.unit}</td>
                          <td style={{ padding: "14px 16px" }}>
                            <div style={tdStyle}>{formatCurrency(c.pricePerUnit)} / {c.unit}</div>
                            {updated && <div style={{ fontSize: "9px", color: "#7EB5C8", letterSpacing: "1px" }}>LIVE</div>}
                          </td>
                          <td style={{ padding: "14px 16px", color: "#C8BC7E", fontSize: "16px", fontWeight: "300" }}>{formatCurrency(val)}</td>
                          <td style={tdStyle}>{totalValue > 0 ? ((val/totalValue)*100).toFixed(1) : 0}%</td>
                          <td style={{ padding: "14px 16px", color: "#3A4038", fontSize: "11px" }}>{c.lastUpdated || "—"}</td>
                          <td style={{ padding: "14px 16px" }}><div style={{ display: "flex", gap: "8px" }}><button onClick={() => setEditingCommodity({...c})} style={smallBtnStyle("#C8A97E")}>Edit</button><button onClick={() => handleDeleteCommodity(c.id)} style={smallBtnStyle("#C87E7E")}>✕</button></div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── P2P CREDIT ── */}
        {activeTab === "p2p" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "16px", marginBottom: "28px" }}>
              {[{ label: "Total Deployed", val: formatCurrency(totalP2PValue) }, { label: "Interest Earned", val: formatCurrency(totalP2PInterest), color: "#C8A97E" }, { label: "Active Loans", val: data.p2pLoans.length }].map(s => (
                <div key={s.label} style={{ background: "#161918", border: "1px solid #2A2D2B", borderRadius: "4px", padding: "20px 24px" }}>
                  <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#5A6057", textTransform: "uppercase", marginBottom: "8px" }}>{s.label}</div>
                  <div style={{ fontSize: "24px", fontWeight: "300", color: s.color || "#E8E0D0" }}>{s.val}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#5A6057", textTransform: "uppercase" }}>Loans & Investments</div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button onClick={() => setShowAddInterest(true)} style={{ background: "none", border: "1px solid #2A2D2B", borderRadius: "2px", color: "#7EC89B", fontSize: "10px", letterSpacing: "2px", padding: "8px 16px", cursor: "pointer", textTransform: "uppercase" }}>+ Log Interest</button>
                <button onClick={() => setShowAddP2P(true)} style={primaryBtnStyle}>+ Add Loan</button>
              </div>
            </div>
            {data.p2pLoans.length === 0 ? <EmptyState>No P2P loans yet.</EmptyState> : (
              <div style={{ background: "#161918", border: "1px solid #2A2D2B", borderRadius: "4px", overflow: "hidden", marginBottom: "28px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ borderBottom: "1px solid #2A2D2B" }}>{["Platform","Loan ID","Amount","Rate p.a.","Start","End","Interest Earned",""].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.p2pLoans.map((l, i) => {
                      const earned = data.p2pInterest.filter(p => String(p.loanId) === String(l.id)).reduce((s,p) => s+Number(p.amount), 0);
                      return (
                        <tr key={l.id} style={{ borderBottom: i<data.p2pLoans.length-1 ? "1px solid #1E2120" : "none" }}
                          onMouseEnter={e => e.currentTarget.style.background="#1A1D1B"} onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                          <td style={{ padding: "14px 16px" }}><div style={{ fontSize: "14px", color: "#E8E0D0" }}>{l.platform}</div>{l.note && <div style={{ fontSize: "11px", color: "#5A6057" }}>{l.note}</div>}</td>
                          <td style={tdStyle}>{l.loanId || "—"}</td>
                          <td style={{ padding: "14px 16px", color: "#E8E0D0", fontSize: "14px" }}>{formatCurrency(l.amount)}</td>
                          <td style={{ padding: "14px 16px" }}><span style={{ color: "#7EC89B", fontSize: "14px", fontWeight: "500" }}>{l.interestRate}%</span></td>
                          <td style={tdStyle}>{l.startDate || "—"}</td>
                          <td style={tdStyle}>{l.endDate || <span style={{ color: "#3A6A4A" }}>Open</span>}</td>
                          <td style={{ padding: "14px 16px", color: "#C8A97E", fontSize: "14px" }}>{formatCurrency(earned)}</td>
                          <td style={{ padding: "14px 16px" }}><div style={{ display: "flex", gap: "8px" }}><button onClick={() => setEditingP2P({...l})} style={smallBtnStyle("#C8A97E")}>Edit</button><button onClick={() => handleDeleteP2P(l.id)} style={smallBtnStyle("#C87E7E")}>✕</button></div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {data.p2pInterest.length > 0 && (
              <>
                <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#5A6057", textTransform: "uppercase", marginBottom: "16px" }}>Recent Interest Payments</div>
                <div style={{ background: "#161918", border: "1px solid #2A2D2B", borderRadius: "4px", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr style={{ borderBottom: "1px solid #2A2D2B" }}>{["Date","Platform","Amount","Note"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                    <tbody>
                      {[...data.p2pInterest].sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0,30).map((p,i,arr) => {
                        const loan = data.p2pLoans.find(l => String(l.id)===String(p.loanId));
                        return (
                          <tr key={p.id} style={{ borderBottom: i<arr.length-1 ? "1px solid #1E2120" : "none" }}>
                            <td style={tdStyle}>{p.date}</td>
                            <td style={{ padding: "14px 16px", color: "#C0B8A8", fontSize: "13px" }}>{p.platform || (loan ? loan.platform : "—")}{p.auto && <span style={{ fontSize: "9px", color: "#3A6A4A", marginLeft: "6px" }}>AUTO</span>}</td>
                            <td style={{ padding: "14px 16px", color: "#C8A97E", fontSize: "14px" }}>{formatCurrency(p.amount)}</td>
                            <td style={{ padding: "14px 16px", color: "#5A6057", fontSize: "12px" }}>{p.note || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── RECURRING ── */}
        {activeTab === "recurring" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <div>
                <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#5A6057", textTransform: "uppercase", marginBottom: "4px" }}>Recurring Daily Interest</div>
                <div style={{ fontSize: "13px", color: "#7A8077" }}>Missed days are backfilled automatically on each open.</div>
              </div>
              <button onClick={() => setShowAddRule(true)} style={primaryBtnStyle}>+ Add Rule</button>
            </div>
            {data.recurringRules.filter(r => r.active).length > 0 && (
              <div style={{ background: "#1A2A1A", border: "1px solid #2A3A2A", borderRadius: "4px", padding: "16px 24px", marginTop: "16px", marginBottom: "24px", display: "flex", alignItems: "center", gap: "16px" }}>
                <span style={{ fontSize: "10px", letterSpacing: "3px", color: "#4A8A5A", textTransform: "uppercase" }}>Daily Auto-Total</span>
                <span style={{ fontSize: "22px", color: "#7EC89B", fontWeight: "300" }}>{formatCurrency(data.recurringRules.filter(r=>r.active).reduce((s,r)=>s+Number(r.amountPerDay),0))}<span style={{ fontSize: "12px", color: "#4A7A5A", marginLeft: "6px" }}>/day</span></span>
              </div>
            )}
            {data.recurringRules.length === 0 ? <EmptyState>No recurring rules yet.</EmptyState> : (
              <div style={{ background: "#161918", border: "1px solid #2A2D2B", borderRadius: "4px", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ borderBottom: "1px solid #2A2D2B" }}>{["Platform","Daily Amount","Started","Last Run","Status",""].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.recurringRules.map((r,i) => (
                      <tr key={r.id} style={{ borderBottom: i<data.recurringRules.length-1 ? "1px solid #1E2120" : "none" }}
                        onMouseEnter={e => e.currentTarget.style.background="#1A1D1B"} onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                        <td style={{ padding: "14px 16px" }}><div style={{ fontSize: "14px", color: "#E8E0D0" }}>{r.platform}</div>{r.loanId && <div style={{ fontSize: "11px", color: "#5A6057" }}>{r.loanId}</div>}</td>
                        <td style={{ padding: "14px 16px" }}><span style={{ color: "#7EC89B", fontSize: "16px", fontWeight: "300" }}>{formatCurrency(r.amountPerDay)}</span><span style={{ color: "#4A7A5A", fontSize: "11px" }}> /day</span></td>
                        <td style={tdStyle}>{r.startDate}</td>
                        <td style={tdStyle}>{r.lastRunDate || "—"}</td>
                        <td style={{ padding: "14px 16px" }}><button onClick={() => handleToggleRule(r.id)} style={{ fontSize: "10px", letterSpacing: "1px", padding: "4px 10px", borderRadius: "2px", cursor: "pointer", background: r.active ? "#1A2A1A" : "#1E1E1E", color: r.active ? "#7EC89B" : "#5A6057", border: `1px solid ${r.active ? "#2A3A2A" : "#2A2D2B"}` }}>{r.active ? "● Active" : "○ Paused"}</button></td>
                        <td style={{ padding: "14px 16px" }}><div style={{ display: "flex", gap: "8px" }}><button onClick={() => setEditingRule({...r})} style={smallBtnStyle("#C8A97E")}>Edit</button><button onClick={() => handleDeleteRule(r.id)} style={smallBtnStyle("#C87E7E")}>✕</button></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── HISTORY ── */}
        {activeTab === "history" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#5A6057", textTransform: "uppercase" }}>Portfolio Snapshots · {data.snapshots.length} saved</div>
              <button onClick={() => setShowSnapshot(true)} style={primaryBtnStyle}>+ Save Snapshot</button>
            </div>

            {snapshotChartData.length >= 2 && (
              <div style={{ background: "#161918", border: "1px solid #2A2D2B", borderRadius: "4px", padding: "24px", marginBottom: "24px" }}>
                <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#5A6057", textTransform: "uppercase", marginBottom: "16px" }}>Value by Asset Class Over Time</div>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={snapshotChartData}>
                    <defs>
                      <linearGradient id="gSec" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#C8A97E" stopOpacity={0.4}/><stop offset="95%" stopColor="#C8A97E" stopOpacity={0}/></linearGradient>
                      <linearGradient id="gP2P" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#7EC89B" stopOpacity={0.4}/><stop offset="95%" stopColor="#7EC89B" stopOpacity={0}/></linearGradient>
                      <linearGradient id="gRE" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#7EB5C8" stopOpacity={0.4}/><stop offset="95%" stopColor="#7EB5C8" stopOpacity={0}/></linearGradient>
                      <linearGradient id="gComm" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#C8BC7E" stopOpacity={0.4}/><stop offset="95%" stopColor="#C8BC7E" stopOpacity={0}/></linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fill: "#5A6057", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#5A6057", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `€${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ background: "#0D0F0E", border: "1px solid #2A2D2B", color: "#E8E0D0" }} formatter={v => [formatCurrency(v)]} />
                    <Legend wrapperStyle={{ fontSize: "11px", color: "#7A8077" }} />
                    <Area type="monotone" dataKey="securities" stroke="#C8A97E" strokeWidth={2} fill="url(#gSec)" name="Securities" stackId="1" />
                    <Area type="monotone" dataKey="p2p" stroke="#7EC89B" strokeWidth={2} fill="url(#gP2P)" name="P2P Credit" stackId="1" />
                    <Area type="monotone" dataKey="realEstate" stroke="#7EB5C8" strokeWidth={2} fill="url(#gRE)" name="Real Estate" stackId="1" />
                    <Area type="monotone" dataKey="commodities" stroke="#C8BC7E" strokeWidth={2} fill="url(#gComm)" name="Commodities" stackId="1" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {data.snapshots.length === 0 ? <EmptyState>Save your first snapshot to start tracking performance over time.</EmptyState> : (
              <div style={{ background: "#161918", border: "1px solid #2A2D2B", borderRadius: "4px", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ borderBottom: "1px solid #2A2D2B" }}>{["Date","Total","Securities","P2P","Real Estate","Commodities"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {[...data.snapshots].sort((a,b) => new Date(b.date)-new Date(a.date)).map((s,i,arr) => (
                      <tr key={s.id} style={{ borderBottom: i<arr.length-1 ? "1px solid #1E2120" : "none" }}>
                        <td style={tdStyle}>{s.date}</td>
                        <td style={{ padding: "14px 16px", color: "#C8A97E", fontSize: "14px", fontWeight: "500" }}>{formatCurrency(s.totalValue)}</td>
                        <td style={tdStyle}>{formatCurrency(s.totalAssetsValue)}</td>
                        <td style={tdStyle}>{formatCurrency(s.totalP2PValue)}</td>
                        <td style={tdStyle}>{formatCurrency(s.totalRealEstateValue)}</td>
                        <td style={tdStyle}>{formatCurrency(s.totalCommoditiesValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── INCOME ── */}
        {activeTab === "income" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <div>
                <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#5A6057", textTransform: "uppercase", marginBottom: "4px" }}>Total Income</div>
                <div style={{ fontSize: "24px", color: "#C8A97E" }}>{formatCurrency(totalIncome)}</div>
                <div style={{ fontSize: "12px", color: "#5A6057", marginTop: "4px" }}>{formatCurrency(totalDividends)} dividends · {formatCurrency(totalP2PInterest)} P2P interest</div>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button onClick={() => setShowAddInterest(true)} style={{ background: "none", border: "1px solid #2A2D2B", borderRadius: "2px", color: "#7EC89B", fontSize: "10px", letterSpacing: "2px", padding: "8px 16px", cursor: "pointer", textTransform: "uppercase" }}>+ P2P Interest</button>
                <button onClick={() => setShowAddDividend(true)} style={primaryBtnStyle}>+ Dividend</button>
              </div>
            </div>
            {(data.dividends.length === 0 && data.p2pInterest.length === 0) ? <EmptyState>No income logged yet.</EmptyState> : (
              <div style={{ background: "#161918", border: "1px solid #2A2D2B", borderRadius: "4px", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ borderBottom: "1px solid #2A2D2B" }}>{["Date","Source","Type","Amount","Note"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>
                    {[...data.dividends.map(d => ({...d, _type: "Dividend"})), ...data.p2pInterest.map(p => ({...p, _type: "P2P Interest"}))]
                      .sort((a,b) => new Date(b.date)-new Date(a.date))
                      .map((item, i, arr) => {
                        let source = item.platform || "—";
                        if (item._type === "Dividend") { const asset = data.assets.find(a => a.id === item.assetId); source = asset ? (asset.ticker || asset.name) : "—"; }
                        else if (!item.platform) { const loan = data.p2pLoans.find(l => String(l.id)===String(item.loanId)); source = loan ? loan.platform : "—"; }
                        return (
                          <tr key={item.id+item._type} style={{ borderBottom: i<arr.length-1 ? "1px solid #1E2120" : "none" }}>
                            <td style={tdStyle}>{item.date}</td>
                            <td style={{ padding: "14px 16px", color: "#C0B8A8", fontSize: "13px" }}>{source}{item.auto && <span style={{ fontSize: "9px", color: "#3A6A4A", marginLeft: "6px" }}>AUTO</span>}</td>
                            <td style={{ padding: "14px 16px" }}><span style={{ fontSize: "10px", letterSpacing: "1px", padding: "3px 8px", borderRadius: "2px", background: item._type==="P2P Interest"?"#1A2A1A":"#1A1A2E", color: item._type==="P2P Interest"?"#7EC89B":"#9B7EC8", border: `1px solid ${item._type==="P2P Interest"?"#2A3A2A":"#2A2A3E"}` }}>{item._type}</span></td>
                            <td style={{ padding: "14px 16px", color: "#C8A97E", fontSize: "14px" }}>{formatCurrency(item.amount)}</td>
                            <td style={{ padding: "14px 16px", color: "#5A6057", fontSize: "12px" }}>{item.note || "—"}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── MODALS ── */}
      {(showAddAsset || editingAsset) && (
        <Modal title={editingAsset ? "Edit Holding" : "Add Holding"} onClose={() => { setShowAddAsset(false); setEditingAsset(null); }}>
          {["name","ticker","shares","avgCost","currentPrice"].map(f => (
            <div key={f} style={{ marginBottom: "16px" }}>
              <label style={labelStyle}>{f==="avgCost"?"Avg Cost / Unit":f==="currentPrice"?"Current Price":f.charAt(0).toUpperCase()+f.slice(1)}</label>
              <input type={["shares","avgCost","currentPrice"].includes(f)?"number":"text"} style={inputStyle}
                value={editingAsset ? editingAsset[f] : assetForm[f]}
                onChange={e => editingAsset ? setEditingAsset({...editingAsset,[f]:e.target.value}) : setAssetForm({...assetForm,[f]:e.target.value})}
                placeholder={f==="avgCost"?"defaults to current price":f==="ticker"?"e.g. VWCE, BTC, AAPL":""} />
            </div>
          ))}
          <div style={{ marginBottom: "20px" }}>
            <label style={labelStyle}>Type</label>
            <select style={{...inputStyle,cursor:"pointer"}} value={editingAsset?editingAsset.type:assetForm.type} onChange={e => editingAsset?setEditingAsset({...editingAsset,type:e.target.value}):setAssetForm({...assetForm,type:e.target.value})}>
              {ASSET_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <p style={{ color: "#5A6057", fontSize: "11px", marginBottom: "16px" }}>💡 Enter the ticker exactly as it appears on Yahoo Finance (e.g. VWCE.AS for Euronext). Crypto: BTC, ETH, SOL etc.</p>
          <button onClick={editingAsset ? handleEditAsset : handleAddAsset} style={btnStyle}>{editingAsset?"Save Changes":"Add Holding"}</button>
        </Modal>
      )}

      {(showAddProperty || editingProperty) && (
        <Modal title={editingProperty?"Edit Property":"Add Property"} onClose={() => { setShowAddProperty(false); setEditingProperty(null); }}>
          {[{f:"name",l:"Property Name / Address",t:"text"},{f:"currentValue",l:"Current Estimated Value (€)",t:"number"},{f:"note",l:"Note (optional)",t:"text"}].map(({f,l,t}) => (
            <div key={f} style={{ marginBottom: "16px" }}>
              <label style={labelStyle}>{l}</label>
              <input type={t} style={inputStyle} value={editingProperty?(editingProperty[f]||""):propertyForm[f]} onChange={e => editingProperty?setEditingProperty({...editingProperty,[f]:e.target.value}):setPropertyForm({...propertyForm,[f]:e.target.value})} />
            </div>
          ))}
          <button onClick={editingProperty?handleEditProperty:handleAddProperty} style={btnStyle}>{editingProperty?"Save Changes":"Add Property"}</button>
        </Modal>
      )}

      {(showAddCommodity || editingCommodity) && (
        <Modal title={editingCommodity?"Edit Commodity":"Add Commodity"} onClose={() => { setShowAddCommodity(false); setEditingCommodity(null); }}>
          <div style={{ marginBottom: "16px" }}>
            <label style={labelStyle}>Asset Name</label>
            <input type="text" style={inputStyle} value={editingCommodity?editingCommodity.name:commodityForm.name} onChange={e => editingCommodity?setEditingCommodity({...editingCommodity,name:e.target.value}):setCommodityForm({...commodityForm,name:e.target.value})} placeholder="Gold, Silver, Platinum…" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px", marginBottom: "16px" }}>
            <div>
              <label style={labelStyle}>Weight / Quantity</label>
              <input type="number" style={inputStyle} value={editingCommodity?editingCommodity.weight:commodityForm.weight} onChange={e => editingCommodity?setEditingCommodity({...editingCommodity,weight:e.target.value}):setCommodityForm({...commodityForm,weight:e.target.value})} placeholder="e.g. 5" />
            </div>
            <div>
              <label style={labelStyle}>Unit</label>
              <select style={{...inputStyle,cursor:"pointer"}} value={editingCommodity?editingCommodity.unit:commodityForm.unit} onChange={e => editingCommodity?setEditingCommodity({...editingCommodity,unit:e.target.value}):setCommodityForm({...commodityForm,unit:e.target.value})}>
                {COMMODITY_UNITS.map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: "16px" }}>
            <label style={labelStyle}>Price per {editingCommodity?editingCommodity.unit:commodityForm.unit} (€)</label>
            <input type="number" style={inputStyle} value={editingCommodity?editingCommodity.pricePerUnit:commodityForm.pricePerUnit} onChange={e => editingCommodity?setEditingCommodity({...editingCommodity,pricePerUnit:e.target.value}):setCommodityForm({...commodityForm,pricePerUnit:e.target.value})} placeholder="Gold ≈ 2800 / troy oz" />
          </div>
          {(() => { const w=Number(editingCommodity?editingCommodity.weight:commodityForm.weight), p=Number(editingCommodity?editingCommodity.pricePerUnit:commodityForm.pricePerUnit); return w>0&&p>0 ? <div style={{ background:"#1A1D1B",borderRadius:"4px",padding:"12px 16px",marginBottom:"16px",display:"flex",justifyContent:"space-between"}}><span style={{color:"#5A6057",fontSize:"12px"}}>Total Value</span><span style={{color:"#C8BC7E",fontSize:"15px"}}>{formatCurrency(w*p)}</span></div> : null; })()}
          <div style={{ marginBottom: "20px" }}>
            <label style={labelStyle}>Note (optional)</label>
            <input type="text" style={inputStyle} value={editingCommodity?(editingCommodity.note||""):commodityForm.note} onChange={e => editingCommodity?setEditingCommodity({...editingCommodity,note:e.target.value}):setCommodityForm({...commodityForm,note:e.target.value})} />
          </div>
          <button onClick={editingCommodity?handleEditCommodity:handleAddCommodity} style={btnStyle}>{editingCommodity?"Save Changes":"Add Commodity"}</button>
        </Modal>
      )}

      {(showAddP2P || editingP2P) && (
        <Modal title={editingP2P?"Edit P2P Loan":"Add P2P Loan"} onClose={() => { setShowAddP2P(false); setEditingP2P(null); }}>
          {[{f:"platform",l:"Platform / Lender",t:"text"},{f:"loanId",l:"Loan ID (optional)",t:"text"},{f:"amount",l:"Invested Amount (€)",t:"number"},{f:"interestRate",l:"Annual Interest Rate (%)",t:"number"},{f:"startDate",l:"Start Date",t:"date"},{f:"endDate",l:"End Date (optional)",t:"date"},{f:"note",l:"Note (optional)",t:"text"}].map(({f,l,t}) => (
            <div key={f} style={{ marginBottom: "16px" }}>
              <label style={labelStyle}>{l}</label>
              <input type={t} style={inputStyle} value={editingP2P?(editingP2P[f]||""):p2pForm[f]} onChange={e => editingP2P?setEditingP2P({...editingP2P,[f]:e.target.value}):setP2pForm({...p2pForm,[f]:e.target.value})} />
            </div>
          ))}
          <button onClick={editingP2P?handleEditP2P:handleAddP2P} style={btnStyle}>{editingP2P?"Save Changes":"Add Loan"}</button>
        </Modal>
      )}

      {showAddInterest && (
        <Modal title="Log Interest Payment" onClose={() => setShowAddInterest(false)}>
          <div style={{ marginBottom: "16px" }}>
            <label style={labelStyle}>Loan / Platform</label>
            <select style={{...inputStyle,cursor:"pointer"}} value={interestForm.loanId} onChange={e => setInterestForm({...interestForm,loanId:e.target.value})}>
              <option value="">— Select loan (optional)</option>
              {data.p2pLoans.map(l => <option key={l.id} value={l.id}>{l.platform}{l.loanId?` · ${l.loanId}`:""}</option>)}
            </select>
          </div>
          {[{f:"amount",l:"Amount (€)",t:"number"},{f:"date",l:"Date",t:"date"},{f:"note",l:"Note (optional)",t:"text"}].map(({f,l,t}) => (
            <div key={f} style={{ marginBottom: "16px" }}>
              <label style={labelStyle}>{l}</label>
              <input type={t} style={inputStyle} value={interestForm[f]} onChange={e => setInterestForm({...interestForm,[f]:e.target.value})} />
            </div>
          ))}
          <button onClick={handleAddInterest} style={btnStyle}>Log Interest</button>
        </Modal>
      )}

      {showAddDividend && (
        <Modal title="Log Dividend Payment" onClose={() => setShowAddDividend(false)}>
          <div style={{ marginBottom: "16px" }}>
            <label style={labelStyle}>Asset</label>
            <select style={{...inputStyle,cursor:"pointer"}} value={dividendForm.assetId} onChange={e => setDividendForm({...dividendForm,assetId:e.target.value})}>
              <option value="">— Select asset (optional)</option>
              {data.assets.map(a => <option key={a.id} value={a.id}>{a.ticker||a.name}</option>)}
            </select>
          </div>
          {[{f:"amount",l:"Amount (€)",t:"number"},{f:"date",l:"Date",t:"date"},{f:"note",l:"Note (optional)",t:"text"}].map(({f,l,t}) => (
            <div key={f} style={{ marginBottom: "16px" }}>
              <label style={labelStyle}>{l}</label>
              <input type={t} style={inputStyle} value={dividendForm[f]} onChange={e => setDividendForm({...dividendForm,[f]:e.target.value})} />
            </div>
          ))}
          <button onClick={handleAddDividend} style={btnStyle}>Log Payment</button>
        </Modal>
      )}

      {(showAddRule || editingRule) && (
        <Modal title={editingRule?"Edit Recurring Rule":"Add Daily Interest Rule"} onClose={() => { setShowAddRule(false); setEditingRule(null); }}>
          <p style={{ color: "#7A8077", fontSize: "13px", marginBottom: "20px", lineHeight: "1.6" }}>Set a fixed daily amount. Missed days backfill automatically on open.</p>
          {[{f:"platform",l:"Platform Name",t:"text"},{f:"loanId",l:"Loan / Account ID (optional)",t:"text"},{f:"amountPerDay",l:"Daily Interest Amount (€)",t:"number"},{f:"startDate",l:"Start Date",t:"date"}].map(({f,l,t}) => (
            <div key={f} style={{ marginBottom: "16px" }}>
              <label style={labelStyle}>{l}</label>
              <input type={t} style={inputStyle} placeholder={f==="amountPerDay"?"e.g. 1.50":""} value={editingRule?(editingRule[f]||""):ruleForm[f]} onChange={e => editingRule?setEditingRule({...editingRule,[f]:e.target.value}):setRuleForm({...ruleForm,[f]:e.target.value})} />
            </div>
          ))}
          {editingRule && (
            <div style={{ marginBottom: "20px" }}>
              <label style={labelStyle}>Last Run Date (backfill from here)</label>
              <input type="date" style={inputStyle} value={editingRule.lastRunDate||""} onChange={e => setEditingRule({...editingRule,lastRunDate:e.target.value})} />
            </div>
          )}
          <button onClick={editingRule?handleEditRule:handleAddRule} style={btnStyle}>{editingRule?"Save Changes":"Add Rule"}</button>
        </Modal>
      )}

      {showSnapshot && (
        <Modal title="Save Portfolio Snapshot" onClose={() => setShowSnapshot(false)}>
          <p style={{ color: "#7A8077", fontSize: "13px", marginBottom: "20px", lineHeight: "1.6" }}>Captures current values across all asset classes. Used for the history chart.</p>
          <div style={{ marginBottom: "20px" }}>
            <label style={labelStyle}>Snapshot Date</label>
            <input type="date" style={inputStyle} value={snapshotDate} onChange={e => setSnapshotDate(e.target.value)} />
          </div>
          <div style={{ background: "#1A1D1B", borderRadius: "4px", padding: "16px", marginBottom: "20px" }}>
            {[{l:"Securities",v:totalAssetsValue,color:"#C8A97E"},{l:"P2P Credit",v:totalP2PValue,color:"#7EC89B"},{l:"Real Estate",v:totalRealEstateValue,color:"#7EB5C8"},{l:"Commodities",v:totalCommoditiesValue,color:"#C8BC7E"},{l:"Total",v:totalValue,highlight:true}].map(r => (
              <div key={r.l} style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ color: "#5A6057", fontSize: "12px" }}>{r.l}</span>
                <span style={{ color: r.highlight?"#C8A97E":(r.color||"#C0B8A8"), fontSize: r.highlight?"16px":"13px", fontWeight: r.highlight?"400":"300" }}>{formatCurrency(r.v)}</span>
              </div>
            ))}
          </div>
          <button onClick={handleAddSnapshot} style={btnStyle}>Save Snapshot</button>
        </Modal>
      )}
    </div>
  );
}
