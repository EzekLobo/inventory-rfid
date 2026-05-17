import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const outputDir = path.join(rootDir, "docs", "tcc", "figs", "sistema");
const chromePath =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const debugPort = Number(process.env.CHROME_DEBUG_PORT || 9222);
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
const username = process.env.CAPTURE_USER || "capturas_tcc";
const password = process.env.CAPTURE_PASSWORD || "CapturasTcc2026!";
const captureUser = {
  id: 2,
  username,
  first_name: "",
  last_name: "",
  email: "",
  is_admin: true,
  perfil: "admin",
  permissions: {
    gerenciar_cadastros: true,
    acionar_leitores: true,
    executar_auditoria: true,
    resolver_inconsistencias: true,
    ver_logs: true,
    gerenciar_usuarios: true,
  },
};

const pages = [
  ["dashboard", "/"],
  ["itens", "/itens"],
  ["antenas", "/antenas"],
  ["inconsistencias", "/inconsistencias"],
  ["auditoria", "/auditoria"],
  ["log", "/log"],
  ["configuracoes", "/configuracoes"],
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killProcessTree(process) {
  if (!process?.pid) {
    return;
  }
  if (globalThis.process.platform === "win32") {
    spawn("taskkill.exe", ["/PID", String(process.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    process.kill("SIGTERM");
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Falha em ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

async function isUrlReady(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await isUrlReady(url)) {
      return;
    }
    await delay(250);
  }
  throw new Error(`${label} nao ficou disponivel a tempo.`);
}

async function waitForDevTools() {
  const endpoint = `http://127.0.0.1:${debugPort}/json/version`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await fetchJson(endpoint);
    } catch {
      await delay(200);
    }
  }
  throw new Error("Chrome DevTools nao ficou disponivel a tempo.");
}

function createCdpClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result || {});
      }
      return;
    }

    const callbacks = listeners.get(message.method);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(message.params || {});
      }
    }
  });

  return {
    ready: new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    }),
    close: () => socket.close(),
    on(method, callback) {
      if (!listeners.has(method)) {
        listeners.set(method, new Set());
      }
      listeners.get(method).add(callback);
      return () => listeners.get(method)?.delete(callback);
    },
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      const payload = JSON.stringify({ id, method, params });
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timeout no comando CDP ${method}`));
        }, 15000);
        pending.set(id, {
          resolve: (result) => {
            clearTimeout(timeout);
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
        socket.send(payload);
      });
    },
  };
}

async function waitForLoad(client) {
  await new Promise((resolve) => {
    const remove = client.on("Page.loadEventFired", () => {
      remove();
      resolve();
    });
  });
  await client.send("Runtime.evaluate", {
    expression:
      "document.fonts ? document.fonts.ready.then(() => true) : true",
    awaitPromise: true,
  });
  let settled = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await client.send("Runtime.evaluate", {
      expression:
        "!document.body.innerText.includes('Carregando') && !document.body.innerText.includes('Inicializando')",
      returnByValue: true,
    });
    if (result.result?.value) {
      settled = true;
      break;
    }
    await delay(500);
  }
  if (!settled) {
    const text = await client.send("Runtime.evaluate", {
      expression: "document.body.innerText.slice(0, 180)",
      returnByValue: true,
    });
    console.error("[wait] interface ainda carregando:", JSON.stringify(text.result?.value));
  }
  await delay(1200);
}

async function navigate(client, url) {
  const loadPromise = waitForLoad(client);
  await client.send("Page.navigate", { url });
  await loadPromise;
}

async function capture(client, name, url) {
  await navigate(client, url);
  const image = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true,
  });
  await fs.writeFile(path.join(outputDir, `${name}.png`), image.data, "base64");
  console.log(`${name}.png`);
}

async function main() {
  console.log("Preparando pasta de capturas...");
  await fs.mkdir(outputDir, { recursive: true });

  const profileDir = path.join(rootDir, ".tmp-chrome-captures");
  await fs.rm(profileDir, { recursive: true, force: true });

  let frontend = null;
  if (!(await isUrlReady(frontendUrl))) {
    console.log("Iniciando frontend Next.js em modo producao...");
    frontend = spawn("cmd.exe", ["/c", "npm.cmd", "run", "start"], {
      cwd: path.join(rootDir, "frontend"),
      stdio: ["ignore", "pipe", "pipe"],
    });
    frontend.stdout.on("data", (data) => {
      const text = data.toString().trim();
      if (text.includes("Ready") || text.includes("Local")) {
        console.log(`[frontend] ${text}`);
      }
    });
    frontend.stderr.on("data", (data) => {
      const text = data.toString().trim();
      if (text) {
        console.error(`[frontend] ${text}`);
      }
    });
    await waitForUrl(frontendUrl, "Frontend");
  }

  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-sandbox",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-features=VizDisplayCompositor,UseSkiaRenderer",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${debugPort}`,
      "--window-size=1440,1000",
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  chrome.stderr.on("data", (data) => {
    const text = data.toString().trim();
    if (text) {
      console.error(`[chrome] ${text}`);
    }
  });
  chrome.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`[chrome] finalizado com codigo ${code}`);
    }
  });

  try {
    console.log("Aguardando Chrome DevTools...");
    await waitForDevTools();
    console.log("Criando aba de captura...");
    const tab = await fetchJson(
      `http://127.0.0.1:${debugPort}/json/new?about:blank`,
      { method: "PUT" },
    );
    console.log(`Conectando em ${tab.webSocketDebuggerUrl}...`);
    const client = createCdpClient(tab.webSocketDebuggerUrl);
    await client.ready;
    console.log("Configurando pagina...");
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Log.enable");
    await client.send("Network.enable");
    client.on("Runtime.exceptionThrown", (params) => {
      console.error("[browser exception]", params.exceptionDetails?.text || "");
    });
    client.on("Log.entryAdded", (params) => {
      if (["error", "warning"].includes(params.entry?.level)) {
        console.error("[browser log]", params.entry.text);
      }
    });
    client.on("Network.loadingFailed", (params) => {
      console.error("[network failed]", params.errorText, params.blockedReason || "");
    });
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await capture(client, "sistema-login", frontendUrl);

    const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        localStorage.setItem("inventory-rfid-auth", ${JSON.stringify(authorization)});
        localStorage.setItem("inventory-rfid-user", ${JSON.stringify(JSON.stringify(captureUser))});
      `,
    });
    await client.send("Runtime.evaluate", {
      expression: `
        localStorage.setItem("inventory-rfid-auth", ${JSON.stringify(authorization)});
        localStorage.setItem("inventory-rfid-user", ${JSON.stringify(JSON.stringify(captureUser))});
      `,
    });

    for (const [name, route] of pages) {
      await capture(client, `sistema-${name}`, `${frontendUrl}${route}`);
    }

    client.close();
  } finally {
    killProcessTree(chrome);
    killProcessTree(frontend);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
