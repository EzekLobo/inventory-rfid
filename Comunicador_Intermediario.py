import os
import threading
import time
from datetime import datetime, timezone

import requests
from pynput import keyboard


# Este comunicador roda no computador onde o leitor RFID USB esta conectado.
# A API nao consegue falar diretamente com o leitor sem rede, entao este script
# consulta a API em intervalos curtos e executa os comandos pendentes.
API_BASE_URL = os.getenv("RFID_API_BASE_URL", "http://127.0.0.1:8000")
RFID_EVENTS_ENDPOINT = f"{API_BASE_URL.rstrip('/')}/api/eventos/rfid/"
RFID_COMMAND_ENDPOINT = f"{RFID_EVENTS_ENDPOINT}comando/"
RFID_TOKEN = os.getenv("RFID_INGEST_TOKEN", "dev-rfid-token")
ANTENNA_ID = int(os.getenv("RFID_ANTENNA_ID", "1"))

POLL_INTERVAL_SECONDS = float(os.getenv("RFID_POLL_INTERVAL", "1"))
REQUEST_TIMEOUT_SECONDS = float(os.getenv("RFID_TIMEOUT", "5"))
DUPLICATE_WINDOW_SECONDS = float(os.getenv("RFID_DUPLICATE_WINDOW", "1.5"))
SEND_BEFORE_EXPIRATION_SECONDS = float(os.getenv("RFID_SEND_MARGIN", "0.8"))

buffer_id = []
reading_enabled = False
stop_requested = False
tags_lidas = set()
last_seen_by_uid = {}
lock = threading.Lock()
session = requests.Session()


def auth_headers():
    return {"X-RFID-Token": RFID_TOKEN}


def get_command():
    response = session.get(
        RFID_COMMAND_ENDPOINT,
        params={"antenna_id": ANTENNA_ID},
        headers=auth_headers(),
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()


def post_tags(tags, payload=None):
    event_payload = {**(payload or {}), "source": "comunicador_intermediario"}
    response = session.post(
        RFID_EVENTS_ENDPOINT,
        json={
            "event_type": "tags_read",
            "antenna_id": ANTENNA_ID,
            "tags": sorted(tags),
            "payload": event_payload,
        },
        headers=auth_headers(),
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response


def parse_expires_at(value):
    if not value:
        return None
    normalized = str(value).replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def registrar_tag(uid):
    global tags_lidas

    uid = uid.strip()
    if not uid:
        return

    with lock:
        if not reading_enabled:
            print(f"Tag ignorada fora da janela de leitura: {uid}")
            return

        now = time.monotonic()
        last_seen_at = last_seen_by_uid.get(uid)
        if last_seen_at and now - last_seen_at < DUPLICATE_WINDOW_SECONDS:
            print(f"Leitura duplicada ignorada: {uid}")
            return

        last_seen_by_uid[uid] = now
        tags_lidas.add(uid)
        print(f"Tag capturada na janela ativa: {uid}")


def on_press(key):
    global buffer_id, stop_requested

    try:
        if key == keyboard.Key.enter:
            full_id = "".join(buffer_id)
            buffer_id = []
            registrar_tag(full_id)
            return

        if key == keyboard.Key.backspace:
            if buffer_id:
                buffer_id.pop()
            return

        if key == keyboard.Key.esc:
            stop_requested = True
            print("Encerrando comunicador intermediario.")
            return False

        char = getattr(key, "char", None)
        if char and char.isprintable():
            buffer_id.append(char)
    except Exception as exc:
        print(f"Erro no processamento da tecla: {exc}")


def abrir_janela_de_leitura(command):
    global reading_enabled, tags_lidas

    expires_at = parse_expires_at(command.get("expires_at"))
    seconds = command.get("active_for_seconds") or 0
    if expires_at:
        seconds = max(0, (expires_at - datetime.now(timezone.utc)).total_seconds())

    if seconds <= 0:
        return

    with lock:
        tags_lidas = set()
        reading_enabled = True

    readable_seconds = max(0.1, seconds - SEND_BEFORE_EXPIRATION_SECONDS)
    print(f"API solicitou leitura por {seconds:.1f}s na antena {ANTENNA_ID}.")
    print(f"Coletando tags por {readable_seconds:.1f}s para enviar antes da janela fechar.")
    deadline = time.monotonic() + readable_seconds
    while not stop_requested and time.monotonic() < deadline:
        time.sleep(0.1)

    with lock:
        reading_enabled = False
        tags_para_enviar = set(tags_lidas)
        tags_lidas = set()

    if not tags_para_enviar:
        print("Janela encerrada sem tags lidas.")
        return

    try:
        response = post_tags(tags_para_enviar, command.get("payload"))
        print(f"Enviado tags_read com {len(tags_para_enviar)} tag(s): {response.status_code} {response.text}")
    except requests.exceptions.RequestException as exc:
        print(f"Erro ao enviar tags para API: {exc}")


def command_loop():
    last_active_until = None

    while not stop_requested:
        try:
            command = get_command()
            expires_at = command.get("expires_at")
            if command.get("command") == "start_reading" and expires_at != last_active_until:
                last_active_until = expires_at
                abrir_janela_de_leitura(command)
            elif command.get("command") == "idle":
                last_active_until = None
        except requests.exceptions.RequestException as exc:
            print(f"Erro ao consultar comando da API: {exc}")

        time.sleep(POLL_INTERVAL_SECONDS)


def main():
    print("Comunicador intermediario RFID ativo.")
    print(f"Endpoint de comando: {RFID_COMMAND_ENDPOINT}")
    print(f"Endpoint de eventos: {RFID_EVENTS_ENDPOINT}")
    print(f"Antena: {ANTENNA_ID}")
    print("Aguardando a API solicitar inicio de leitura. Pressione Esc para sair.")

    worker = threading.Thread(target=command_loop, daemon=True)
    worker.start()

    with keyboard.Listener(on_press=on_press) as listener:
        listener.join()


if __name__ == "__main__":
    main()
