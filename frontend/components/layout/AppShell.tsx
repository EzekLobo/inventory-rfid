"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cpu, LogIn, LogOut, Menu, RadioTower, Settings, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { useAuth } from "@/context/AuthContext";

const navItems = [
  { href: "/", label: "Início" },
  { href: "/antenas", label: "Leitores" },
  { href: "/auditoria", label: "Auditoria" },
  { href: "/inconsistencias", label: "Inconsistências" },
  { href: "/itens", label: "Patrimônio" },
  { href: "/log", label: "Log" },
  { href: "/configuracoes", label: "Configurações", iconOnly: true }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { authenticated, loading, logout, user } = useAuth();

  if (loading) {
    return <div className="boot-screen">Inicializando console RFID</div>;
  }

  if (!authenticated) {
    return <LoginScreen />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            <img className="brand-logo" src="/assets/logo-colcic.png" alt="" />
          </span>
          <span className="brand-copy">
            <strong>COLCIC</strong>
            <small>Inventário RFID</small>
          </span>
        </Link>

        <button className="menu-button" type="button" onClick={() => setOpen((value) => !value)}>
          <Menu size={22} />
        </button>

        <nav className={open ? "nav nav-open" : "nav"}>
          {navItems.filter((item) => item.href !== "/log" || user?.permissions.ver_logs).map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                aria-label={item.iconOnly ? item.label : undefined}
                className={item.iconOnly ? (active ? "nav-link icon-only active" : "nav-link icon-only") : active ? "nav-link active" : "nav-link"}
                href={item.href}
                key={item.href}
                title={item.iconOnly ? item.label : undefined}
              >
                {item.href === "/configuracoes" ? <Settings size={17} /> : null}
                {item.iconOnly ? <span className="sr-only">{item.label}</span> : item.label}
              </Link>
            );
          })}
          <button className="nav-action" type="button" onClick={logout} title={user ? `${user.username} | ${user.perfil}` : undefined}>
            <LogOut size={17} />
            Sair
          </button>
        </nav>
      </header>

      <main>{children}</main>

      <footer className="footer">
        <div className="footer-main">
          <Cpu size={18} />
          <span>Controle operacional dos leitores RFID, auditorias e inconsistências patrimoniais.</span>
        </div>
        <small>&copy; 2026 InventoryRFID &bull; By Ezequiel Lobo</small>
      </footer>
    </div>
  );
}

function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao acessar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel" aria-label="Acesso ao inventário RFID">
        <div className="login-visual" aria-hidden="true">
          <div className="signal-frame">
            <RadioTower size={74} />
            <span />
            <span />
            <span />
          </div>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-brand">
            <span className="brand-mark">
              <img className="brand-logo" src="/assets/logo-colcic.png" alt="" />
            </span>
            <span>
              <strong>COLCIC</strong>
              <small>Inventário RFID</small>
            </span>
          </div>

          <div>
            <span className="eyebrow">Acesso seguro</span>
            <h1>Console operacional</h1>
          </div>

          <label className="field">
            <span>Usuário</span>
            <input
              className="input"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>

          <label className="field">
            <span>Senha</span>
            <input
              className="input"
              autoComplete="current-password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error ? <div className="login-error">{error}</div> : null}

          <button className="button login-button" disabled={loading} type="submit">
            <LogIn size={18} />
            {loading ? "Validando" : "Entrar"}
          </button>

          <div className="login-status">
            <ShieldCheck size={17} />
            <span>API conectada em modo autenticado</span>
          </div>
        </form>
      </section>
    </main>
  );
}
