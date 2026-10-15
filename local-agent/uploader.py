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

Las funciones de bajo nivel compartidas con uploader_direct.py (modo "Escenario B", ver
backend/AGENTE.md) viven en agent_lib.py — ver el comentario ahí para el motivo.
"""
from __future__ import annotations

import subprocess
import time
from datetime import timedelta
from pathlib import Path

from agent_lib import (
    build_clip,
    cleanup_old_segments,
    cleanup_stale_tmp_files,
    fetch_pending_matches,
    list_segments,
    load_config,
    log,
    parse_iso,
    run,
    segments_for_window,
)


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
