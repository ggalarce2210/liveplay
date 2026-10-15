#!/usr/bin/env python3
"""
Funciones compartidas por uploader.py (modo legacy/puente, sube el video crudo a
POST /agent/matches/:id/video) y uploader_direct.py (modo "Escenario B", corre FFmpeg acá
mismo y sube directo a storage — ver backend/AGENTE.md).

Extraído el 2026-10-15 de lo que antes vivía solo dentro de uploader.py, por el mismo motivo
que backend/src/matches/storage-key.util.ts se extrajo de MatchesService: todo lo de acá
abajo (en particular list_segments/segments_for_window/build_clip) tiene que comportarse
EXACTAMENTE igual sea cual sea el modo de subida, porque los dos leen la MISMA carpeta de
segmentos crudos que graba record.sh — si algún día diverge un bugfix entre los dos (como el
de "Bug real encontrado el 2026-10-01" en build_clip, más abajo), un modo queda arreglado y el
otro no, sin que nadie lo note hasta que falla en producción. uploader.py y uploader_direct.py
importan todo esto de acá en vez de tener cada uno su propia copia.

Solo depende de la biblioteca estándar de Python (ver motivo en uploader.py).
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


def load_config(required: list[str] | None = None) -> dict:
    """Lee config.env (formato KEY=VALUE, con soporte básico de $HOME) sin depender de bash.

    `required` deja que cada script (uploader.py / uploader_direct.py) pida además las
    variables que SOLO él necesita, sin forzar al otro modo a tenerlas completas en su
    config.env (ej. uploader_direct.py no necesita nada que uploader.py no necesite también,
    hoy, pero esto queda preparado por si algún día sí)."""
    path = AGENT_DIR / "config.env"
    if not path.exists():
        log("agent", f"No existe {path} — copiá config.example.env a config.env y completalo.")
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

    base_required = ["LIVEPLAY_API_BASE", "AGENT_KEY", "RECORDINGS_DIR", "TMP_DIR", "LOG_DIR"]
    all_required = base_required + [k for k in (required or []) if k not in base_required]
    missing = [k for k in all_required if not cfg.get(k)]
    if missing:
        log("agent", f"Faltan variables en config.env: {', '.join(missing)}")
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
        log("agent", f"No se pudo consultar /agent/matches/pending: {result.stderr.strip()}")
        return []
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        log("agent", f"Respuesta no-JSON de /agent/matches/pending: {result.stdout[:300]!r}")
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
        log("agent", f"ffmpeg concat falló para {match_id}: {joined_res.stderr[-500:]}")
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
        log("agent", f"ffmpeg trim falló para {match_id}: {trim_res.stderr[-500:]}")
        return None

    return trimmed


def cleanup_old_segments(recordings_dir: Path, retention_hours: float) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=retention_hours)
    for start, path in list_segments(recordings_dir):
        if start < cutoff:
            path.unlink(missing_ok=True)


def cleanup_stale_tmp_files(tmp_dir: Path, max_age_hours: float = 2.0, skip_dirs: tuple[str, ...] = ()) -> None:
    """Red de seguridad además del cleanup explícito en build_clip(): borra cualquier archivo
    de trabajo (*.joined.mp4, *.concat.txt, *.mp4 sueltos) que haya quedado en TMP_DIR por más
    de max_age_hours. En uso normal esta carpeta debería vaciarse sola en cada vuelta; esto
    cubre el caso de que el proceso se corte a mitad de un build_clip() y deje algo colgado.

    `skip_dirs`: nombres de subcarpetas de TMP_DIR a NO tocar (ej. uploader_direct.py guarda
    ahí el estado de subidas en curso — direct-uploads/ — que vive a propósito más de
    max_age_hours mientras un partido grande todavía se está subiendo)."""
    if not tmp_dir.exists():
        return
    cutoff = time.time() - max_age_hours * 3600
    for path in tmp_dir.glob("*"):
        if path.is_dir():
            if path.name not in skip_dirs:
                continue
            continue
        try:
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
        except OSError:
            continue
