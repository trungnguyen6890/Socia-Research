// Shared HTML layout and component helpers

export const CSS = `
:root{--bg:#0f1117;--surface:#1a1d27;--sh:#22263a;--border:#2a2e3f;--text:#e4e6ed;--muted:#8b8fa3;--primary:#6366f1;--ph:#818cf8;--green:#22c55e;--yellow:#f59e0b;--red:#ef4444;--blue:#3b82f6}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
a{color:var(--primary);text-decoration:none}a:hover{color:var(--ph)}
.layout{display:grid;grid-template-columns:220px 1fr;min-height:100vh}
.sidebar{background:var(--surface);border-right:1px solid var(--border);padding:1.5rem 0}
.sidebar h1{font-size:1rem;padding:0 1.25rem 1.25rem;border-bottom:1px solid var(--border);margin-bottom:.5rem}
.sidebar nav a{display:block;padding:.55rem 1.25rem;color:var(--muted);font-size:.875rem;transition:.15s}
.sidebar nav a:hover,.sidebar nav a.active{background:var(--sh);color:var(--text)}
.main{padding:2rem;max-width:1200px}
.main h2{font-size:1.4rem;margin-bottom:1.5rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem;margin-bottom:2rem}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1.25rem}
.stat-card .label{font-size:.75rem;color:var(--muted);text-transform:uppercase}
.stat-card .value{font-size:1.8rem;font-weight:700;margin-top:.2rem}
table{width:100%;border-collapse:collapse;background:var(--surface);border-radius:8px;overflow:hidden;border:1px solid var(--border)}
th,td{padding:.7rem 1rem;text-align:left;border-bottom:1px solid var(--border)}
th{font-size:.75rem;text-transform:uppercase;color:var(--muted);background:var(--sh)}
tr:hover td{background:rgba(99,102,241,.04)}
.badge{display:inline-block;padding:.15rem .5rem;border-radius:4px;font-size:.72rem;font-weight:600}
.b-green{background:rgba(34,197,94,.15);color:var(--green)}
.b-red{background:rgba(239,68,68,.15);color:var(--red)}
.b-yellow{background:rgba(245,158,11,.15);color:var(--yellow)}
.b-blue{background:rgba(59,130,246,.15);color:var(--blue)}
.b-muted{background:rgba(139,143,163,.15);color:var(--muted)}
.btn{display:inline-block;padding:.45rem 1rem;border-radius:6px;font-size:.85rem;font-weight:500;border:none;cursor:pointer;transition:.15s;text-decoration:none}
.btn-primary{background:var(--primary);color:#fff}.btn-primary:hover{background:var(--ph);color:#fff}
.btn-danger{background:var(--red);color:#fff}.btn-danger:hover{opacity:.9}
.btn-sm{padding:.28rem .6rem;font-size:.75rem}
.btn-outline{background:transparent;border:1px solid var(--border);color:var(--muted)}.btn-outline:hover{border-color:var(--text);color:var(--text)}
.form-group{margin-bottom:1.25rem}
.form-group label{display:block;font-size:.83rem;color:var(--muted);margin-bottom:.3rem}
input[type=text],input[type=number],input[type=url],select,textarea{width:100%;padding:.55rem .75rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.875rem;font-family:inherit}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--primary)}
textarea{min-height:90px;resize:vertical}
.cb-group{display:flex;align-items:center;gap:.5rem}
.toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;gap:1rem;flex-wrap:wrap}
.filters{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}
.filters input,.filters select{width:auto;min-width:140px}
.actions{display:flex;gap:.3rem}
.score-bar{display:inline-block;width:55px;height:5px;background:var(--border);border-radius:3px;overflow:hidden;vertical-align:middle;margin-right:.3rem}
.score-fill{height:100%;border-radius:3px;background:var(--primary)}
.pg{display:flex;gap:.4rem;justify-content:center;margin-top:1.5rem}
.pg a,.pg span{padding:.35rem .7rem;border-radius:4px;font-size:.8rem}
.pg .cur{background:var(--primary);color:#fff}
pre{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:1rem;overflow-x:auto;font-size:.78rem;color:var(--muted)}
.btn-success{background:#16a34a;color:#fff;border:none}.btn-success:hover{background:#15803d;color:#fff}
@keyframes spin{to{transform:rotate(360deg)}}.spin{display:inline-block;animation:spin 1s linear infinite}
.toast{position:fixed;bottom:1.5rem;right:1.5rem;padding:.75rem 1.25rem;border-radius:8px;font-size:.875rem;font-weight:500;max-width:380px;box-shadow:0 4px 24px rgba(0,0,0,.4);transition:opacity .4s;z-index:9999;opacity:0}
.toast-success{background:#166534;color:#bbf7d0;border:1px solid #16a34a}
.toast-error{background:#7f1d1d;color:#fecaca;border:1px solid #ef4444}
.toast-info{background:#1e3a5f;color:#bfdbfe;border:1px solid #3b82f6}
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem}
.detail-card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1.25rem}
.detail-card h3{font-size:.78rem;color:var(--muted);text-transform:uppercase;margin-bottom:.75rem}
.detail-card p{margin-bottom:.4rem;font-size:.875rem}
.full{grid-column:1/-1}
`;

export function layout(title: string, path: string, body: string): string {
  const navItems = [
    ['/admin/', 'Dashboard'],
    ['/admin/sources', 'Sources'],
    ['/admin/keywords', 'Keywords'],
    ['/admin/goals', 'Goals'],
    ['/admin/schedules', 'Schedules'],
    ['/admin/content', 'Content'],
    ['/admin/settings', 'Settings'],
  ];

  const nav = navItems
    .map(([href, label]) =>
      `<a href="${href}" class="${path === href || (href !== '/' && path.startsWith(href)) ? 'active' : ''}">${label}</a>`)
    .join('');

  return `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} - Socia Research</title>
<style>${CSS}</style>
<script src="https://unpkg.com/htmx.org@1.9.10" defer></script>
</head>
<body>
<div class="layout">
<aside class="sidebar">
<h1>Socia Research</h1>
<nav>${nav}</nav>
</aside>
<main class="main">${body}</main>
</div>
</body></html>`;
}

export function badge(text: string, active: boolean | number): string {
  const cls = active ? 'b-green' : 'b-muted';
  return `<span class="badge ${cls}">${active ? 'active' : 'inactive'}</span>`;
}

export function statusBadge(status: string): string {
  const cls: Record<string, string> = {
    success: 'b-green', error: 'b-red', running: 'b-yellow', partial: 'b-yellow',
  };
  return `<span class="badge ${cls[status] ?? 'b-muted'}">${status}</span>`;
}

export function scoreBar(score: number): string {
  return `<span class="score-bar"><span class="score-fill" style="width:${Math.round(score*100)}%"></span></span>${score.toFixed(2)}`;
}

export function truncate(s: string | null | undefined, n = 80): string {
  if (!s) return '<em style="color:var(--muted)">—</em>';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    });
  } catch { return s; }
}

export function pagination(page: number, totalPages: number, buildUrl: (p: number) => string): string {
  if (totalPages <= 1) return '';
  const links: string[] = [];
  if (page > 1) links.push(`<a href="${buildUrl(page-1)}" class="btn btn-sm btn-outline">Prev</a>`);
  for (let p = 1; p <= totalPages; p++) {
    if (p === page) links.push(`<span class="cur">${p}</span>`);
    else if (p <= 2 || p > totalPages - 2 || Math.abs(p - page) <= 1) links.push(`<a href="${buildUrl(p)}">${p}</a>`);
    else if (p === 3 || p === totalPages - 2) links.push('<span>…</span>');
  }
  if (page < totalPages) links.push(`<a href="${buildUrl(page+1)}" class="btn btn-sm btn-outline">Next</a>`);
  return `<div class="pg">${links.join('')}</div>`;
}
