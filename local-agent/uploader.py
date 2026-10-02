#!/usr/bin/env python3
"""
Agente local de LivePlay — parte "uploader" (ver ../backend/AGENTE.md).

Cada POLL_SECONDS:
  1. Le pregunta al backend (GET /agent/matches/pending) qué partidos de ESTA cancha ya
     terminaron y todavía no tienen video (o quedaron en FAILED).
  2. Para cada uno, busca entre los segmentos que graba record.sh (misma carpeta,
     RECORDINGS_DIR) cuáles cubren el horario del partido, los concatena y recorta
     exactamente a [startTime, endTime] con ffmpeg (-c copy, sin recodificar).
  3. Sube ese recorte a POST /agent/matches/:id/video con el mismo token de la cámara —
     ese endpoint ya dispara el pipeline real de HLS + thumbnails que corre en el backend
     (nada de esto es nuevo del lado del servidor, ya está construido y probado).
  4. Si algo falla (sin segmentos todavía, subida caída, etc.) no pasa nada grave: el
     partido va a seguir apareciendo en "pending" en la próxima vuelta y se reintenta solo.

Solo depende de la biblioteca estándar de Python (para no requerir "pip install requests"
en un Termux recién instalado) + los binarios "ffmpeg" y "curl" del sistema.
"""
from __future__ import annotations

import glob
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parent
SEGMENT_NAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.mp4$")


def log(scope: str, msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{ts}] [{scope}] {msg}", flush=True)


def load_config() -> dict:
    """Lee config.env (formato KEY=VALUE, con soporte básico de $HOME) sin depender de bash."""
    path = AGENT_DIR / "config.env"
    if not path.exists():
        log("uploader", f"No existe {path} — copiá config.example.env a config.env y completalo.")
        sys.exit(1)

    cfg: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        value = value.replace("$HOME", os.path.expanduser("~")).replace("${HOME}", os.path.expanduser("~"))
        cfg[key] = value

    required = ["LIVEPLAY_API_BASE", "AGENT_KEY", "RECORDINGS_DIR", "TMP_DIR", "LOG_DIR"]
    missing = [k for k in required if not cfg.get(k)]
    if missing:
        log("uploader", f"Faltan variables en config.env: {', '.join(missing)}")
        sys.exit(1)

    cfg.setdefault("SEGMENT_SECONDS", "300")
    cfg.setdefault("RETENTION_HOURS", "8")
    cfg.setdefault("POLL_SECONDS", "120")
    cfg.setdefault("BUFFER_MINUTES", "15")
    cfg.setdefault("SAF_BACKUP_DIR_URI", "")  # opcional: respaldo a SD vía Termux SAF, ver config.example.env
    return cfg


def parse_iso(value: str) -> datetime:
    """Convierte un timestamp ISO8601 (los que devuelve el backend, típicamente con 'Z') a un
    datetime aware en UTC. `fromisoformat` de Python no acepta el sufijo 'Z' en todas las
    versiones, así que se normaliza a mano en vez de asumir Python 3.11+."""
    v = value.strip()
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    dt = datetime.fromisoformat(v)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


def fetch_pending_matches(cfg: dict) -> list[dict]:
    url = f"{cfg['LIVEPLAY_API_BASE']}/agent/matches/pending?bufferMinutes={cfg['BUFFER_MINUTES']}"
    result = run(["curl", "-sS", "-H", f"X-Agent-Key: {cfg['AGENT_KEY']}", url])
    if result.returncode != 0:
        log("uploader", f"No se pudo consultar /agent/matches/pending: {result.stderr.strip()}")
        return []
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        log("uploader", f"Respuesta no-JSON de /agent/matches/pending: {result.stdout[:300]!r}")
        return []


def list_segments(recordings_dir: Path) -> list[tuple[datetime, Path]]:
    """Todos los segmentos grabados, ordenados por su hora de inicio (que es su nombre)."""
    segments = []
    for path in glob.glob(str(recordings_dir / "*.mp4")):
        p = Path(path)
        m = SEGMENT_NAME_RE.match(p.name)
        if not m:
            continue
        start = datetime.strptime(m.group(1), "%Y-%m-%dT%H-%M-%S").replace(tzinfo=timezone.utc)
        segments.append((start, p))
    segments.sort(key=lambda item: item[0])
    return segments


def segments_for_window(
    segments: list[tuple[datetime, Path]], window_start: datetime, window_end: datetime, segment_seconds: int
) -> list[tuple[datetime, Path]] | None:
    """Devuelve los segmentos que cubren [window_start, window_end), o None si la ventana
    todavía no está totalmente grabada (el partido terminó hace muy poco, o el agente recién
    arrancó y todavía no tiene suficiente historial)."""
    if not segments:
        return None

    # El último segmento de la lista puede estar siendo escrito ahora mismo por record.sh —
    # nunca lo tocamos hasta que rote a uno nuevo. Si la ventana pedida todavía se solapa con
    # ese segmento "activo", esperamos a la próxima vuelta en vez de leer un archivo a medio
    # escribir.
    active_start = segments[-1][0]
    if window_end >= active_start:
        return None

    covering = []
    for i, (start, path) in enumerate(segments[:-1]):  # excluye el activo
        end = segments[i + 1][0] if i + 1 < len(segments) else start + timedelta(seconds=segment_seconds)
        if end > window_start and start < window_end:
            covering.append((start, path))

    return covering or None


def build_clip(
    segments: list[tuple[datetime, Path]], window_start: datetime, window_end: datetime, tmp_dir: Path, match_id: str
) -> Path | None:
    """Concatena los segmentos relevantes y recorta al horario exacto del partido. Usa -c
    copy (sin recodificar) en las dos etapas: rápido y liviano, a costa de que el corte final
    puede quedar en el keyframe más cercano en vez de al segundo exacto — aceptable para un
    primer video del partido completo, se puede prolijar más adelante si hace falta precisión
    al frame."""
    concat_list = tmp_dir / f"{match_id}.concat.txt"
    joined = tmp_dir / f"{match_id}.joined.mp4"
    trimmed = tmp_dir / f"{match_id}.mp4"

    concat_list.write_text("\n".join(f"file '{path}'" for _, path in segments) + "\n")

    joined_res = run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(joined)])
    if joined_res.returncode != 0:
        log("uploader", f"ffmpeg concat falló para {match_id}: {joined_res.stderr[-500:]}")
        # Bug real encontrado el 2026-10-01: acá faltaba este cleanup. Si el concat falla (por
        # ejemplo por un segmento corrupto), ffmpeg puede haber dejado un "joined.mp4" parcial
        # escrito en tmp_dir, y como este método devolvía None antes de llegar a los unlink() de
        # más abajo, ese archivo quedaba huérfano para siempre — con muchos partidos pendientes
        # reintentando cada POLL_SECONDS, esto fue llenando el almacenamiento (muy chico en un TV
        # box) en silencio hasta dejarlo sin espacio.
        joined.unlink(missing_ok=True)
        concat_list.unlink(missing_ok=True)
        return None

    first_start = segments[0][0]
    offset_start = max(0.0, (window_start - first_start).total_seconds())
    duration = (window_end - window_start).total_seconds()

    # OJO con el orden acá: "-ss" ANTES de "-i" (seek de entrada) + "-t" (duración) después.
    # Con -c copy, poner "-ss"/"-to" como opciones de SALIDA (después de -i) da resultados
    # incorrectos — probado empíricamente: devuelve un archivo con una duración que no
    # corresponde a la ventana pedida. "-ss" de entrada + "-t" de duración es la combinación
    # que realmente arranca en el offset pedido (con el corrimiento normal al keyframe más
    # cercano, dado que no se recodifica) y dura lo que corresponde.
    trim_res = run(
        ["ffmpeg", "-y", "-ss", str(offset_start), "-i", str(joined), "-t", str(duration), "-c", "copy", str(trimmed)]
    )
    joined.unlink(missing_ok=True)
    concat_list.unlink(missing_ok=True)
    if trim_res.returncode != 0:
        log("uploader", f"ffmpeg trim falló para {match_id}: {trim_res.stderr[-500:]}")
        return None

    return trimmed


def upload_clip(cfg: dict, match_id: str, clip_path: Path) -> bool:
    url = f"{cfg['LIVEPLAY_API_BASE']}/agent/matches/{match_id}/video"
    result = run(
        [
            "curl", "-sS", "-o", "-", "-w", "\n%{http_code}",
            "-H", f"X-Agent-Key: {cfg['AGENT_KEY']}",
            "-F", f"file=@{clip_path}",
            url,
        ]
    )
    if result.returncode != 0:
        log("uploader", f"curl falló subiendo {match_id}: {result.stderr.strip()}")
        return False

    *body_lines, status_code = result.stdout.rsplit("\n", 1)
    ok = status_code.strip().startswith(("2",))
    if ok:
        log("uploader", f"Partido {match_id} subido OK (HTTP {status_code.strip()})")
    else:
        log("uploader", f"Subida de {match_id} devolvió HTTP {status_code.strip()}: {''.join(body_lines)[:300]}")
    return ok


def archive_to_sd(cfg: dict, match_id: str, clip_path: Path) -> None:
    """Copia a la SD (vía Termux SAF) el clip de un partido que YA se subió con éxito al
    servidor — un respaldo extra, no el camino principal. Si SAF_BACKUP_DIR_URI no está
    configurado (instalación sin SD, o en Linux/Raspberry en vez de Termux/Android), esto no
    hace nada. Si algo falla acá no es grave: el video ya está en el servidor, así que solo
    se loguea y se sigue — nunca debe tirar abajo el loop principal por esto."""
    folder_uri = cfg.get("SAF_BACKUP_DIR_URI", "").strip()
    if not folder_uri:
        return

    filename = f"{match_id}.mp4"
    create_res = run(["termux-saf-create", "-t", "video/mp4", folder_uri, filename])
    if create_res.returncode != 0:
        log("uploader", f"Respaldo a SD de {match_id}: no se pudo crear el archivo ({create_res.stderr.strip()})")
        return

    doc_uri = create_res.stdout.strip()
    if not doc_uri:
        log("uploader", f"Respaldo a SD de {match_id}: termux-saf-create no devolvió una URI.")
        return

    try:
        with open(clip_path, "rb") as f:
            write_res = subprocess.run(["termux-saf-write", doc_uri], stdin=f, capture_output=True)
    except Exception as exc:
        log("uploader", f"Respaldo a SD de {match_id}: error copiando el archivo ({exc!r})")
        return

    if write_res.returncode != 0:
        stderr = write_res.stderr.decode(errors="replace").strip() if write_res.stderr else ""
        log("uploader", f"Respaldo a SD de {match_id}: termux-saf-write falló ({stderr})")
        return

    log("uploader", f"Respaldo a SD de {match_id} copiado OK.")


def cleanup_old_segments(recordings_dir: Path, retention_hours: float) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=retention_hours)
    for start, path in list_segments(recordings_dir):
        if start < cutoff:
            path.unlink(missing_ok=True)


def cleanup_stale_tmp_files(tmp_dir: Path, max_age_hours: float = 2.0) -> None:
    """Red de seguridad además del cleanup explícito en build_clip(): borra cualquier archivo
    de trabajo (*.joined.mp4, *.concat.txt, *.mp4 sueltos) que haya quedado en TMP_DIR por más
    de max_age_hours. En uso normal esta carpeta debería vaciarse sola en cada vuelta; esto
    cubre el caso de que el proceso se corte a mitad de un build_clip() y deje algo colgado."""
    if not tmp_dir.exists():
        return
    cutoff = time.time() - max_age_hours * 3600
    for path in tmp_dir.glob("*"):
        try:
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
        except OSError:
            continue


def process_once(cfg: dict) -> None:
    recordings_dir = Path(cfg["RECORDINGS_DIR"])
    tmp_dir = Path(cfg["TMP_DIR"])
    segment_seconds = int(cfg["SEGMENT_SECONDS"])
    buffer_minutes = int(cfg["BUFFER_MINUTES"])

    cleanup_old_segments(recordings_dir, float(cfg["RETENTION_HOURS"]))
    cleanup_stale_tmp_files(tmp_dir)

    pending = fetch_pending_matches(cfg)
    if not pending:
        log("uploader", "Sin partidos pendientes de video para esta cancha.")
        return

    segments = list_segments(recordings_dir)
    log("uploader", f"{len(pending)} partido(s) pendiente(s), {len(segments)} segmento(s) grabados localmente.")

    for match in pending:
        match_id = match["id"]
        window_start = parse_iso(match["startTime"])
        window_end = parse_iso(match["endTime"]) if match.get("endTime") else window_start + timedelta(minutes=buffer_minutes)

        covering = segments_for_window(segments, window_start, window_end, segment_seconds)
        if covering is None:
            log("uploader", f"Partido {match_id}: todavía no hay grabación local que cubra ese horario, se reintenta luego.")
            continue

        clip = build_clip(covering, window_start, window_end, tmp_dir, match_id)
        if clip is None:
            continue

        try:
            uploaded = upload_clip(cfg, match_id, clip)
            if uploaded:
                archive_to_sd(cfg, match_id, clip)
        finally:
            clip.unlink(missing_ok=True)


def main() -> None:
    cfg = load_config()
    poll_seconds = int(cfg["POLL_SECONDS"])
    log("uploader", f"Arrancando loop de subida (cada {poll_seconds}s) contra {cfg['LIVEPLAY_API_BASE']}")
    while True:
        try:
            process_once(cfg)
        except Exception as exc:  # nunca queremos que el loop se muera solo, esto corre para siempre
            log("uploader", f"Error inesperado en esta vuelta (se sigue igual): {exc!r}")
        time.sleep(poll_seconds)


if __name__ == "__main__":
    main()
