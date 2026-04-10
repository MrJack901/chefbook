import { useState, useEffect, useRef } from "react";
import type { CSSProperties, KeyboardEvent, ChangeEvent } from "react";

// ─── CONFIGURAZIONE SUPABASE ───────────────────────────────────────
const SUPABASE_URL = 'https://eotxguvsrgbrgdaxhfwz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvdHhndXZzcmdicmdkYXhoZnd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMjY3ODMsImV4cCI6MjA4ODgwMjc4M30.GthcPCt_JyxFpK0AWGVnEr2cqjjLx7bnKcvm-FtKuU4';
// ──────────────────────────────────────────────────────────────────

// ─── TIPI ──────────────────────────────────────────────────────────
interface User { id: string; email: string; user_metadata?: { display_name?: string } }
interface Session { access_token: string; user: User }
interface Recipe {
  id: string; created_at?: string; title: string; creation_time: string;
  date: string | null; type: string; weight: string; servings: number;
  ingredients: string; procedure: string; photo_url: string;
  notes: string; cost: string; author: string;
}
interface FormState {
  id: string | null; title: string; creation_time: string; date: string;
  type: string; weight: string; servings: number; ingredients: string;
  procedure: string; photo_url: string; notes: string; cost: string; author: string;
}
interface AppUser { id: string; email: string; display_name: string | null; is_admin: boolean; created_at: string }
interface AccountRequest { id: string; email: string; display_name: string; message: string | null; status: string; created_at: string }
interface MetaItem { icon: string; label: string; value: string; accent?: boolean }

// ─── HELPERS ──────────────────────────────────────────────────────
const dispName = (sess: Session) => sess.user.user_metadata?.display_name || sess.user.email.split('@')[0];

const makeHdr = (token?: string): Record<string, string> => ({
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${token || SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
});

const compressImage = (file: File): Promise<Blob> => new Promise(resolve => {
  const img = new Image(); const url = URL.createObjectURL(file);
  img.onload = () => {
    const MAX = 1200; let w = img.width, h = img.height;
    if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.getContext('2d')!.drawImage(img, 0, 0, w, h);
    cv.toBlob(b => { URL.revokeObjectURL(url); resolve(b as Blob); }, 'image/jpeg', 0.78);
  }; img.src = url;
});

const stepsToDb = (steps: string[]) => JSON.stringify(steps.filter(s => s.trim() || steps.length === 1));
const dbToSteps = (p: string): string[] => {
  if (!p) return [''];
  try { const r = JSON.parse(p); if (Array.isArray(r) && r.length) return r as string[]; } catch {}
  return [p];
};

const parseW = (w: string): number | null => {
  if (!w) return null;
  const m = w.match(/(\d+(?:[.,]\d+)?)/);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
};

const multiplyIng = (text: string, mul: number): string => {
  if (!text || mul === 1) return text;
  const map = new Map<string, string>(); let idx = 0;
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const tok = (i: number) => `PHOLD${L[Math.floor(i/26)%26]}${L[i%26]}`;
  const pt = text.replace(/\([^)]*\)/g, m => { const t = tok(idx++); map.set(t, m); return t; });
  const md = pt.replace(/(?<![a-zA-Z])(\d+(?:[.,]\d+)?)/g, m => {
    const n = parseFloat(m.replace(',', '.')), r = n * mul;
    return Number.isInteger(r) ? String(r) : String(Math.round(r*10)/10).replace('.', ',');
  });
  let out = md; map.forEach((v, k) => { out = out.split(k).join(v); }); return out;
};

// ─── API ───────────────────────────────────────────────────────────
const authApi = {
  signIn: async (email: string, pw: string) => {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pw })
    });
    const j = await r.json();
    return r.ok ? { session: j as Session, error: null } : { session: null, error: j.error_description || 'Credenziali non valide' };
  },
  signOut: async (token: string) => fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: 'POST', headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` } }),
  getUser: async (token: string) => { const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` } }); return r.ok ? r.json() : null; },
  updateProfile: async (token: string, data: { display_name?: string; password?: string }) => {
    const body: Record<string, unknown> = {};
    if (data.display_name !== undefined) body.data = { display_name: data.display_name };
    if (data.password) body.password = data.password;
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { method: 'PUT', headers: makeHdr(token), body: JSON.stringify(body) });
    if (!r.ok) { const j = await r.json(); throw new Error(j.msg || 'Errore aggiornamento'); }
    return r.json() as Promise<User>;
  }
};

const db = {
  recipes: {
    list: async (token?: string): Promise<Recipe[]> => (await fetch(`${SUPABASE_URL}/rest/v1/recipes?order=created_at.desc`, { headers: makeHdr(token) })).json(),
    insert: async (data: Partial<Recipe>, token: string): Promise<Recipe> => { const r = await fetch(`${SUPABASE_URL}/rest/v1/recipes`, { method: 'POST', headers: makeHdr(token), body: JSON.stringify(data) }); const j = await r.json(); return Array.isArray(j) ? j[0] : j; },
    update: async (id: string, data: Partial<Recipe>, token: string): Promise<Recipe> => { const r = await fetch(`${SUPABASE_URL}/rest/v1/recipes?id=eq.${id}`, { method: 'PATCH', headers: makeHdr(token), body: JSON.stringify(data) }); const j = await r.json(); return Array.isArray(j) ? j[0] : j; },
    updateAuthor: async (oldName: string, newName: string, token: string) => fetch(`${SUPABASE_URL}/rest/v1/recipes?author=eq.${encodeURIComponent(oldName)}`, { method: 'PATCH', headers: makeHdr(token), body: JSON.stringify({ author: newName }) }),
    delete: async (id: string, token: string) => fetch(`${SUPABASE_URL}/rest/v1/recipes?id=eq.${id}`, { method: 'DELETE', headers: makeHdr(token) }),
  },
  users: {
    list: async (token: string): Promise<AppUser[]> => (await fetch(`${SUPABASE_URL}/rest/v1/app_users?order=created_at.asc`, { headers: makeHdr(token) })).json(),
    getOne: async (userId: string, token: string): Promise<AppUser | null> => { const r = await fetch(`${SUPABASE_URL}/rest/v1/app_users?id=eq.${userId}&select=is_admin,display_name`, { headers: makeHdr(token) }); const j = await r.json(); return j[0] || null; },
    setAdmin: async (userId: string, isAdmin: boolean, token: string) => fetch(`${SUPABASE_URL}/rest/v1/app_users?id=eq.${userId}`, { method: 'PATCH', headers: makeHdr(token), body: JSON.stringify({ is_admin: isAdmin }) }),
    updateDisplayName: async (userId: string, name: string, token: string) => fetch(`${SUPABASE_URL}/rest/v1/app_users?id=eq.${userId}`, { method: 'PATCH', headers: makeHdr(token), body: JSON.stringify({ display_name: name }) }),
    delete: async (userId: string, token: string) => fetch(`${SUPABASE_URL}/rest/v1/rpc/delete_auth_user`, { method: 'POST', headers: makeHdr(token), body: JSON.stringify({ target_user_id: userId }) }),
  },
  requests: {
    list: async (token: string): Promise<AccountRequest[]> => 
      (await fetch(`${SUPABASE_URL}/rest/v1/account_requests?order=created_at.desc`, { headers: makeHdr(token) })).json(),
    
    insert: async (data: { email: string; display_name: string; message: string }) => 
      fetch(`${SUPABASE_URL}/rest/v1/account_requests`, { 
        method: 'POST', 
        headers: { 
          'apikey': SUPABASE_ANON_KEY, 
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'   // ← cambiato da return=representation
        }, 
        body: JSON.stringify(data) 
      }),
    
    setStatus: async (id: string, status: string, token: string) => 
      fetch(`${SUPABASE_URL}/rest/v1/account_requests?id=eq.${id}`, { method: 'PATCH', headers: makeHdr(token), body: JSON.stringify({ status }) }),
  }
};

const uploadPhoto = async (file: File, token: string): Promise<string> => {
  const blob = await compressImage(file);
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/recipe-photos/${name}`, { method: 'POST', headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}`, 'Content-Type': 'image/jpeg' }, body: blob });
  if (!res.ok) throw new Error('Upload fallito');
  return `${SUPABASE_URL}/storage/v1/object/public/recipe-photos/${name}`;
};

const emptyForm = (author: string): FormState => ({ id: null, title: '', creation_time: '', date: '', type: '', weight: '', servings: 1, ingredients: '', procedure: '', photo_url: '', notes: '', cost: '', author });

// ─── COMPONENTI ────────────────────────────────────────────────────
function IngLine({ raw, c }: { raw: string; c: Record<string, string> }) {
  const t = raw.trim(); if (!t) return <div style={{ height: 8 }} />;
  if (!/^[-–\d]/.test(t)) return <div style={{ fontWeight: 700, fontSize: 14, color: c.text, marginTop: 12, marginBottom: 2 }}>{t}</div>;
  return <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}><span style={{ color: c.accentMid, flexShrink: 0, fontWeight: 700 }}>–</span><span style={{ fontSize: 15, lineHeight: 1.9 }}>{t.replace(/^[-–]\s*/, '')}</span></div>;
}

function StepsEditor({ steps, onChange, inp, c }: { steps: string[]; onChange: (s: string[]) => void; inp: CSSProperties; c: Record<string, string> }) {
  const refs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const resize = (el: HTMLTextAreaElement | null) => { if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
  return (
    <div>
      {steps.map((step, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 26, height: 26, borderRadius: '50%', background: c.accentLight, color: c.accent, fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 9, flexShrink: 0, fontFamily: "'Cormorant Garamond',serif" }}>{i + 1}</div>
          <textarea ref={el => { refs.current[i] = el; if (el) resize(el); }} value={step}
            placeholder={i === 0 ? "Primo passo... (Invio = nuovo passo, Shift+Invio = a capo)" : "Passo successivo..."}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => { const s = [...steps]; s[i] = e.target.value; onChange(s); resize(e.target); }}
            onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); const el = refs.current[i]!; const pos = el.selectionStart ?? steps[i].length;
                const s = [...steps]; s[i] = steps[i].slice(0, pos); s.splice(i + 1, 0, steps[i].slice(pos));
                onChange(s); setTimeout(() => refs.current[i + 1]?.focus(), 0);
              } else if (e.key === 'Backspace' && !steps[i] && steps.length > 1) {
                e.preventDefault(); onChange(steps.filter((_, j) => j !== i)); setTimeout(() => refs.current[i - 1]?.focus(), 0);
              }
            }} rows={1}
            style={{ ...inp, flex: 1, minHeight: 42, lineHeight: 1.8, resize: 'none', overflow: 'hidden' }} />
          {steps.length > 1 && <button onClick={() => { const s = steps.filter((_, j) => j !== i); onChange(s.length ? s : ['']); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, fontSize: 18, marginTop: 5, padding: '0 2px' }}>×</button>}
        </div>
      ))}
      <button onClick={() => { onChange([...steps, '']); setTimeout(() => refs.current[steps.length]?.focus(), 0); }}
        style={{ background: 'none', border: `1.5px dashed ${c.border}`, borderRadius: 8, padding: '6px 14px', color: c.muted, fontSize: 13, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", fontWeight: 600 }}>+ Aggiungi passo</button>
    </div>
  );
}

function AcInput({ value, onChange, opts, placeholder, style, field }: { value: string; onChange: (v: string) => void; opts: string[]; placeholder: string; style: CSSProperties; field?: string }) {
  const [open, setOpen] = useState(false);
  const filtered = opts.filter(s => s.toLowerCase().includes(value.toLowerCase()) && s.toLowerCase() !== value.toLowerCase());
  return (
    <div style={{ position: 'relative' }}>
      <input style={style} placeholder={placeholder} value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 180)} />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300, background: '#fff', border: '1.5px solid #F2E4D0', borderTop: 'none', borderRadius: '0 0 8px 8px', boxShadow: '0 8px 20px rgba(100,70,30,0.08)' }}>
          {filtered.map(s => <div key={s} onMouseDown={() => { onChange(s); setOpen(false); }}
            style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13, color: '#8A7A65', textTransform: field === 'type' ? 'capitalize' : 'none' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#F2E4D0')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>{s}</div>)}
        </div>
      )}
    </div>
  );
}

function TypeInput({ value, onChange, types, isAdmin, style }: { value: string; onChange: (v: string) => void; types: string[]; isAdmin: boolean; style: CSSProperties }) {
  if (!isAdmin) return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ ...style, cursor: 'pointer' }}>
      <option value="">Seleziona tipologia...</option>
      {types.map(t => <option key={t} value={t}>{t}</option>)}
    </select>
  );
  return <AcInput value={value} onChange={onChange} opts={types} placeholder="Es. Dolce, Salato... (admin: puoi aggiungerne)" style={style} field="type" />;
}

function SideMenu({ open, onClose, session, isGuest, isAdmin, onLogout, onProfile, onAdminPanel, onRequestForm, c, A }: {
  open: boolean; onClose: () => void; session: Session | null; isGuest: boolean; isAdmin: boolean;
  onLogout: () => void; onProfile: () => void; onAdminPanel: () => void; onRequestForm: () => void;
  c: Record<string, string>; A: Record<string, CSSProperties>;
}) {
  const adminEmail = 'toffolettonicolo@yahoo.it';
  return (
    <>
      {open && <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(44,32,16,0.35)', zIndex: 300, backdropFilter: 'blur(2px)' }} />}
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 320, maxWidth: '90vw', background: c.card, zIndex: 400, boxShadow: '-8px 0 40px rgba(100,70,30,0.15)', transform: open ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.3s cubic-bezier(.4,0,.2,1)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${c.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, color: c.accent }}>👨‍🍳 Chef's Book</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: c.muted }}>×</button>
        </div>

        <div style={{ padding: '16px 20px', flex: 1 }}>
          {/* Utente corrente */}
          <div style={{ background: c.accentLight, borderRadius: 10, padding: '12px 14px', marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.muted, letterSpacing: '.08em', textTransform: 'uppercase' as const, marginBottom: 4 }}>Accesso come</div>
            <div style={{ fontWeight: 700, color: c.text, fontSize: 14 }}>
              {isGuest ? '👤 Ospite' : `👨‍🍳 ${session ? dispName(session) : ''}`}
            </div>
            {isAdmin && <div style={{ marginTop: 4, background: c.accent, color: '#FFF8F0', fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '2px 7px', display: 'inline-block' }}>ADMIN</div>}
            {isGuest && <div style={{ marginTop: 4, fontSize: 11, color: c.muted }}>Solo visualizzazione</div>}
          </div>

          {/* Links */}
          {!isGuest && session && (
            <button onClick={() => { onClose(); onProfile(); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0', borderBottom: `1px solid ${c.border}`, marginBottom: 4, fontFamily: "'Nunito',sans-serif", fontSize: 14, color: c.text, fontWeight: 600 }}>
              ⚙️ Il mio profilo
            </button>
          )}
          {isAdmin && (
            <button onClick={() => { onClose(); onAdminPanel(); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0', borderBottom: `1px solid ${c.border}`, marginBottom: 4, fontFamily: "'Nunito',sans-serif", fontSize: 14, color: c.accent, fontWeight: 700 }}>
              🛡️ Pannello Admin
            </button>
          )}
          <button onClick={() => { onClose(); onRequestForm(); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0', borderBottom: `1px solid ${c.border}`, marginBottom: 20, fontFamily: "'Nunito',sans-serif", fontSize: 14, color: c.text, fontWeight: 600 }}>
            ✉️ Richiedi account
          </button>

          {/* Info */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 15, fontWeight: 700, color: c.accent, marginBottom: 8 }}>📖 Cos'è Chef's Book?</div>
            <div style={{ fontSize: 12, color: c.muted, lineHeight: 1.7 }}>Il ricettario digitale condiviso della cucina. Permette di raccogliere, organizzare e consultare le ricette, con il calcolatore automatico degli ingredienti per porzioni o peso diversi.</div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 15, fontWeight: 700, color: c.accent, marginBottom: 8 }}>🔐 Livelli di accesso</div>
            {[
              { badge: 'OSPITE', bg: '#F0EDE8', col: c.muted, desc: 'Consulta ricette, usa il calcolatore porzioni' },
              { badge: 'MEMBRO', bg: '#F2E4D0', col: c.accentMid, desc: 'Aggiunge e modifica le proprie ricette' },
              { badge: 'ADMIN', bg: c.accent, col: '#FFF8F0', desc: 'Accesso completo, gestione utenti' },
            ].map(r => (
              <div key={r.badge} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
                <span style={{ background: r.bg, color: r.col, fontSize: 9, fontWeight: 700, borderRadius: 4, padding: '3px 6px', whiteSpace: 'nowrap' as const, marginTop: 1 }}>{r.badge}</span>
                <span style={{ fontSize: 12, color: c.muted, lineHeight: 1.6 }}>{r.desc}</span>
              </div>
            ))}
          </div>

          {(isGuest || !session) && (
            <div style={{ background: '#FFFBF0', border: `1px solid #EDD080`, borderRadius: 10, padding: '14px', marginBottom: 20 }}>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 14, fontWeight: 700, color: c.accentMid, marginBottom: 6 }}>Vuoi contribuire?</div>
              <div style={{ fontSize: 12, color: c.muted, lineHeight: 1.6, marginBottom: 10 }}>Per aggiungere ricette hai bisogno di un account. Clicca qui sotto per inviare una richiesta.</div>
              <button onClick={() => { onClose(); onRequestForm(); }} style={{ ...A.btn, width: '100%', background: c.accentMid, textAlign: 'center' as const, justifyContent: 'center', display: 'flex', fontSize: 13 }}>Invia richiesta →</button>
            </div>
          )}

          <div style={{ fontSize: 11, color: c.muted, textAlign: 'center' as const }}>Chef's Book · Ricettario professionale</div>
        </div>

        <div style={{ padding: '14px 20px', borderTop: `1px solid ${c.border}` }}>
          {!isGuest && session ? (
            <button onClick={onLogout} style={{ ...A.btnO, width: '100%', textAlign: 'center' as const, justifyContent: 'center', display: 'flex' }}>Esci dall'account</button>
          ) : (
            <button onClick={() => { onClose(); onLogout(); }} style={{ ...A.btn, width: '100%', textAlign: 'center' as const, justifyContent: 'center', display: 'flex', background: c.accentMid }}>Accedi con il tuo account</button>
          )}
        </div>
      </div>
    </>
  );
}

// ─── APP PRINCIPALE ────────────────────────────────────────────────
export default function ChefBook() {
  const [view, setView] = useState('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [filter, setFilter] = useState('tutti');
  const [current, setCurrent] = useState<Recipe | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm(''));
  const [steps, setSteps] = useState<string[]>(['']);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [curServings, setCurServings] = useState(1);
  const [curWeight, setCurWeight] = useState('');
  // Login
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [showPw, setShowPw] = useState(false); const [loginLoading, setLoginLoading] = useState(false);
  // Profile
  const [profName, setProfName] = useState(''); const [profNewPw, setProfNewPw] = useState(''); const [profConfPw, setProfConfPw] = useState(''); const [profMsg, setProfMsg] = useState(''); const [profLoading, setProfLoading] = useState(false);
  // Admin
  const [appUsers, setAppUsers] = useState<AppUser[]>([]); const [adminTab, setAdminTab] = useState<'users' | 'requests'>('users');
  const [requests, setRequests] = useState<AccountRequest[]>([]); const [adminLoading, setAdminLoading] = useState(false);
  // Request form
  const [reqEmail, setReqEmail] = useState(''); const [reqName, setReqName] = useState(''); const [reqMsg, setReqMsg] = useState(''); const [reqSent, setReqSent] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const types = Array.from(new Set(recipes.map(r => r.type).filter(Boolean)));
  const authors = Array.from(new Set(recipes.map(r => r.author).filter(Boolean)));
  const tok = () => session?.access_token;
  const userName = session ? dispName(session) : isGuest ? 'Ospite' : '';

  const loadRecipes = async (token?: string, quiet = false) => {
    if (!quiet) setSyncing(true);
    try { const r = await db.recipes.list(token); if (Array.isArray(r)) setRecipes(r); else setError('Errore connessione.'); }
    catch { setError('Errore connessione Supabase.'); }
    setSyncing(false);
  };

  useEffect(() => {
    (async () => {
      const stored = localStorage.getItem('cb-session');
      if (stored) {
        try {
          const s = JSON.parse(stored) as Session;
          const u = await authApi.getUser(s.access_token);
          if (u) {
            const info = await db.users.getOne(s.user.id, s.access_token);
            setSession(s); setIsAdminUser(info?.is_admin || false);
            await loadRecipes(s.access_token); setView('home'); return;
          }
        } catch {} localStorage.removeItem('cb-session');
      }
      setView('login');
    })();
  }, []);

  const handleLogin = async () => {
    if (!email.trim() || !pw.trim()) return;
    setLoginLoading(true); setError('');
    const { session: s, error: err } = await authApi.signIn(email.trim(), pw);
    if (err || !s) { setError(err || 'Errore'); setLoginLoading(false); return; }
    const info = await db.users.getOne(s.user.id, s.access_token);
    localStorage.setItem('cb-session', JSON.stringify(s));
    setSession(s); setIsGuest(false); setIsAdminUser(info?.is_admin || false);
    await loadRecipes(s.access_token); setLoginLoading(false); setView('home');
  };

  const handleGuest = async () => { setIsGuest(true); setSession(null); localStorage.removeItem('cb-session'); await loadRecipes(); setView('home'); };

  const handleLogout = async () => {
    if (session) await authApi.signOut(session.access_token);
    localStorage.removeItem('cb-session'); setSession(null); setIsGuest(false); setIsAdminUser(false); setRecipes([]); setMenuOpen(false); setView('login');
  };

  const goAdmin = async () => {
    setAdminLoading(true);
    try { const [u, r] = await Promise.all([db.users.list(tok()!), db.requests.list(tok()!)]); setAppUsers(Array.isArray(u) ? u : []); setRequests(Array.isArray(r) ? r : []); }
    catch {} setAdminLoading(false); setView('admin');
  };

  const goProfile = () => { setProfName(userName); setProfNewPw(''); setProfConfPw(''); setProfMsg(''); setView('profile'); };

  const saveProfile = async () => {
    if (!session) return; setProfLoading(true); setProfMsg('');
    try {
      const oldName = userName;
      if (profName.trim() && profName !== oldName) {
        await authApi.updateProfile(tok()!, { display_name: profName.trim() });
        await db.users.updateDisplayName(session.user.id, profName.trim(), tok()!);
        await db.recipes.updateAuthor(oldName, profName.trim(), tok()!);
        const newSess = { ...session, user: { ...session.user, user_metadata: { ...session.user.user_metadata, display_name: profName.trim() } } };
        setSession(newSess); localStorage.setItem('cb-session', JSON.stringify(newSess));
        setRecipes(prev => prev.map(r => r.author === oldName ? { ...r, author: profName.trim() } : r));
      }
      if (profNewPw) {
        if (profNewPw !== profConfPw) { setProfMsg('Le password non coincidono'); setProfLoading(false); return; }
        if (profNewPw.length < 6) { setProfMsg('Password troppo corta (min 6 caratteri)'); setProfLoading(false); return; }
        await authApi.updateProfile(tok()!, { password: profNewPw });
      }
      setProfMsg('✓ Profilo aggiornato con successo'); setProfNewPw(''); setProfConfPw('');
    } catch (e: unknown) { setProfMsg(`Errore: ${e instanceof Error ? e.message : 'sconosciuto'}`); }
    setProfLoading(false);
  };

  const newRecipe = () => { setForm(emptyForm(userName)); setSteps(['']); setPhotoPreview(null); setCurrent(null); setView('form'); };
  const editRecipe = (r: Recipe) => { setForm({ ...r, date: r.date || '' }); setSteps(dbToSteps(r.procedure)); setPhotoPreview(r.photo_url || null); setView('form'); };
  const duplicateRecipe = (r: Recipe) => { setForm({ ...r, id: null, date: r.date || '', title: `${r.title} (copia)`, author: userName }); setSteps(dbToSteps(r.procedure)); setPhotoPreview(r.photo_url || null); setCurrent(null); setView('form'); };
  const openDetail = (r: Recipe) => { setCurrent(r); setCurServings(r.servings || 1); setCurWeight(r.weight || ''); setView('detail'); };
  const canEdit = (r: Recipe) => !isGuest && session && (isAdminUser || r.author === userName);

  const handlePhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true); setError('');
    try { const url = await uploadPhoto(file, tok()!); sf('photo_url', url); setPhotoPreview(url); }
    catch { setError('Errore caricamento foto.'); } setUploading(false);
  };

  const validateForm = (): string | null => {
    if (!form.title.trim()) return 'Il titolo è obbligatorio';
    if (!form.type.trim()) return 'La tipologia è obbligatoria';
    if (!isAdminUser && form.type && !types.includes(form.type)) return 'Seleziona una tipologia esistente';
    if (!form.weight) return 'Il peso è obbligatorio';
    const wNum = parseFloat(form.weight.replace(',', '.'));
    if (isNaN(wNum) || wNum <= 0) return 'Inserisci un peso valido (es. 0.750)';
    if (form.ingredients.split('\n').filter(l => l.trim()).length < 3) return 'Inserisci almeno 3 righe di ingredienti';
    if (!steps.some(s => s.trim())) return 'Inserisci almeno un passo nel procedimento';
    return null;
  };

  const handleSave = async () => {
    const validErr = validateForm(); if (validErr) { setError(validErr); return; }
    setSaving(true); setError('');
    try {
      const weightVal = parseFloat(form.weight.replace(',', '.'));
      const weightStr = `${weightVal} kg`;
      const data: Partial<Recipe> = {
        title: form.title, creation_time: form.creation_time, date: form.date || null,
        type: form.type, weight: weightStr, servings: form.servings || 1,
        ingredients: form.ingredients, procedure: stepsToDb(steps),
        photo_url: form.photo_url, notes: form.notes, cost: form.cost,
        author: form.author || userName
      };
      if (form.id) {
        await db.recipes.update(form.id, data, tok()!);
        const updated = { ...form, ...data, id: form.id } as Recipe;
        setRecipes(prev => prev.map(r => r.id === form.id ? updated : r));
        setCurrent(updated); setCurServings(data.servings ?? 1); setCurWeight(data.weight || '');
      } else {
        const saved = await db.recipes.insert(data, tok()!);
        setRecipes(prev => [saved, ...prev]); setCurrent(saved);
        setCurServings(saved.servings || 1); setCurWeight(saved.weight || '');
      }
      setView('detail');
    } catch { setError('Errore salvataggio.'); } setSaving(false);
  };

  const handleDelete = async (id: string) => { await db.recipes.delete(id, tok()!); setRecipes(prev => prev.filter(r => r.id !== id)); setView('home'); };

  const sf = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(p => ({ ...p, [k]: v }));

  const filtered = recipes.filter(r => filter === 'tutti' || r.type === filter)
    .filter(r => !search || r.title.toLowerCase().includes(search.toLowerCase()) || (r.author || '').toLowerCase().includes(search.toLowerCase()));

  // ─── PALETTE ────────────────────────────────────────────────────
  const c: Record<string, string> = { bg: '#F7F3EE', card: '#FFFFFF', accent: '#A8621A', accentLight: '#F2E4D0', accentMid: '#C4862A', text: '#2C2010', muted: '#8A7A65', border: '#E2D9CC', input: '#FDFAF6', red: '#C0392B', redLight: '#FDECEA', shadow: 'rgba(100,70,30,0.08)' };
  const A: Record<string, CSSProperties> = {
    wrap: { fontFamily: "'Nunito',sans-serif", background: c.bg, minHeight: '100vh', color: c.text },
    hdr: { background: c.card, borderBottom: `1px solid ${c.border}`, padding: '0 16px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100, gap: 8, boxShadow: `0 2px 12px ${c.shadow}` },
    logo: { fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, color: c.accent, letterSpacing: '.03em', whiteSpace: 'nowrap' },
    btn: { background: c.accent, color: '#FFF8F0', border: 'none', borderRadius: 8, padding: '9px 16px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: `0 2px 8px ${c.accent}40` },
    btnO: { background: 'transparent', color: c.muted, border: `1.5px solid ${c.border}`, borderRadius: 8, padding: '8px 14px', fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' },
    btnR: { background: c.redLight, color: c.red, border: `1.5px solid #F5C6C2`, borderRadius: 8, padding: '8px 14px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: 13, cursor: 'pointer' },
    inp: { background: c.input, color: c.text, border: `1.5px solid ${c.border}`, borderRadius: 8, padding: '10px 14px', fontSize: 14, width: '100%', fontFamily: "'Nunito',sans-serif", textAlign: 'left' as const },
    lbl: { fontSize: 11, fontWeight: 700, color: c.muted, letterSpacing: '.1em', textTransform: 'uppercase' as const, display: 'block', marginBottom: 6 },
    fld: { marginBottom: 18 },
    sec: { fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, color: c.accent, marginBottom: 14, paddingBottom: 10, borderBottom: `2px solid ${c.accentLight}` },
    tag: { background: c.accentLight, color: c.accent, borderRadius: 20, padding: '3px 12px', fontSize: 11, fontWeight: 700, textTransform: 'capitalize' as const },
    box: { background: c.card, borderRadius: 14, border: `1px solid ${c.border}`, boxShadow: `0 2px 12px ${c.shadow}` },
    err: { background: c.redLight, border: `1px solid #F5C6C2`, borderRadius: 8, padding: '10px 14px', color: c.red, fontSize: 13, marginBottom: 14 }
  };

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Nunito:wght@300;400;500;600;700&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}body{background:#F7F3EE}
    ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:#F7F3EE}::-webkit-scrollbar-thumb{background:#D9CFBF;border-radius:3px}
    input,textarea,select{outline:none;font-family:'Nunito',sans-serif;text-align:left}
    input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
    input[type=number]{-moz-appearance:textfield}
    .hcard{transition:transform .25s,box-shadow .25s!important}
    .hcard:hover{transform:translateY(-4px)!important;box-shadow:0 12px 32px rgba(100,70,30,0.13)!important}
    .hbtn:hover{opacity:.82}
    @keyframes spin{to{transform:rotate(360deg)}}.spin{animation:spin 1s linear infinite;display:inline-block}
    .dsk{display:flex!important}.mob{display:none!important}.mob-row{display:none!important}
    @media(max-width:640px){
      .dsk{display:none!important}.mob{display:flex!important}.mob-row{display:flex!important;align-items:center;gap:8px;padding:10px 14px;background:#fff;border-bottom:1px solid #E2D9CC}
      .g2{grid-template-columns:1fr!important}.rgrid{grid-template-columns:1fr 1fr!important}
      .dacts{flex-wrap:wrap;gap:6px!important}.dacts button{padding:7px 10px!important;font-size:12px!important}
      .mstrip{flex-direction:column!important}.mstrip>div{border-right:none!important;border-bottom:1px solid #E2D9CC}.mstrip>div:last-child{border-bottom:none!important}
      .swrow{flex-wrap:wrap;gap:10px!important}
    }
    @media(max-width:400px){.rgrid{grid-template-columns:1fr!important}}
  `;

  const MBtn = () => <button className="hbtn" onClick={() => setMenuOpen(true)} style={{ ...A.btnO, padding: '8px 12px', fontSize: 17 }}>☰</button>;

  // ─── LOADING ─────────────────────────────────────────────────────
  if (view === 'loading') return <div style={{ ...A.wrap, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}><style>{css}</style><div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 40, color: c.accent }}>👨‍🍳 Chef's Book</div><div style={{ color: c.muted, fontSize: 13 }}><span className="spin">⟳</span> Connessione...</div></div>;

  // ─── LOGIN ───────────────────────────────────────────────────────
  if (view === 'login') return (
    <div style={{ ...A.wrap, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'linear-gradient(135deg,#F7F3EE,#EDE3D6)', minHeight: '100vh' }}>
      <style>{css}</style>
      <div style={{ ...A.box, padding: '44px 32px', maxWidth: 420, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 52, marginBottom: 14 }}>👨‍🍳</div>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 40, fontWeight: 700, color: c.accent, marginBottom: 6 }}>Chef's Book</div>
        <div style={{ color: c.muted, marginBottom: 28, fontSize: 14, lineHeight: 1.7 }}>Il ricettario collaborativo<br />della tua cucina</div>
        {error && <div style={A.err}>{error}</div>}
        <div style={{ ...A.fld, textAlign: 'left' }}><label style={A.lbl}>Email</label>
          <input style={A.inp} type="email" placeholder="Es. marco@cucina.it" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} autoFocus />
        </div>
        <div style={{ ...A.fld, textAlign: 'left' }}><label style={A.lbl}>Password</label>
          <div style={{ position: 'relative' }}>
            <input style={{ ...A.inp, paddingRight: 44 }} type={showPw ? 'text' : 'password'} placeholder="••••••••" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            <button onClick={() => setShowPw(v => !v)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: c.muted }} tabIndex={-1}>{showPw ? '🙈' : '👁️'}</button>
          </div>
        </div>
        <button className="hbtn" style={{ ...A.btn, width: '100%', padding: '13px', fontSize: 15, opacity: loginLoading ? 0.6 : 1 }} onClick={handleLogin} disabled={loginLoading}>
          {loginLoading ? <span><span className="spin">⟳</span> Accesso...</span> : 'Accedi →'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
          <div style={{ flex: 1, height: 1, background: c.border }} /><span style={{ fontSize: 12, color: c.muted }}>oppure</span><div style={{ flex: 1, height: 1, background: c.border }} />
        </div>
        <button className="hbtn" style={{ ...A.btnO, width: '100%', padding: '12px', fontSize: 14 }} onClick={handleGuest}>Entra come ospite 👁️</button>
        <div style={{ color: c.muted, fontSize: 11, marginTop: 16, lineHeight: 1.7 }}>Gli ospiti possono consultare le ricette ma non modificarle.</div>
      </div>
    </div>
  );

  // ─── HOME ────────────────────────────────────────────────────────
  if (view === 'home') return (
    <div style={A.wrap}>
      <style>{css}</style>
      <SideMenu open={menuOpen} onClose={() => setMenuOpen(false)} session={session} isGuest={isGuest} isAdmin={isAdminUser} onLogout={handleLogout} onProfile={goProfile} onAdminPanel={goAdmin} onRequestForm={() => { setReqSent(false); setReqEmail(''); setReqName(''); setReqMsg(''); setView('request_form'); }} c={c} A={A} />
      <div style={A.hdr}>
        <div style={A.logo}>👨‍🍳 Chef's Book</div>
        {/* Desktop */}
        <div className="dsk" style={{ alignItems: 'center', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
          <input style={{ ...A.inp, maxWidth: 200, padding: '7px 12px', fontSize: 13 }} placeholder="🔍 Cerca ricetta..." value={search} onChange={e => setSearch(e.target.value)} />
          <button className="hbtn" style={{ ...A.btnO, padding: '7px 11px', fontSize: 16 }} onClick={() => loadRecipes(tok())}>{syncing ? <span className="spin">⟳</span> : '⟳'}</button>
          <span style={{ color: c.muted, fontSize: 12, whiteSpace: 'nowrap' }}>👤 <strong style={{ color: c.text }}>{userName}</strong>{isAdminUser && <span style={{ background: c.accent, color: '#FFF', fontSize: 9, fontWeight: 700, borderRadius: 3, padding: '1px 5px', marginLeft: 4 }}>ADMIN</span>}</span>
          {!isGuest && <button className="hbtn" style={A.btn} onClick={newRecipe}>+ Nuova ricetta</button>}
        </div>
        {/* Mobile */}
        <div className="mob" style={{ alignItems: 'center', gap: 8 }}>
          {!isGuest && <button className="hbtn" style={A.btn} onClick={newRecipe}>+ Nuova</button>}
        </div>
        {/* Menu sempre visibile */}
        <MBtn />
      </div>
      {/* Mobile search row */}
      <div className="mob-row">
        <input style={{ ...A.inp, fontSize: 14 }} placeholder="🔍 Cerca ricetta o autore..." value={search} onChange={e => setSearch(e.target.value)} />
        <button className="hbtn" style={{ ...A.btnO, padding: '9px 11px', fontSize: 16, flexShrink: 0 }} onClick={() => loadRecipes(tok())}>{syncing ? <span className="spin">⟳</span> : '⟳'}</button>
      </div>
      {isGuest && <div style={{ background: '#FFFBF0', borderBottom: `1px solid #EDD080`, padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: c.accentMid }}>👁️ Modalità ospite — solo visualizzazione</span>
        <button onClick={() => { setReqSent(false); setView('request_form'); }} style={{ ...A.btnO, fontSize: 11, padding: '4px 10px', borderColor: c.accentMid, color: c.accentMid }}>Richiedi accesso</button>
      </div>}
      {/* Tabs */}
      <div style={{ background: c.card, borderBottom: `1px solid ${c.border}`, padding: '0 14px', display: 'flex', overflowX: 'auto' }}>
        {['tutti', ...types].map(t => (
          <button key={t} onClick={() => setFilter(t)} style={{ background: 'transparent', color: filter === t ? c.accent : c.muted, border: 'none', borderBottom: filter === t ? `2.5px solid ${c.accent}` : '2.5px solid transparent', padding: '13px 14px 11px', fontSize: 13, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", fontWeight: filter === t ? 700 : 500, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{t === 'tutti' ? '📚 Tutte' : t}</button>
        ))}
      </div>
      <div style={{ padding: '10px 16px 4px', color: c.muted, fontSize: 12, fontWeight: 600 }}>{filtered.length} ricett{filtered.length === 1 ? 'a' : 'e'}{filter !== 'tutti' ? ` · ${filter}` : ''}</div>
      {error && <div style={{ ...A.err, margin: '4px 16px 8px' }}>{error}</div>}
      {filtered.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '70px 24px', gap: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 56 }}>📖</div>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 26, color: c.muted }}>{search ? 'Nessun risultato' : 'Nessuna ricetta ancora'}</div>
          {!search && !isGuest && <button className="hbtn" style={{ ...A.btn, marginTop: 8 }} onClick={newRecipe}>+ Aggiungi ricetta</button>}
        </div>
      ) : (
        <div className="rgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 16, padding: 16 }}>
          {filtered.map(r => (
            <div key={r.id} className="hcard" style={{ background: c.card, borderRadius: 14, border: `1px solid ${c.border}`, overflow: 'hidden', cursor: 'pointer', boxShadow: `0 2px 10px ${c.shadow}` }} onClick={() => openDetail(r)}>
              {r.photo_url ? <img src={r.photo_url} alt={r.title} style={{ width: '100%', height: 148, objectFit: 'cover', display: 'block' }} />
                : <div style={{ width: '100%', height: 148, background: `linear-gradient(135deg,${c.accentLight},#EDD5B0)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontSize: 42 }}>🍽️</span></div>}
              <div style={{ padding: '12px 14px 14px' }}>
                {r.type && <div style={{ ...A.tag, display: 'inline-block', marginBottom: 7 }}>{r.type}</div>}
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 18, fontWeight: 700, lineHeight: 1.3, marginBottom: 7 }}>{r.title}</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', color: c.muted, fontSize: 12 }}>
                  {r.creation_time && <span>⏱ {r.creation_time}</span>}
                  {r.weight && <span>⚖️ {r.weight}</span>}
                  {r.cost && <span>💰 {r.cost}</span>}
                </div>
                <div style={{ color: c.muted, fontSize: 11, marginTop: 7, borderTop: `1px solid ${c.border}`, paddingTop: 7 }}>di <strong style={{ color: c.accentMid }}>{r.author}</strong></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ─── DETAIL ──────────────────────────────────────────────────────
  if (view === 'detail' && current) {
    const r = current; const baseS = r.servings || 1; const baseW = parseW(r.weight);
    let mul = curServings / baseS;
    if (baseW !== null) { const cw = parseW(curWeight); if (cw !== null && cw > 0) mul = (cw / baseW) * (curServings / baseS); }
    const mulIng = multiplyIng(r.ingredients, mul); const pSteps = dbToSteps(r.procedure);
    const wUnit = r.weight ? r.weight.replace(/[\d.,\s]/g, '').trim() : '';
    const modified = Math.abs(mul - 1) > 0.001;
    const ce = canEdit(r);
    return (
      <div style={A.wrap}>
        <style>{css}</style>
        <SideMenu open={menuOpen} onClose={() => setMenuOpen(false)} session={session} isGuest={isGuest} isAdmin={isAdminUser} onLogout={handleLogout} onProfile={goProfile} onAdminPanel={goAdmin} onRequestForm={() => { setReqSent(false); setView('request_form'); }} c={c} A={A} />
        <div style={A.hdr}>
          <button className="hbtn" style={A.btnO} onClick={() => setView('home')}>← Ricette</button>
          <div className="dacts" style={{ display: 'flex', gap: 8 }}>
            {ce && <><button className="hbtn" style={A.btnO} onClick={() => duplicateRecipe(r)}>⧉ Duplica</button><button className="hbtn" style={A.btnO} onClick={() => editRecipe(r)}>✏️ Modifica</button><button className="hbtn" style={A.btnR} onClick={() => { if (window.confirm(`Eliminare "${r.title}"?`)) handleDelete(r.id); }}>🗑</button></>}
            {!ce && !isGuest && <span style={{ fontSize: 12, color: c.muted, display: 'flex', alignItems: 'center' }}>🔒 Sola lettura</span>}
            <MBtn />
          </div>
        </div>
        <div style={{ maxWidth: 780, margin: '0 auto', padding: '26px 16px 70px' }}>
          {r.photo_url && <img src={r.photo_url} alt={r.title} style={{ width: '100%', height: 270, objectFit: 'cover', borderRadius: 14, marginBottom: 22, display: 'block', boxShadow: `0 8px 32px ${c.shadow}` }} />}
          {r.type && <div style={{ ...A.tag, display: 'inline-block', marginBottom: 10 }}>{r.type}</div>}
          <h1 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 34, fontWeight: 700, lineHeight: 1.15, marginBottom: 18, color: c.text }}>{r.title}</h1>
          <div className="mstrip" style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 22, background: c.accentLight, borderRadius: 12, overflow: 'hidden', border: `1px solid ${c.border}` }}>
            {([r.creation_time ? { icon: '⏱', label: 'Tempo', value: r.creation_time } : null, r.weight ? { icon: '⚖️', label: 'Peso base', value: r.weight } : null, r.cost ? { icon: '💰', label: 'Costo', value: r.cost } : null, r.date ? { icon: '📅', label: 'Data', value: r.date } : null, { icon: '👨‍🍳', label: 'Autore', value: r.author, accent: true }] as (MetaItem | null)[]).filter((m): m is MetaItem => m !== null).map((m, i, arr) => (
              <div key={i} style={{ padding: '12px 18px', flex: '1 1 auto', borderRight: i < arr.length - 1 ? `1px solid ${c.border}` : 'none', minWidth: 90 }}>
                <div style={A.lbl}>{m.label}</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: m.accent ? c.accent : c.text }}>{m.icon} {m.value}</div>
              </div>
            ))}
          </div>
          {r.ingredients && (
            <div style={{ ...A.box, padding: '20px 22px', marginBottom: 16 }}>
              <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: `2px solid ${c.accentLight}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, color: c.accent }}>Ingredienti</div>
                  {modified && <button onClick={() => { setCurServings(baseS); setCurWeight(r.weight || ''); }} style={{ background: 'none', border: 'none', color: c.muted, fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>↩ reset</button>}
                </div>
                <div className="swrow" style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: c.muted, letterSpacing: '.08em', textTransform: 'uppercase' as const }}>Porzioni</span>
                    <div style={{ display: 'flex', alignItems: 'center', border: `1.5px solid ${c.border}`, borderRadius: 8, overflow: 'hidden' }}>
                      <button onClick={() => setCurServings(s => Math.max(0.1, Math.round((s - 0.1) * 10) / 10))} style={{ background: c.bg, border: 'none', width: 30, height: 30, cursor: 'pointer', fontSize: 17, color: c.muted, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                      <input type="number" min="0.1" step="0.1" value={curServings} onChange={(e: ChangeEvent<HTMLInputElement>) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setCurServings(Math.round(v * 10) / 10); }} style={{ width: 46, height: 30, border: 'none', borderLeft: `1px solid ${c.border}`, borderRight: `1px solid ${c.border}`, background: 'transparent', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: 14, color: c.text, textAlign: 'center', padding: 0 }} />
                      <button onClick={() => setCurServings(s => Math.round((s + 0.1) * 10) / 10)} style={{ background: c.bg, border: 'none', width: 30, height: 30, cursor: 'pointer', fontSize: 17, color: c.accent, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                    </div>
                  </div>
                  {baseW !== null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: c.muted, letterSpacing: '.08em', textTransform: 'uppercase' as const }}>Peso</span>
                      <div style={{ display: 'flex', alignItems: 'center', border: `1.5px solid ${c.border}`, borderRadius: 8, overflow: 'hidden', background: c.input }}>
                        <input type="number" min="0.001" step="0.001" value={parseW(curWeight) ?? ''} onChange={(e: ChangeEvent<HTMLInputElement>) => { const n = e.target.value; setCurWeight(n ? `${n}${wUnit}` : ''); }} style={{ width: 75, height: 30, border: 'none', background: 'transparent', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: 14, color: c.text, textAlign: 'center', padding: '0 8px' }} />
                        {wUnit && <span style={{ paddingRight: 8, color: c.muted, fontSize: 13, fontWeight: 600 }}>{wUnit}</span>}
                      </div>
                    </div>
                  )}
                  {modified && <div style={{ background: c.accentLight, borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 700, color: c.accent }}>×{Math.round(mul * 100) / 100}</div>}
                </div>
              </div>

              <div style={{ textAlign: 'left' }}>{mulIng.split('\n').map((line, i) => <IngLine key={i} raw={line} c={c} />)}
              </div>
            </div>
          )}
          {pSteps.some(s => s.trim()) && (
            <div style={{ ...A.box, padding: '20px 22px', marginBottom: 16 }}>
              <div style={A.sec}>Procedimento</div>
              {pSteps.map((step, i) => step.trim() && (
                <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 16, textAlign: 'left' }}>
                  <div style={{ minWidth: 26, height: 26, borderRadius: '50%', background: c.accentLight, color: c.accent, fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 3, fontFamily: "'Cormorant Garamond',serif" }}>{i + 1}</div>
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.85, fontSize: 15, paddingTop: 2, flex: 1 }}>{step}</div>
                </div>
              ))}
            </div>
          )}
          {r.notes && <div style={{ background: '#FFFBF0', border: `1px solid #EDD080`, borderLeft: `4px solid ${c.accentMid}`, borderRadius: '0 12px 12px 0', padding: '16px 20px' }}>
            <div style={{ ...A.lbl, color: c.accentMid, marginBottom: 8 }}>📝 Note</div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.9, fontSize: 14, fontStyle: 'italic', textAlign: 'left' }}>{r.notes}</div>
          </div>}
        </div>
      </div>
    );
  }

  // ─── FORM ────────────────────────────────────────────────────────
  if (view === 'form') return (
    <div style={A.wrap}>
      <style>{css}</style>
      <div style={A.hdr}>
        <button className="hbtn" style={A.btnO} onClick={() => setView(current ? 'detail' : 'home')}>← Annulla</button>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, color: c.accent, fontWeight: 600 }}>{form.id ? 'Modifica ricetta' : 'Nuova ricetta'}</div>
        <button className="hbtn" style={{ ...A.btn, opacity: (!form.title || saving || uploading) ? 0.5 : 1 }} onClick={handleSave} disabled={!form.title || saving || uploading}>{saving ? '⏳ Salvo...' : '✓ Salva'}</button>
      </div>
      <div style={{ maxWidth: 780, margin: '0 auto', padding: '22px 16px 70px' }}>
        {error && <div style={A.err}>{error}</div>}
        <div style={{ ...A.box, padding: '20px 22px', marginBottom: 14 }}>
          <div style={A.sec}>Informazioni di base</div>
          <div style={A.fld}><label style={A.lbl}>Titolo ricetta *</label>
            <input style={{ ...A.inp, fontSize: 15, fontWeight: 600 }} placeholder="Es. Tiramisù classico" value={form.title} onChange={e => sf('title', e.target.value)} autoFocus />
          </div>
          <div className="g2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={A.fld}><label style={A.lbl}>Tempo preparazione</label>
              <input style={A.inp} placeholder="Es. 1h 30min" value={form.creation_time} onChange={e => sf('creation_time', e.target.value)} />
            </div>
            <div style={A.fld}><label style={A.lbl}>Data (facoltativa)</label>
              <input type="date" style={A.inp} value={form.date} onChange={e => sf('date', e.target.value)} />
            </div>
          </div>
          <div className="g2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={A.fld}><label style={A.lbl}>Tipologia *{!isAdminUser && types.length > 0 && <span style={{ color: c.muted, fontWeight: 400, fontSize: 10, textTransform: 'none', letterSpacing: 0 }}> (scegli tra le esistenti)</span>}</label>
              <TypeInput value={form.type} onChange={v => sf('type', v)} types={types} isAdmin={isAdminUser} style={A.inp} />
            </div>
            <div style={A.fld}><label style={A.lbl}>Peso * <span style={{ color: c.muted, fontWeight: 400, fontSize: 10, textTransform: 'none', letterSpacing: 0 }}>(in kg)</span></label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" min="0.001" step="0.001" placeholder="Es. 0.750" style={{ ...A.inp, flex: 1 }} value={parseW(form.weight) ?? ''} onChange={e => sf('weight', e.target.value)} />
                <span style={{ fontWeight: 700, color: c.muted, fontSize: 14, whiteSpace: 'nowrap' as const }}>kg</span>
              </div>
            </div>
          </div>
          <div className="g2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={A.fld}><label style={A.lbl}>Porzioni base</label>
              <div style={{ display: 'flex', alignItems: 'center', border: `1.5px solid ${c.border}`, borderRadius: 8, overflow: 'hidden', width: 'fit-content' }}>
                <button onClick={() => sf('servings', Math.max(1, (form.servings || 1) - 1))} style={{ background: c.bg, border: 'none', width: 38, height: 42, cursor: 'pointer', fontSize: 20, color: c.muted, fontWeight: 700 }}>−</button>
                <div style={{ width: 48, textAlign: 'center', fontWeight: 700, fontSize: 16, color: c.text, borderLeft: `1px solid ${c.border}`, borderRight: `1px solid ${c.border}`, lineHeight: '42px' }}>{form.servings || 1}</div>
                <button onClick={() => sf('servings', (form.servings || 1) + 1)} style={{ background: c.bg, border: 'none', width: 38, height: 42, cursor: 'pointer', fontSize: 20, color: c.accent, fontWeight: 700 }}>+</button>
              </div>
              <div style={{ color: c.muted, fontSize: 11, marginTop: 5 }}>Quantità ingredienti calibrate per questo numero</div>
            </div>
            <div style={A.fld}><label style={A.lbl}>Costo approssimativo</label>
              <input style={A.inp} placeholder="Es. ~€8" value={form.cost} onChange={e => sf('cost', e.target.value)} />
            </div>
          </div>
          <div style={A.fld}><label style={A.lbl}>Autore</label>
            <AcInput value={form.author || userName} onChange={v => sf('author', v)} opts={authors} placeholder="Es. Marco Rossi" style={A.inp} field="author" />
          </div>
        </div>
        <div style={{ ...A.box, padding: '20px 22px', marginBottom: 14 }}>
          <div style={A.sec}>Foto copertina</div>
          <input type="file" accept="image/*" ref={fileRef} style={{ display: 'none' }} onChange={handlePhoto} />
          {photoPreview ? (
            <div><img src={photoPreview} alt="cover" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <button className="hbtn" style={A.btnO} onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? '⏳ Caricamento...' : '🔄 Cambia'}</button>
                <button className="hbtn" style={A.btnR} onClick={() => { sf('photo_url', ''); setPhotoPreview(null); }}>× Rimuovi</button>
              </div>
            </div>
          ) : (
            <div style={{ border: `2px dashed ${c.border}`, borderRadius: 10, padding: '30px 20px', textAlign: 'center', cursor: 'pointer', background: c.bg }} onClick={() => !uploading && fileRef.current?.click()}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📷</div>
              <div style={{ color: c.muted, fontSize: 14, marginBottom: 4, fontWeight: 600 }}>{uploading ? '⏳ Caricamento...' : 'Clicca per aggiungere una foto'}</div>
              <div style={{ color: c.muted, fontSize: 11 }}>Ridimensionata automaticamente · Salvata su Supabase Storage</div>
            </div>
          )}
        </div>
        <div style={{ ...A.box, padding: '20px 22px', marginBottom: 14 }}>
          <div style={A.sec}>Ingredienti *</div>
          <div style={{ background: c.accentLight, borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: c.accent, lineHeight: 1.6 }}>
            💡 <strong>Riga con testo</strong> → titolo sezione &nbsp;·&nbsp; <strong>Riga con numero o "-"</strong> → elemento lista &nbsp;·&nbsp; Minimo 3 righe
          </div>
          <textarea style={{ ...A.inp, minHeight: 175, lineHeight: 2.1, fontWeight: 500 }}
            placeholder={"Primo impasto:\n250 g farina Manitoba\n85 g acqua tiepida\n\nSecondo impasto:\n200 g burro\n4 tuorli"}
            value={form.ingredients} onChange={e => sf('ingredients', e.target.value)} />
        </div>
        <div style={{ ...A.box, padding: '20px 22px', marginBottom: 14 }}>
          <div style={A.sec}>Procedimento * <span style={{ fontSize: 13, fontWeight: 400, color: c.muted }}>(almeno 1 passo)</span></div>
          <div style={{ color: c.muted, fontSize: 12, marginBottom: 12 }}><strong>Invio</strong> = nuovo passo &nbsp;·&nbsp; <strong>Shift+Invio</strong> = a capo nello stesso passo</div>
          <StepsEditor steps={steps} onChange={setSteps} inp={A.inp} c={c} />
        </div>
        <div style={{ ...A.box, padding: '20px 22px', marginBottom: 28 }}>
          <div style={A.sec}>Note</div>
          <textarea style={{ ...A.inp, minHeight: 95, lineHeight: 1.9, fontStyle: 'italic' }} placeholder="Consigli, varianti, trucchi, abbinamenti..." value={form.notes} onChange={e => sf('notes', e.target.value)} />
        </div>
        <button className="hbtn" style={{ ...A.btn, width: '100%', padding: '14px', fontSize: 15, opacity: (!form.title || saving || uploading) ? 0.5 : 1 }} onClick={handleSave} disabled={!form.title || saving || uploading}>{saving ? '⏳ Salvataggio...' : '✓ Salva ricetta'}</button>
      </div>
    </div>
  );

  // ─── PROFILO ─────────────────────────────────────────────────────
  if (view === 'profile' && session) return (
    <div style={A.wrap}>
      <style>{css}</style>
      <div style={A.hdr}>
        <button className="hbtn" style={A.btnO} onClick={() => setView('home')}>← Indietro</button>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, color: c.accent, fontWeight: 600 }}>Il mio profilo</div>
        <MBtn />
      </div>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '28px 16px 70px' }}>
        {profMsg && <div style={{ ...A.err, background: profMsg.startsWith('✓') ? '#F0FAF4' : c.redLight, border: `1px solid ${profMsg.startsWith('✓') ? '#A8D5B5' : '#F5C6C2'}`, color: profMsg.startsWith('✓') ? '#2E7D4F' : c.red }}>{profMsg}</div>}

        <div style={{ ...A.box, padding: '22px 24px', marginBottom: 16 }}>
          <div style={A.sec}>Informazioni account</div>
          <div style={A.fld}>
            <label style={A.lbl}>Email (non modificabile)</label>
            <input style={{ ...A.inp, color: c.muted, cursor: 'not-allowed' }} value={session.user.email} disabled />
          </div>
          <div style={A.fld}>
            <label style={A.lbl}>Nome visualizzato</label>
            <input style={A.inp} placeholder="Es. MarioR" value={profName} onChange={e => setProfName(e.target.value)} />
            <div style={{ color: c.muted, fontSize: 11, marginTop: 5 }}>Questo nome appare sulle ricette. Aggiornandolo, verranno aggiornate anche tutte le tue ricette.</div>
          </div>
        </div>

        <div style={{ ...A.box, padding: '22px 24px', marginBottom: 24 }}>
          <div style={A.sec}>Cambia password</div>
          <div style={A.fld}><label style={A.lbl}>Nuova password</label>
            <input style={A.inp} type="password" placeholder="Minimo 6 caratteri" value={profNewPw} onChange={e => setProfNewPw(e.target.value)} />
          </div>
          <div style={A.fld}><label style={A.lbl}>Conferma password</label>
            <input style={A.inp} type="password" placeholder="Ripeti la nuova password" value={profConfPw} onChange={e => setProfConfPw(e.target.value)} />
          </div>
          <div style={{ color: c.muted, fontSize: 12 }}>Lascia vuoto se non vuoi cambiare la password.</div>
        </div>

        <button className="hbtn" style={{ ...A.btn, width: '100%', padding: '14px', fontSize: 15, opacity: profLoading ? 0.6 : 1 }} onClick={saveProfile} disabled={profLoading}>
          {profLoading ? '⏳ Salvataggio...' : '✓ Salva modifiche'}
        </button>
      </div>
    </div>
  );

  // ─── ADMIN ───────────────────────────────────────────────────────
  if (view === 'admin' && isAdminUser) {
    const pending = requests.filter(r => r.status === 'pending');
    return (
      <div style={A.wrap}>
        <style>{css}</style>
        <div style={A.hdr}>
          <button className="hbtn" style={A.btnO} onClick={() => setView('home')}>← Indietro</button>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, color: c.accent, fontWeight: 600 }}>🛡️ Pannello Admin</div>
          <MBtn />
        </div>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '22px 16px 70px' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 20, border: `1px solid ${c.border}`, borderRadius: 10, overflow: 'hidden' }}>
            {(['users', 'requests'] as const).map(t => (
              <button key={t} onClick={() => setAdminTab(t)} style={{ flex: 1, padding: '12px', background: adminTab === t ? c.accent : c.card, color: adminTab === t ? '#FFF8F0' : c.muted, border: 'none', fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                {t === 'users' ? '👥 Utenti' : `✉️ Richieste${pending.length > 0 ? ` (${pending.length})` : ''}`}
              </button>
            ))}
          </div>

          {adminLoading && <div style={{ textAlign: 'center', color: c.muted, padding: 40 }}><span className="spin">⟳</span> Caricamento...</div>}

          {/* TAB UTENTI */}
          {adminTab === 'users' && !adminLoading && (
            <div style={{ ...A.box, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: c.accentLight }}>
                    {['Email', 'Nome', 'Admin', 'Azioni'].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: c.muted, letterSpacing: '.08em', textTransform: 'uppercase' as const, borderBottom: `1px solid ${c.border}` }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {appUsers.map((u, i) => (
                    <tr key={u.id} style={{ background: i % 2 === 0 ? c.card : '#FDFAF6', borderBottom: `1px solid ${c.border}` }}>
                      <td style={{ padding: '10px 14px', fontSize: 13, color: c.muted }}>{u.email}</td>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: c.text }}>{u.display_name || '—'}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <input type="checkbox" checked={u.is_admin} onChange={async e => {
                          const newVal = e.target.checked;
                          await db.users.setAdmin(u.id, newVal, tok()!);
                          setAppUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_admin: newVal } : x));
                        }} style={{ cursor: 'pointer', width: 16, height: 16, accentColor: c.accent }} />
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        {u.id !== session?.user.id && (
                          <button className="hbtn" style={{ ...A.btnR, fontSize: 11, padding: '4px 10px' }} onClick={async () => {
                            if (!window.confirm(`Eliminare l'utente ${u.display_name || u.email}? Le sue ricette rimarranno.`)) return;
                            await db.users.delete(u.id, tok()!);
                            setAppUsers(prev => prev.filter(x => x.id !== u.id));
                          }}>Elimina</button>
                        )}
                        {u.id === session?.user.id && <span style={{ fontSize: 11, color: c.muted }}>Tu</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB RICHIESTE */}
          {adminTab === 'requests' && !adminLoading && (
            <div>
              {requests.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '50px 20px', color: c.muted }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
                  <div>Nessuna richiesta ricevuta</div>
                </div>
              ) : requests.map(req => (
                <div key={req.id} style={{ ...A.box, padding: '16px 20px', marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, color: c.text, marginBottom: 4 }}>{req.display_name} <span style={{ fontWeight: 400, color: c.muted, fontSize: 13 }}>— {req.email}</span></div>
                      {req.message && <div style={{ fontSize: 13, color: c.muted, fontStyle: 'italic', marginBottom: 6 }}>"{req.message}"</div>}
                      <div style={{ fontSize: 11, color: c.muted }}>{new Date(req.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6, alignItems: 'flex-end' }}>
                      {req.status === 'pending' ? (
                        <>
                            <button className="hbtn" style={{ ...A.btn, fontSize: 12, padding: '6px 12px' }}
                              onClick={async () => {
                                const token = session?.access_token;  // ← leggi direttamente da session, non da tok()
                                if (!token) { alert('Sessione scaduta, rieffettua il login'); return; }
                                if (!window.confirm(`Creare account per ${req.display_name} (${req.email})?`)) return;
                                try {
                                  const res = await fetch(`${SUPABASE_URL}/functions/v1/approve-request`, {
                                    method: 'POST',
                                    headers: {
                                      'Content-Type': 'application/json',
                                      'Authorization': `Bearer ${token}`,
                                      'apikey': SUPABASE_ANON_KEY,
                                    },
                                    body: JSON.stringify({
                                      request_id: req.id,
                                      email: req.email,
                                      display_name: req.display_name,
                                    }),
                                  });
                                  const j = await res.json();
                                  if (!res.ok) { alert(`Errore: ${j.error}`); return; }
                                  setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'approved' } : r));
                                  alert(`✅ Account creato per ${req.display_name}!`);
                                } catch {
                                  alert('Errore di connessione. Riprova.');
                                }
                              }}>✓ Approva</button>
                          <button className="hbtn" style={{ ...A.btnR, fontSize: 12, padding: '6px 12px' }} onClick={async () => {
                            await db.requests.setStatus(req.id, 'rejected', tok()!);
                            setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'rejected' } : r));
                          }}>✗ Rifiuta</button>
                        </>
                      ) : (
                        <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: req.status === 'approved' ? '#E8F5EC' : c.redLight, color: req.status === 'approved' ? '#2E7D4F' : c.red }}>
                          {req.status === 'approved' ? '✓ Approvata' : '✗ Rifiutata'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {pending.length > 0 && <div style={{ fontSize: 12, color: c.muted, marginTop: 8, textAlign: 'center' }}>Clicca "Approva" per inviare automaticamente una bozza di email all'utente. Ricorda di creare l'account su Supabase Dashboard → Authentication → Users → Add user.</div>}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── REQUEST FORM ────────────────────────────────────────────────
  if (view === 'request_form') return (
    <div style={A.wrap}>
      <style>{css}</style>
      <div style={A.hdr}>
        <button className="hbtn" style={A.btnO} onClick={() => setView(session || isGuest ? 'home' : 'login')}>← Indietro</button>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, color: c.accent, fontWeight: 600 }}>Richiesta account</div>
        <MBtn />
      </div>
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '32px 16px 70px' }}>
        {reqSent ? (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>✉️</div>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 26, fontWeight: 700, color: c.accent, marginBottom: 12 }}>Richiesta inviata!</div>
            <div style={{ color: c.muted, fontSize: 14, lineHeight: 1.7, marginBottom: 24 }}>La tua richiesta è stata ricevuta. L'amministratore la esaminerà e ti contatterà all'email fornita.</div>
            <button className="hbtn" style={A.btn} onClick={() => setView(session || isGuest ? 'home' : 'login')}>← Torna al ricettario</button>
          </div>
        ) : (
          <div style={{ ...A.box, padding: '28px 24px' }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 24, fontWeight: 700, color: c.accent, marginBottom: 8 }}>Richiedi un account</div>
            <div style={{ color: c.muted, fontSize: 13, lineHeight: 1.7, marginBottom: 24 }}>Compila il modulo per richiedere un account. L'amministratore riceverà la richiesta e ti contatterà.</div>
            {error && <div style={A.err}>{error}</div>}
            <div style={A.fld}><label style={A.lbl}>Email *</label>
              <input style={A.inp} type="email" placeholder="La tua email" value={reqEmail} onChange={e => setReqEmail(e.target.value)} />
            </div>
            <div style={A.fld}><label style={A.lbl}>Nome / Nickname *</label>
              <input style={A.inp} placeholder="Es. MarioR (sarà il tuo nome nel ricettario)" value={reqName} onChange={e => setReqName(e.target.value)} />
            </div>
            <div style={A.fld}><label style={A.lbl}>Messaggio (facoltativo)</label>
              <textarea style={{ ...A.inp, minHeight: 90, lineHeight: 1.7 }} placeholder="Presentati brevemente, perché vorresti contribuire..." value={reqMsg} onChange={e => setReqMsg(e.target.value)} />
            </div>
            <button className="hbtn" style={{ ...A.btn, width: '100%', padding: '13px', fontSize: 15 }}
  onClick={async () => {
    if (!reqEmail.trim() || !reqName.trim()) { setError('Email e nome sono obbligatori'); return; }
    setError('');

    // Controlla se email già registrata in app_users
    const emailCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/app_users?email=eq.${encodeURIComponent(reqEmail.trim())}&select=id`,
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const emailRows = await emailCheck.json();
    if (Array.isArray(emailRows) && emailRows.length > 0) {
      setError('Questa email è già registrata.');
      return;
    }

    // Controlla se display_name già in uso in app_users
    const nameCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/app_users?display_name=eq.${encodeURIComponent(reqName.trim())}&select=id`,
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const nameRows = await nameCheck.json();
    if (Array.isArray(nameRows) && nameRows.length > 0) {
      setError('Questo nome è già in uso. Scegline un altro.');
      return;
    }

    // Controlla se c'è già una richiesta pending con la stessa email
    const reqCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/account_requests?email=eq.${encodeURIComponent(reqEmail.trim())}&status=eq.pending&select=id`,
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const reqRows = await reqCheck.json();
    if (Array.isArray(reqRows) && reqRows.length > 0) {
      setError('Hai già una richiesta in attesa con questa email.');
      return;
    }

    try {
      const res = await db.requests.insert({
        email: reqEmail.trim(),
        display_name: reqName.trim(),
        message: reqMsg.trim()
      });
      if (!res.ok) {
        const j = await res.json();
        setError(`Errore: ${j.message || j.msg || res.status}`);
        return;
      }
      setReqSent(true);
    } catch {
      setError('Errore di connessione. Riprova.');
    }
  }}>Invia richiesta →</button>
          </div>
        )}
      </div>
    </div>
  );

  return null;
}
