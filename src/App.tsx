import { useState, useEffect, useRef } from "react";
import type { CSSProperties, KeyboardEvent, ChangeEvent } from "react";

// ─── CONFIGURAZIONE SUPABASE ───────────────────────────────────────
const SUPABASE_URL = 'https://eotxguvsrgbrgdaxhfwz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvdHhndXZzcmdicmdkYXhoZnd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMjY3ODMsImV4cCI6MjA4ODgwMjc4M30.GthcPCt_JyxFpK0AWGVnEr2cqjjLx7bnKcvm-FtKuU4';
// ──────────────────────────────────────────────────────────────────

// ─── ADMIN ────────────────────────────────────────────────────────
// Aggiungi qui le email degli admin. Possono modificare/eliminare tutte le ricette.
const ADMIN_EMAILS: string[] = ['toffolettonicolo@yahoo.it'];
// ──────────────────────────────────────────────────────────────────

// ─── TIPI ──────────────────────────────────────────────────────────

interface User {
  id: string;
  email: string;
  user_metadata?: { display_name?: string; name?: string };
}

interface Session {
  access_token: string;
  user: User;
}

interface Recipe {
  id: string;
  created_at?: string;
  title: string;
  creation_time: string;
  date: string | null;
  type: string;
  weight: string;
  servings: number;
  ingredients: string;
  procedure: string;
  photo_url: string;
  notes: string;
  cost: string;
  author: string;
}

interface FormState {
  id: string | null;
  title: string;
  creation_time: string;
  date: string;
  type: string;
  weight: string;
  servings: number;
  ingredients: string;
  procedure: string;
  photo_url: string;
  notes: string;
  cost: string;
  author: string;
}

interface MetaItem {
  icon: string;
  label: string;
  value: string;
  accent?: boolean;
}

// ─── HELPERS RUOLI ────────────────────────────────────────────────

const displayName = (sess: Session): string =>
  sess.user.user_metadata?.display_name ||
  sess.user.user_metadata?.name ||
  sess.user.email.split('@')[0];

const isAdmin = (sess: Session | null): boolean =>
  sess ? ADMIN_EMAILS.includes(sess.user.email) : false;

// Un utente può modificare una ricetta se è admin oppure se ne è l'autore
const canEditRecipe = (recipe: Recipe, sess: Session | null): boolean => {
  if (!sess) return false;
  if (isAdmin(sess)) return true;
  return recipe.author === displayName(sess);
};

// ─── AUTH API ──────────────────────────────────────────────────────

const authApi = {
  signIn: async (email: string, password: string): Promise<{ session: Session | null; error: string | null }> => {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const j = await r.json();
    if (!r.ok) return { session: null, error: j.error_description || j.msg || 'Credenziali non valide' };
    return { session: j as Session, error: null };
  },
  signOut: async (token: string): Promise<void> => {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` }
    });
  },
  getUser: async (token: string): Promise<User | null> => {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` }
    });
    if (!r.ok) return null;
    return r.json();
  }
};

// ─── DB HEADERS ───────────────────────────────────────────────────

const makeHeaders = (token?: string): Record<string, string> => ({
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${token || SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
});

// ─── UTILITIES ────────────────────────────────────────────────────

const compressImage = (file: File): Promise<Blob> => new Promise((resolve) => {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const MAX = 1200;
    let w = img.width, h = img.height;
    if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    canvas.toBlob((b) => { URL.revokeObjectURL(url); resolve(b as Blob); }, 'image/jpeg', 0.78);
  };
  img.src = url;
});

const uploadPhoto = async (file: File, token: string): Promise<string> => {
  const blob = await compressImage(file);
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/recipe-photos/${name}`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
    body: blob
  });
  if (!res.ok) throw new Error('Upload foto fallito');
  return `${SUPABASE_URL}/storage/v1/object/public/recipe-photos/${name}`;
};

const stepsToDb = (steps: string[]): string =>
  JSON.stringify(steps.filter(s => s.trim() !== '' || steps.length === 1));

const dbToSteps = (procedure: string): string[] => {
  if (!procedure) return [''];
  try {
    const parsed = JSON.parse(procedure);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as string[];
  } catch {}
  return [procedure];
};

const parseWeightValue = (w: string): number | null => {
  if (!w) return null;
  const m = w.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  return parseFloat(m[1].replace(',', '.'));
};

const multiplyIngredients = (text: string, multiplier: number): string => {
  if (!text || multiplier === 1) return text;
  const map = new Map<string, string>();
  let idx = 0;
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const toToken = (i: number) => `PHOLD${letters[Math.floor(i / 26) % 26]}${letters[i % 26]}`;
  const protectedText = text.replace(/\([^)]*\)/g, (match) => {
    const token = toToken(idx++); map.set(token, match); return token;
  });
  const multiplied = protectedText.replace(/(?<![a-zA-Z])(\d+(?:[.,]\d+)?)/g, (match) => {
    const num = parseFloat(match.replace(',', '.'));
    const result = num * multiplier;
    if (Number.isInteger(result)) return String(result);
    return String(Math.round(result * 10) / 10).replace('.', ',');
  });
  let out = multiplied;
  map.forEach((val, token) => { out = out.split(token).join(val); });
  return out;
};

function IngredientLine({ raw, c }: { raw: string; c: Record<string, string> }) {
  const trimmed = raw.trim();
  if (trimmed === '') return <div style={{ height: 8 }} />;
  const startsWithDash = /^[-–]/.test(trimmed);
  const startsWithNumber = /^\d/.test(trimmed);
  if (!startsWithDash && !startsWithNumber) return (
    <div style={{ fontWeight: 700, fontSize: 14, color: '#2C2010', marginTop: 12, marginBottom: 2 }}>{trimmed}</div>
  );
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{ color: c.accentMid, flexShrink: 0, fontWeight: 700 }}>–</span>
      <span style={{ fontSize: 15, lineHeight: 1.9 }}>{trimmed.replace(/^[-–]\s*/, '')}</span>
    </div>
  );
}

// ─── API RICETTE ───────────────────────────────────────────────────

const makeApi = (token?: string) => ({
  list: async (): Promise<Recipe[]> => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/recipes?order=created_at.desc`, { headers: makeHeaders(token) });
    return r.json();
  },
  insert: async (data: Partial<Recipe>): Promise<Recipe> => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/recipes`, { method: 'POST', headers: makeHeaders(token), body: JSON.stringify(data) });
    const j = await r.json(); return Array.isArray(j) ? j[0] : j;
  },
  update: async (id: string, data: Partial<Recipe>): Promise<Recipe> => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/recipes?id=eq.${id}`, { method: 'PATCH', headers: makeHeaders(token), body: JSON.stringify(data) });
    const j = await r.json(); return Array.isArray(j) ? j[0] : j;
  },
  delete: async (id: string): Promise<void> => {
    await fetch(`${SUPABASE_URL}/rest/v1/recipes?id=eq.${id}`, { method: 'DELETE', headers: makeHeaders(token) });
  }
});

const emptyForm = (author: string): FormState => ({
  id: null, title: '', creation_time: '', date: '', type: '',
  weight: '', servings: 1, ingredients: '', procedure: '',
  photo_url: '', notes: '', cost: '', author
});

// ─── EDITOR PROCEDIMENTO ───────────────────────────────────────────

function ProcedureEditor({ steps, onChange, inputStyle, c }: {
  steps: string[]; onChange: (s: string[]) => void;
  inputStyle: CSSProperties; c: Record<string, string>;
}) {
  const refs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const update = (i: number, val: string) => { const s = [...steps]; s[i] = val; onChange(s); };
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>, i: number) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const el = refs.current[i]!;
      const pos = el.selectionStart ?? steps[i].length;
      const s = [...steps]; s[i] = steps[i].slice(0, pos); s.splice(i + 1, 0, steps[i].slice(pos));
      onChange(s); setTimeout(() => refs.current[i + 1]?.focus(), 0);
    } else if (e.key === 'Backspace' && steps[i] === '' && steps.length > 1) {
      e.preventDefault();
      const s = steps.filter((_, j) => j !== i); onChange(s);
      setTimeout(() => refs.current[i - 1]?.focus(), 0);
    }
  };
  const autoResize = (el: HTMLTextAreaElement | null) => {
    if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px';
  };
  return (
    <div>
      {steps.map((step, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 26, height: 26, borderRadius: '50%', background: c.accentLight, color: c.accent, fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 9, flexShrink: 0, fontFamily: "'Cormorant Garamond',serif" }}>{i + 1}</div>
          <textarea ref={el => { refs.current[i] = el; if (el) autoResize(el); }} value={step}
            placeholder={i === 0 ? "Primo passo... (Invio = nuovo passo, Shift+Invio = a capo)" : "Passo successivo..."}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => { update(i, e.target.value); autoResize(e.target); }}
            onKeyDown={(e) => handleKeyDown(e, i)} rows={1}
            style={{ ...inputStyle, flex: 1, minHeight: 42, lineHeight: 1.8, resize: 'none', overflow: 'hidden' }} />
          {steps.length > 1 && (
            <button onClick={() => { const s = steps.filter((_, j) => j !== i); onChange(s.length ? s : ['']); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.muted, fontSize: 18, marginTop: 5, padding: '0 2px' }}>×</button>
          )}
        </div>
      ))}
      <button onClick={() => { onChange([...steps, '']); setTimeout(() => refs.current[steps.length]?.focus(), 0); }}
        style={{ background: 'none', border: `1.5px dashed ${c.border}`, borderRadius: 8, padding: '6px 14px', color: c.muted, fontSize: 13, cursor: 'pointer', marginTop: 4, fontFamily: "'Nunito',sans-serif", fontWeight: 600 }}>
        + Aggiungi passo
      </button>
    </div>
  );
}

// ─── AUTOCOMPLETE ──────────────────────────────────────────────────

function AutocompleteInput({ value, onChange, suggestions, placeholder, style, field }: {
  value: string; onChange: (v: string) => void; suggestions: string[];
  placeholder: string; style: CSSProperties; field?: string;
}) {
  const [open, setOpen] = useState(false);
  const filtered = suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()) && s.toLowerCase() !== value.toLowerCase());
  return (
    <div style={{ position: 'relative' }}>
      <input style={style} placeholder={placeholder} value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 180)} />
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: '#fff', border: '1.5px solid #F2E4D0', borderTop: 'none', borderRadius: '0 0 8px 8px', boxShadow: '0 8px 20px rgba(100,70,30,0.08)' }}>
          {filtered.map(s => (
            <div key={s} onMouseDown={() => { onChange(s); setOpen(false); }}
              style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13, color: '#8A7A65', textTransform: field === 'type' ? 'capitalize' : 'none' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F2E4D0')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>{s}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── MENU LATERALE ────────────────────────────────────────────────

function SideMenu({ open, onClose, session, isGuest, onLogout, c, A }: {
  open: boolean; onClose: () => void;
  session: Session | null; isGuest: boolean;
  onLogout: () => void;
  c: Record<string, string>; A: Record<string, CSSProperties>;
}) {
  const adminEmail = ADMIN_EMAILS[0];

  return (
    <>
      {/* Overlay */}
      {open && (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(44,32,16,0.35)', zIndex: 300, backdropFilter: 'blur(2px)' }} />
      )}
      {/* Pannello */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 320, maxWidth: '90vw',
        background: c.card, zIndex: 400, boxShadow: '-8px 0 40px rgba(100,70,30,0.15)',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s cubic-bezier(.4,0,.2,1)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto'
      }}>
        {/* Header menu */}
        <div style={{ padding: '20px 22px 16px', borderBottom: `1px solid ${c.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, color: c.accent }}>Chef's Book</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: c.muted, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '20px 22px', flex: 1 }}>
          {/* Utente corrente */}
          <div style={{ background: c.accentLight, borderRadius: 10, padding: '14px 16px', marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.muted, letterSpacing: '.08em', textTransform: 'uppercase' as const, marginBottom: 4 }}>Accesso come</div>
            <div style={{ fontWeight: 700, color: c.text, fontSize: 15 }}>
              {isGuest ? '👤 Ospite' : `👨‍🍳 ${session ? displayName(session) : ''}`}
            </div>
            {session && isAdmin(session) && (
              <div style={{ marginTop: 4, background: c.accent, color: '#FFF8F0', fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '2px 7px', display: 'inline-block', letterSpacing: '.06em' }}>ADMIN</div>
            )}
            {isGuest && (
              <div style={{ marginTop: 4, fontSize: 11, color: c.muted }}>Solo visualizzazione</div>
            )}
          </div>

          {/* Info app */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 16, fontWeight: 700, color: c.accent, marginBottom: 10 }}>📖 Cos'è Chef's Book?</div>
            <div style={{ fontSize: 13, color: c.muted, lineHeight: 1.7 }}>
              Chef's Book è il ricettario digitale condiviso della nostra cucina. Permette di raccogliere, organizzare e consultare le ricette, con la possibilità di scalare automaticamente gli ingredienti per porzioni o peso diversi.
            </div>
          </div>

          {/* Permessi */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 16, fontWeight: 700, color: c.accent, marginBottom: 10 }}>🔐 Livelli di accesso</div>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
              {[
                { badge: 'OSPITE', color: c.muted, bg: '#F0EDE8', desc: 'Consulta le ricette e usa il calcolatore porzioni' },
                { badge: 'MEMBRO', color: c.accentMid, bg: '#F2E4D0', desc: 'Aggiunge e modifica le proprie ricette' },
                { badge: 'ADMIN', color: '#FFF8F0', bg: c.accent, desc: 'Accesso completo a tutte le ricette' },
              ].map(r => (
                <div key={r.badge} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ background: r.bg, color: r.color, fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '3px 7px', whiteSpace: 'nowrap' as const, marginTop: 1 }}>{r.badge}</div>
                  <div style={{ fontSize: 12, color: c.muted, lineHeight: 1.6 }}>{r.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Richiedi accesso */}
          {(isGuest || !session) && (
            <div style={{ background: '#FFFBF0', border: `1px solid #EDD080`, borderRadius: 10, padding: '16px', marginBottom: 24 }}>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 15, fontWeight: 700, color: c.accentMid, marginBottom: 8 }}>✉️ Vuoi contribuire?</div>
              <div style={{ fontSize: 12, color: c.muted, lineHeight: 1.7, marginBottom: 12 }}>
                Per aggiungere o modificare ricette hai bisogno di un account. Contatta l'amministratore per ricevere le credenziali.
              </div>
              <a href={`mailto:${adminEmail}?subject=Richiesta%20account%20Chef%27s%20Book&body=Ciao%2C%20vorrei%20richiedere%20un%20account%20per%20accedere%20a%20Chef%27s%20Book.%0A%0ANome%3A%20%0AMotivazione%3A%20`}
                style={{ display: 'block', textAlign: 'center' as const, background: c.accentMid, color: '#FFF8F0', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 700, textDecoration: 'none', fontFamily: "'Nunito',sans-serif" }}>
                Richiedi accesso →
              </a>
            </div>
          )}

          {/* Versione */}
          <div style={{ fontSize: 11, color: c.muted, textAlign: 'center' as const, marginBottom: 8 }}>
            Chef's Book · Ricettario professionale
          </div>
        </div>

        {/* Footer con logout */}
        {!isGuest && session && (
          <div style={{ padding: '16px 22px', borderTop: `1px solid ${c.border}` }}>
            <button onClick={onLogout} style={{ ...A.btnO, width: '100%', textAlign: 'center' as const, justifyContent: 'center', display: 'flex' }}>
              Esci dall'account
            </button>
          </div>
        )}
        {isGuest && (
          <div style={{ padding: '16px 22px', borderTop: `1px solid ${c.border}` }}>
            <button onClick={onLogout} style={{ ...A.btn, width: '100%', textAlign: 'center' as const, justifyContent: 'center', display: 'flex', background: c.accentMid }}>
              Accedi con il tuo account
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ─── APP PRINCIPALE ────────────────────────────────────────────────

export default function ChefBook() {
  const [view, setView] = useState<string>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [isGuest, setIsGuest] = useState(false);
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
  const [currentServings, setCurrentServings] = useState(1);
  const [currentWeightInput, setCurrentWeightInput] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const types = Array.from(new Set(recipes.map(r => r.type).filter(Boolean)));
  const authors = Array.from(new Set(recipes.map(r => r.author).filter(Boolean)));
  const getToken = () => session?.access_token;
  const userName = session ? displayName(session) : isGuest ? 'Ospite' : '';

  const load = async (token?: string, quiet = false) => {
    if (!quiet) setSyncing(true);
    try {
      const recs = await makeApi(token).list();
      if (Array.isArray(recs)) setRecipes(recs);
      else setError('Errore connessione.');
    } catch { setError('Errore connessione Supabase.'); }
    setSyncing(false);
  };

  useEffect(() => {
    (async () => {
      const stored = localStorage.getItem('cb-session');
      if (stored) {
        try {
          const sess = JSON.parse(stored) as Session;
          const user = await authApi.getUser(sess.access_token);
          if (user) {
            setSession(sess); await load(sess.access_token); setView('home'); return;
          }
        } catch {}
        localStorage.removeItem('cb-session');
      }
      setView('login');
    })();
  }, []);

  const handleLogin = async () => {
    if (!loginEmail.trim() || !loginPassword.trim()) return;
    setLoginLoading(true); setError('');
    const { session: sess, error: err } = await authApi.signIn(loginEmail.trim(), loginPassword);
    if (err || !sess) { setError(err || 'Errore di accesso'); setLoginLoading(false); return; }
    localStorage.setItem('cb-session', JSON.stringify(sess));
    setSession(sess); setIsGuest(false);
    await load(sess.access_token);
    setLoginLoading(false); setView('home');
  };

  const handleGuestLogin = async () => {
    setIsGuest(true); setSession(null);
    localStorage.removeItem('cb-session');
    await load(undefined);
    setView('home');
  };

  const handleLogout = async () => {
    if (session) await authApi.signOut(session.access_token);
    localStorage.removeItem('cb-session');
    setSession(null); setIsGuest(false); setRecipes([]);
    setMenuOpen(false); setView('login');
  };

  const newRecipe = () => {
    setForm(emptyForm(userName)); setSteps(['']);
    setPhotoPreview(null); setCurrent(null); setView('form');
  };

  const editRecipe = (r: Recipe) => {
    setForm({ ...r, date: r.date || '' });
    setSteps(dbToSteps(r.procedure));
    setPhotoPreview(r.photo_url || null);
    setView('form');
  };

  const duplicateRecipe = (r: Recipe) => {
    setForm({ ...r, id: null, date: r.date || '', title: `${r.title} (copia)`, author: userName });
    setSteps(dbToSteps(r.procedure));
    setPhotoPreview(r.photo_url || null);
    setCurrent(null); setView('form');
  };

  const openDetail = (r: Recipe) => {
    setCurrent(r); setCurrentServings(r.servings || 1);
    setCurrentWeightInput(r.weight || ''); setView('detail');
  };

  const handlePhotoSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true); setError('');
    try { const url = await uploadPhoto(file, getToken()!); sf('photo_url', url); setPhotoPreview(url); }
    catch { setError('Errore caricamento foto. Riprova.'); }
    setUploading(false);
  };

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true); setError('');
    try {
      const api = makeApi(getToken());
      const data: Partial<Recipe> = {
        title: form.title, creation_time: form.creation_time, date: form.date || null,
        type: form.type, weight: form.weight, servings: form.servings || 1,
        ingredients: form.ingredients, procedure: stepsToDb(steps),
        photo_url: form.photo_url, notes: form.notes, cost: form.cost,
        author: form.author || userName
      };
      if (form.id) {
        await api.update(form.id, data);
        const updated = { ...form, ...data, id: form.id } as Recipe;
        setRecipes(prev => prev.map(r => r.id === form.id ? updated : r));
        setCurrent(updated); setCurrentServings(data.servings ?? 1);
        setCurrentWeightInput(data.weight || '');
      } else {
        const saved = await api.insert(data);
        setRecipes(prev => [saved, ...prev]);
        setCurrent(saved); setCurrentServings(saved.servings || 1);
        setCurrentWeightInput(saved.weight || '');
      }
      setView('detail');
    } catch { setError('Errore salvataggio. Controlla la connessione.'); }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await makeApi(getToken()).delete(id);
    setRecipes(prev => prev.filter(r => r.id !== id));
    setView('home');
  };

  const sf = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(p => ({ ...p, [k]: v }));

  const filtered = recipes
    .filter(r => filter === 'tutti' || r.type === filter)
    .filter(r => !search || r.title.toLowerCase().includes(search.toLowerCase()) || (r.author || '').toLowerCase().includes(search.toLowerCase()));

  // ─── PALETTE ──────────────────────────────────────────────────────
  const c: Record<string, string> = {
    bg: '#F7F3EE', card: '#FFFFFF', card2: '#FDF9F4',
    accent: '#A8621A', accentLight: '#F2E4D0', accentMid: '#C4862A',
    text: '#2C2010', muted: '#8A7A65', border: '#E2D9CC', input: '#FDFAF6',
    red: '#C0392B', redLight: '#FDECEA', shadow: 'rgba(100,70,30,0.08)'
  };

  const A: Record<string, CSSProperties> = {
    wrap: { fontFamily: "'Nunito',sans-serif", background: c.bg, minHeight: '100vh', color: c.text },
    header: { background: c.card, borderBottom: `1px solid ${c.border}`, padding: '0 16px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100, gap: 10, boxShadow: `0 2px 12px ${c.shadow}` },
    logo: { fontFamily: "'Cormorant Garamond',serif", fontSize: 22, fontWeight: 700, color: c.accent, letterSpacing: '.03em', whiteSpace: 'nowrap' },
    btn: { background: c.accent, color: '#FFF8F0', border: 'none', borderRadius: 8, padding: '9px 16px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: `0 2px 8px ${c.accent}40` },
    btnO: { background: 'transparent', color: c.muted, border: `1.5px solid ${c.border}`, borderRadius: 8, padding: '8px 14px', fontFamily: "'Nunito',sans-serif", fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' },
    btnRed: { background: c.redLight, color: c.red, border: `1.5px solid #F5C6C2`, borderRadius: 8, padding: '8px 14px', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: 13, cursor: 'pointer' },
    input: { background: c.input, color: c.text, border: `1.5px solid ${c.border}`, borderRadius: 8, padding: '10px 14px', fontSize: 14, width: '100%', fontFamily: "'Nunito',sans-serif", textAlign: 'left' as const },
    label: { fontSize: 11, fontWeight: 700, color: c.muted, letterSpacing: '.1em', textTransform: 'uppercase' as const, display: 'block', marginBottom: 6 },
    field: { marginBottom: 18 },
    secTitle: { fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, color: c.accent, marginBottom: 14, paddingBottom: 10, borderBottom: `2px solid ${c.accentLight}` },
    tag: { background: c.accentLight, color: c.accent, borderRadius: 20, padding: '3px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'capitalize' as const },
    cardBox: { background: c.card, borderRadius: 14, border: `1px solid ${c.border}`, boxShadow: `0 2px 12px ${c.shadow}` },
    err: { background: c.redLight, border: `1px solid #F5C6C2`, borderRadius: 8, padding: '10px 14px', color: c.red, fontSize: 13, marginBottom: 16 }
  };

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Nunito:wght@300;400;500;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #F7F3EE; }
    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: #F7F3EE; }
    ::-webkit-scrollbar-thumb { background: #D9CFBF; border-radius: 3px; }
    input, textarea { outline: none; font-family: 'Nunito', sans-serif; text-align: left; }
    input[type=number]::-webkit-inner-spin-button,
    input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    input[type=number] { -moz-appearance: textfield; }
    .hcard { transition: transform .25s, box-shadow .25s !important; }
    .hcard:hover { transform: translateY(-4px) !important; box-shadow: 0 12px 32px rgba(100,70,30,0.13) !important; }
    .hbtn:hover { opacity: .82; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spin { animation: spin 1s linear infinite; display: inline-block; }
    .mobile-search { display: none !important; }
    @media (max-width: 640px) {
      .desktop-search { display: none !important; }
      .mobile-search { display: flex !important; align-items: center; gap: 8px; padding: 10px 14px; background: #FFFFFF; border-bottom: 1px solid #E2D9CC; }
      .g2 { grid-template-columns: 1fr !important; }
      .rgrid { grid-template-columns: 1fr 1fr !important; }
      .detail-acts { flex-wrap: wrap; gap: 6px !important; }
      .detail-acts button { padding: 7px 10px !important; font-size: 12px !important; }
      .meta-strip { flex-direction: column !important; }
      .meta-strip > div { border-right: none !important; border-bottom: 1px solid #E2D9CC; }
      .meta-strip > div:last-child { border-bottom: none !important; }
      .servings-weight-row { flex-wrap: wrap; gap: 10px !important; }
    }
    @media (max-width: 400px) { .rgrid { grid-template-columns: 1fr !important; } }
  `;

  // Bottone menu hamburger (riutilizzato nell'header)
  const MenuBtn = () => (
    <button onClick={() => setMenuOpen(true)} style={{ ...A.btnO, padding: '8px 12px', fontSize: 17, lineHeight: 1 }} title="Menu">☰</button>
  );

  // ─── LOADING ──────────────────────────────────────────────────────
  if (view === 'loading') return (
    <div style={{ ...A.wrap, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <style>{css}</style>
      <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 40, color: c.accent }}>👨‍🍳 Chef's Book</div>
      <div style={{ color: c.muted, fontSize: 13 }}><span className="spin">⟳</span> Connessione...</div>
    </div>
  );

  // ─── LOGIN ────────────────────────────────────────────────────────
  if (view === 'login') return (
    <div style={{ ...A.wrap, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'linear-gradient(135deg,#F7F3EE,#EDE3D6)', minHeight: '100vh' }}>
      <style>{css}</style>
      <div style={{ ...A.cardBox, padding: '44px 32px', maxWidth: 420, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 52, marginBottom: 14 }}>👨‍🍳</div>
        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 40, fontWeight: 700, color: c.accent, marginBottom: 6 }}>Chef's Book</div>
        <div style={{ color: c.muted, marginBottom: 28, fontSize: 14, lineHeight: 1.7 }}>Il ricettario collaborativo<br />della tua cucina</div>

        {error && <div style={A.err}>{error}</div>}

        <div style={{ ...A.field, textAlign: 'left' }}>
          <label style={A.label}>Email</label>
          <input style={A.input} type="email" placeholder="Es. marco@cucina.it" value={loginEmail}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setLoginEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()} autoFocus />
        </div>
        <div style={{ ...A.field, textAlign: 'left' }}>
          <label style={A.label}>Password</label>
          <div style={{ position: 'relative' }}>
            <input style={{ ...A.input, paddingRight: 44 }} type={showPassword ? 'text' : 'password'}
              placeholder="••••••••" value={loginPassword}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setLoginPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            <button onClick={() => setShowPassword(v => !v)}
              style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: c.muted, padding: 0 }}
              tabIndex={-1}>{showPassword ? '🙈' : '👁️'}</button>
          </div>
        </div>

        <button className="hbtn" style={{ ...A.btn, width: '100%', padding: '13px', fontSize: 15, opacity: loginLoading ? 0.6 : 1 }}
          onClick={handleLogin} disabled={loginLoading}>
          {loginLoading ? <span><span className="spin">⟳</span> Accesso...</span> : 'Accedi →'}
        </button>

        {/* Separatore */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' }}>
          <div style={{ flex: 1, height: 1, background: c.border }} />
          <span style={{ fontSize: 12, color: c.muted }}>oppure</span>
          <div style={{ flex: 1, height: 1, background: c.border }} />
        </div>

        {/* Accesso ospite */}
        <button className="hbtn" style={{ ...A.btnO, width: '100%', padding: '12px', fontSize: 14 }} onClick={handleGuestLogin}>
          Entra come ospite 👁️
        </button>

        <div style={{ color: c.muted, fontSize: 11, marginTop: 18, lineHeight: 1.7 }}>
          Gli ospiti possono consultare le ricette ma non modificarle.<br />
          Per un account completo contatta l'amministratore.
        </div>
      </div>
    </div>
  );

  // ─── HOME ─────────────────────────────────────────────────────────
  if (view === 'home') return (
    <div style={A.wrap}>
      <style>{css}</style>
      <SideMenu open={menuOpen} onClose={() => setMenuOpen(false)} session={session} isGuest={isGuest} onLogout={handleLogout} c={c} A={A} />

      <div style={A.header}>
        <div style={A.logo}>👨‍🍳 Chef's Book</div>
        <div className="desktop-search" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
          <input style={{ ...A.input, maxWidth: 200, padding: '7px 12px', fontSize: 13 }} placeholder="🔍 Cerca ricetta..." value={search} onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} />
          <button className="hbtn" style={{ ...A.btnO, padding: '7px 11px', fontSize: 16 }} onClick={() => load(getToken())}>
            {syncing ? <span className="spin">⟳</span> : '⟳'}
          </button>
          <span style={{ color: c.muted, fontSize: 12, whiteSpace: 'nowrap' }}>
            👤 <strong style={{ color: c.text }}>{userName}</strong>
            {isGuest && <span style={{ color: c.muted, fontSize: 10, marginLeft: 4 }}>(ospite)</span>}
            {session && isAdmin(session) && <span style={{ background: c.accent, color: '#FFF', fontSize: 9, fontWeight: 700, borderRadius: 3, padding: '1px 5px', marginLeft: 4 }}>ADMIN</span>}
          </span>
          {!isGuest && <button className="hbtn" style={A.btn} onClick={newRecipe}>+ Nuova ricetta</button>}
          <MenuBtn />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isGuest && <button className="hbtn mobile-search" style={{ ...A.btn }} onClick={newRecipe}>+ Nuova</button>}
          <MenuBtn />
        </div>
      </div>

      <div className="mobile-search" style={{ display: 'none' }}>
        <input style={{ ...A.input, fontSize: 14 }} placeholder="🔍 Cerca ricetta..." value={search} onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} />
        <button className="hbtn" style={{ ...A.btnO, padding: '9px 11px', fontSize: 16, flexShrink: 0 }} onClick={() => load(getToken())}>
          {syncing ? <span className="spin">⟳</span> : '⟳'}
        </button>
        {!isGuest && <button className="hbtn" style={{ ...A.btn, flexShrink: 0 }} onClick={newRecipe}>+ Nuova</button>}
      </div>

      {/* Banner ospite */}
      {isGuest && (
        <div style={{ background: '#FFFBF0', borderBottom: `1px solid #EDD080`, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: c.accentMid }}>👁️ Stai navigando come ospite — solo visualizzazione</span>
          <button onClick={() => setMenuOpen(true)} style={{ ...A.btnO, fontSize: 12, padding: '5px 12px', borderColor: c.accentMid, color: c.accentMid }}>Richiedi accesso</button>
        </div>
      )}

      <div style={{ background: c.card, borderBottom: `1px solid ${c.border}`, padding: '0 14px', display: 'flex', gap: 2, overflowX: 'auto' }}>
        {['tutti', ...types].map(t => (
          <button key={t} onClick={() => setFilter(t)} style={{
            background: 'transparent', color: filter === t ? c.accent : c.muted, border: 'none',
            borderBottom: filter === t ? `2.5px solid ${c.accent}` : '2.5px solid transparent',
            padding: '13px 14px 11px', fontSize: 13, cursor: 'pointer',
            fontFamily: "'Nunito',sans-serif", fontWeight: filter === t ? 700 : 500,
            textTransform: 'capitalize', transition: 'all .2s', whiteSpace: 'nowrap',
          }}>{t === 'tutti' ? '📚 Tutte' : t}</button>
        ))}
      </div>

      <div style={{ padding: '10px 16px 4px', color: c.muted, fontSize: 12, fontWeight: 600 }}>
        {filtered.length} ricett{filtered.length === 1 ? 'a' : 'e'}{filter !== 'tutti' ? ` · ${filter}` : ''}
      </div>
      {error && <div style={{ ...A.err, margin: '4px 16px 8px' }}>{error}</div>}

      {filtered.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '70px 24px', gap: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 56 }}>📖</div>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 26, color: c.muted }}>
            {search ? 'Nessun risultato' : 'Nessuna ricetta ancora'}
          </div>
          {!search && !isGuest && <button className="hbtn" style={{ ...A.btn, marginTop: 8 }} onClick={newRecipe}>+ Aggiungi ricetta</button>}
        </div>
      ) : (
        <div className="rgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 16, padding: 16 }}>
          {filtered.map(r => (
            <div key={r.id} className="hcard" style={{ background: c.card, borderRadius: 14, border: `1px solid ${c.border}`, overflow: 'hidden', cursor: 'pointer', boxShadow: `0 2px 10px ${c.shadow}` }}
              onClick={() => openDetail(r)}>
              {r.photo_url
                ? <img src={r.photo_url} alt={r.title} style={{ width: '100%', height: 148, objectFit: 'cover', display: 'block' }} />
                : <div style={{ width: '100%', height: 148, background: `linear-gradient(135deg,${c.accentLight},#EDD5B0)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontSize: 42 }}>🍽️</span></div>
              }
              <div style={{ padding: '12px 14px 14px' }}>
                {r.type && <div style={{ ...A.tag, display: 'inline-block', marginBottom: 7 }}>{r.type}</div>}
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 18, fontWeight: 700, lineHeight: 1.3, marginBottom: 7 }}>{r.title}</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', color: c.muted, fontSize: 12 }}>
                  {r.creation_time && <span>⏱ {r.creation_time}</span>}
                  {r.weight && <span>⚖️ {r.weight}</span>}
                  {r.cost && <span>💰 {r.cost}</span>}
                </div>
                <div style={{ color: c.muted, fontSize: 11, marginTop: 7, borderTop: `1px solid ${c.border}`, paddingTop: 7 }}>
                  di <strong style={{ color: c.accentMid }}>{r.author}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ─── DETAIL ───────────────────────────────────────────────────────
  if (view === 'detail' && current) {
    const r = current;
    const baseServings = r.servings || 1;
    const baseWeight = parseWeightValue(r.weight);
    let multiplier = currentServings / baseServings;
    if (baseWeight !== null) {
      const cwv = parseWeightValue(currentWeightInput);
      if (cwv !== null && cwv > 0) multiplier = (cwv / baseWeight) * (currentServings / baseServings);
    }
    const multipliedIngredients = multiplyIngredients(r.ingredients, multiplier);
    const parsedSteps = dbToSteps(r.procedure);
    const weightUnit = r.weight ? r.weight.replace(/[\d.,\s]/g, '').trim() : '';
    const isModified = Math.abs(multiplier - 1) > 0.001;
    const canEdit = canEditRecipe(r, session);

    return (
      <div style={A.wrap}>
        <style>{css}</style>
        <SideMenu open={menuOpen} onClose={() => setMenuOpen(false)} session={session} isGuest={isGuest} onLogout={handleLogout} c={c} A={A} />

        <div style={A.header}>
          <button className="hbtn" style={A.btnO} onClick={() => setView('home')}>← Ricette</button>
          <div className="detail-acts" style={{ display: 'flex', gap: 8 }}>
            {canEdit && <button className="hbtn" style={A.btnO} onClick={() => duplicateRecipe(r)}>⧉ Duplica</button>}
            {canEdit && <button className="hbtn" style={A.btnO} onClick={() => editRecipe(r)}>✏️ Modifica</button>}
            {canEdit && <button className="hbtn" style={A.btnRed} onClick={() => { if (window.confirm(`Eliminare "${r.title}"?`)) handleDelete(r.id); }}>🗑</button>}
            {!canEdit && !isGuest && <span style={{ fontSize: 12, color: c.muted, display: 'flex', alignItems: 'center' }}>🔒 Solo lettura</span>}
            <MenuBtn />
          </div>
        </div>

        <div style={{ maxWidth: 780, margin: '0 auto', padding: '26px 16px 70px' }}>
          {r.photo_url && <img src={r.photo_url} alt={r.title} style={{ width: '100%', height: 270, objectFit: 'cover', borderRadius: 14, marginBottom: 22, display: 'block', boxShadow: `0 8px 32px ${c.shadow}` }} />}
          {r.type && <div style={{ ...A.tag, display: 'inline-block', marginBottom: 10 }}>{r.type}</div>}
          <h1 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 34, fontWeight: 700, lineHeight: 1.15, marginBottom: 18, color: c.text }}>{r.title}</h1>

          <div className="meta-strip" style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 22, background: c.accentLight, borderRadius: 12, overflow: 'hidden', border: `1px solid ${c.border}` }}>
            {([
              r.creation_time ? { icon: '⏱', label: 'Tempo', value: r.creation_time } : null,
              r.weight ? { icon: '⚖️', label: 'Peso base', value: r.weight } : null,
              r.cost ? { icon: '💰', label: 'Costo', value: r.cost } : null,
              r.date ? { icon: '📅', label: 'Data', value: r.date } : null,
              { icon: '👨‍🍳', label: 'Autore', value: r.author, accent: true }
            ] as (MetaItem | null)[]).filter((m): m is MetaItem => m !== null).map((m, i, arr) => (
              <div key={i} style={{ padding: '12px 18px', flex: '1 1 auto', borderRight: i < arr.length - 1 ? `1px solid ${c.border}` : 'none', minWidth: 90 }}>
                <div style={A.label}>{m.label}</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: m.accent ? c.accent : c.text }}>{m.icon} {m.value}</div>
              </div>
            ))}
          </div>

          {r.ingredients && (
            <div style={{ ...A.cardBox, padding: '20px 22px', marginBottom: 16 }}>
              <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: `2px solid ${c.accentLight}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, color: c.accent }}>Ingredienti</div>
                  {isModified && (
                    <button onClick={() => { setCurrentServings(baseServings); setCurrentWeightInput(r.weight || ''); }}
                      style={{ background: 'none', border: 'none', color: c.muted, fontSize: 11, cursor: 'pointer', textDecoration: 'underline', paddingTop: 4 }}>↩ reset</button>
                  )}
                </div>
                <div className="servings-weight-row" style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: c.muted, letterSpacing: '.08em', textTransform: 'uppercase' as const }}>Porzioni</span>
                    <div style={{ display: 'flex', alignItems: 'center', border: `1.5px solid ${c.border}`, borderRadius: 8, overflow: 'hidden' }}>
                      <button onClick={() => setCurrentServings(s => Math.max(0.1, Math.round((s - 0.1) * 10) / 10))}
                        style={{ background: c.bg, border: 'none', width: 30, height: 30, cursor: 'pointer', fontSize: 17, color: c.muted, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                      <input type="number" min="0.1" step="0.1" value={currentServings}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setCurrentServings(Math.round(v * 10) / 10); }}
                        style={{ width: 46, height: 30, border: 'none', borderLeft: `1px solid ${c.border}`, borderRight: `1px solid ${c.border}`, background: 'transparent', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: 14, color: c.text, textAlign: 'center', padding: 0 }} />
                      <button onClick={() => setCurrentServings(s => Math.round((s + 0.1) * 10) / 10)}
                        style={{ background: c.bg, border: 'none', width: 30, height: 30, cursor: 'pointer', fontSize: 17, color: c.accent, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                    </div>
                  </div>
                  {baseWeight !== null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: c.muted, letterSpacing: '.08em', textTransform: 'uppercase' as const }}>Peso</span>
                      <div style={{ display: 'flex', alignItems: 'center', border: `1.5px solid ${c.border}`, borderRadius: 8, overflow: 'hidden', background: c.input }}>
                        <input type="number" min="1" step="1" value={parseWeightValue(currentWeightInput) ?? ''}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => { const n = e.target.value; setCurrentWeightInput(n ? `${n}${weightUnit}` : ''); }}
                          style={{ width: 70, height: 30, border: 'none', background: 'transparent', fontFamily: "'Nunito',sans-serif", fontWeight: 700, fontSize: 14, color: c.text, textAlign: 'center', padding: '0 8px' }} />
                        {weightUnit && <span style={{ paddingRight: 8, color: c.muted, fontSize: 13, fontWeight: 600 }}>{weightUnit}</span>}
                      </div>
                    </div>
                  )}
                  {isModified && (
                    <div style={{ background: c.accentLight, borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 700, color: c.accent }}>
                      ×{Math.round(multiplier * 100) / 100}
                    </div>
                  )}
                </div>
              </div>
              <div>{multipliedIngredients.split('\n').map((line, i) => <IngredientLine key={i} raw={line} c={c} />)}</div>
            </div>
          )}

          {parsedSteps.some(s => s.trim()) && (
            <div style={{ ...A.cardBox, padding: '20px 22px', marginBottom: 16 }}>
              <div style={A.secTitle}>Procedimento</div>
              {parsedSteps.map((step, i) => step.trim() && (
                <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                  <div style={{ minWidth: 26, height: 26, borderRadius: '50%', background: c.accentLight, color: c.accent, fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 3, fontFamily: "'Cormorant Garamond',serif" }}>{i + 1}</div>
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.85, fontSize: 15, paddingTop: 2, flex: 1 }}>{step}</div>
                </div>
              ))}
            </div>
          )}

          {r.notes && (
            <div style={{ background: '#FFFBF0', border: `1px solid #EDD080`, borderLeft: `4px solid ${c.accentMid}`, borderRadius: '0 12px 12px 0', padding: '16px 20px' }}>
              <div style={{ ...A.label, color: c.accentMid, marginBottom: 8 }}>📝 Note</div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.9, fontSize: 14, fontStyle: 'italic' }}>{r.notes}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── FORM ─────────────────────────────────────────────────────────
  if (view === 'form') {
    return (
      <div style={A.wrap}>
        <style>{css}</style>
        <div style={A.header}>
          <button className="hbtn" style={A.btnO} onClick={() => setView(current ? 'detail' : 'home')}>← Annulla</button>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 17, color: c.accent, fontWeight: 600 }}>
            {form.id ? 'Modifica ricetta' : 'Nuova ricetta'}
          </div>
          <button className="hbtn" style={{ ...A.btn, opacity: (!form.title || saving || uploading) ? 0.5 : 1 }}
            onClick={handleSave} disabled={!form.title || saving || uploading}>
            {saving ? '⏳ Salvo...' : '✓ Salva'}
          </button>
        </div>

        <div style={{ maxWidth: 780, margin: '0 auto', padding: '22px 16px 70px' }}>
          {error && <div style={A.err}>{error}</div>}

          <div style={{ ...A.cardBox, padding: '20px 22px', marginBottom: 14 }}>
            <div style={A.secTitle}>Informazioni di base</div>
            <div style={A.field}>
              <label style={A.label}>Titolo ricetta *</label>
              <input style={{ ...A.input, fontSize: 15, fontWeight: 600 }} placeholder="Es. Tiramisù classico"
                value={form.title} onChange={(e: ChangeEvent<HTMLInputElement>) => sf('title', e.target.value)} autoFocus />
            </div>
            <div className="g2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={A.field}>
                <label style={A.label}>Tempo preparazione</label>
                <input style={A.input} placeholder="Es. 1h 30min" value={form.creation_time} onChange={(e: ChangeEvent<HTMLInputElement>) => sf('creation_time', e.target.value)} />
              </div>
              <div style={A.field}>
                <label style={A.label}>Data (facoltativa)</label>
                <input type="date" style={A.input} value={form.date} onChange={(e: ChangeEvent<HTMLInputElement>) => sf('date', e.target.value)} />
              </div>
            </div>
            <div className="g2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={A.field}>
                <label style={A.label}>Tipologia</label>
                <AutocompleteInput value={form.type} onChange={v => sf('type', v)} suggestions={types} placeholder="Es. Dolce, Salato..." style={A.input} field="type" />
              </div>
              <div style={A.field}>
                <label style={A.label}>Peso (facoltativo)</label>
                <input style={A.input} placeholder="Es. 750g, 1kg" value={form.weight} onChange={(e: ChangeEvent<HTMLInputElement>) => sf('weight', e.target.value)} />
              </div>
            </div>
            <div className="g2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={A.field}>
                <label style={A.label}>Porzioni base</label>
                <div style={{ display: 'flex', alignItems: 'center', border: `1.5px solid ${c.border}`, borderRadius: 8, overflow: 'hidden', width: 'fit-content' }}>
                  <button onClick={() => sf('servings', Math.max(1, (form.servings || 1) - 1))}
                    style={{ background: c.bg, border: 'none', width: 38, height: 42, cursor: 'pointer', fontSize: 20, color: c.muted, fontWeight: 700 }}>−</button>
                  <div style={{ width: 48, textAlign: 'center', fontWeight: 700, fontSize: 16, color: c.text, borderLeft: `1px solid ${c.border}`, borderRight: `1px solid ${c.border}`, lineHeight: '42px' }}>{form.servings || 1}</div>
                  <button onClick={() => sf('servings', (form.servings || 1) + 1)}
                    style={{ background: c.bg, border: 'none', width: 38, height: 42, cursor: 'pointer', fontSize: 20, color: c.accent, fontWeight: 700 }}>+</button>
                </div>
                <div style={{ color: c.muted, fontSize: 11, marginTop: 5 }}>Quantità ingredienti calibrate per questo numero</div>
              </div>
              <div style={A.field}>
                <label style={A.label}>Costo approssimativo</label>
                <input style={A.input} placeholder="Es. ~€8" value={form.cost} onChange={(e: ChangeEvent<HTMLInputElement>) => sf('cost', e.target.value)} />
              </div>
            </div>
            <div style={A.field}>
              <label style={A.label}>Autore</label>
              <AutocompleteInput value={form.author || userName} onChange={v => sf('author', v)} suggestions={authors} placeholder="Es. Marco Rossi" style={A.input} field="author" />
            </div>
          </div>

          <div style={{ ...A.cardBox, padding: '20px 22px', marginBottom: 14 }}>
            <div style={A.secTitle}>Foto copertina</div>
            <input type="file" accept="image/*" ref={fileRef} style={{ display: 'none' }} onChange={handlePhotoSelect} />
            {photoPreview ? (
              <div>
                <img src={photoPreview} alt="cover" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
                <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                  <button className="hbtn" style={A.btnO} onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? '⏳ Caricamento...' : '🔄 Cambia'}</button>
                  <button className="hbtn" style={A.btnRed} onClick={() => { sf('photo_url', ''); setPhotoPreview(null); }}>× Rimuovi</button>
                </div>
              </div>
            ) : (
              <div style={{ border: `2px dashed ${c.border}`, borderRadius: 10, padding: '30px 20px', textAlign: 'center', cursor: uploading ? 'default' : 'pointer', background: c.bg }}
                onClick={() => !uploading && fileRef.current?.click()}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📷</div>
                <div style={{ color: c.muted, fontSize: 14, marginBottom: 4, fontWeight: 600 }}>{uploading ? '⏳ Compressione e caricamento...' : 'Clicca per aggiungere una foto'}</div>
                <div style={{ color: c.muted, fontSize: 11 }}>Ridimensionata automaticamente · Salvata su Supabase Storage</div>
              </div>
            )}
          </div>

          <div style={{ ...A.cardBox, padding: '20px 22px', marginBottom: 14 }}>
            <div style={A.secTitle}>Ingredienti</div>
            <div style={{ background: c.accentLight, borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: c.accent, lineHeight: 1.6 }}>
              💡 <strong>Riga con testo</strong> → titolo sezione in grassetto &nbsp;·&nbsp; <strong>Riga con numero o "-"</strong> → elemento lista
            </div>
            <textarea style={{ ...A.input, minHeight: 175, lineHeight: 2.1, fontWeight: 500 }}
              placeholder={"Primo impasto:\n250 g farina Manitoba\n85 g acqua tiepida\n\nSecondo impasto:\n200 g burro\n4 tuorli"}
              value={form.ingredients} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => sf('ingredients', e.target.value)} />
          </div>

          <div style={{ ...A.cardBox, padding: '20px 22px', marginBottom: 14 }}>
            <div style={A.secTitle}>Procedimento</div>
            <div style={{ color: c.muted, fontSize: 12, marginBottom: 12 }}>
              <strong>Invio</strong> = nuovo passo &nbsp;·&nbsp; <strong>Shift+Invio</strong> = a capo nello stesso passo
            </div>
            <ProcedureEditor steps={steps} onChange={setSteps} inputStyle={A.input} c={c} />
          </div>

          <div style={{ ...A.cardBox, padding: '20px 22px', marginBottom: 28 }}>
            <div style={A.secTitle}>Note</div>
            <textarea style={{ ...A.input, minHeight: 95, lineHeight: 1.9, fontStyle: 'italic' }}
              placeholder="Consigli, varianti, trucchi, abbinamenti consigliati..."
              value={form.notes} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => sf('notes', e.target.value)} />
          </div>

          <button className="hbtn" style={{ ...A.btn, width: '100%', padding: '14px', fontSize: 15, opacity: (!form.title || saving || uploading) ? 0.5 : 1 }}
            onClick={handleSave} disabled={!form.title || saving || uploading}>
            {saving ? '⏳ Salvataggio in corso...' : '✓ Salva ricetta'}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
