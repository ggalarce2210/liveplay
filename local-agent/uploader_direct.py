#!/usr/bin/env python3
"""
Agente local de LivePlay — "Escenario B" (ver ../backend/AGENTE.md, sección del mismo
nombre): en vez de subir el video crudo del partido a POST /agent/matches/:id/video (lo que
hace uploader.py, y lo que dispara TODO el pipeline de FFmpeg del lado del backend), este
script corre ese mismo pipeline ACÁ MISMO — en el mini-PC de la cancha — y sube los archivos
ya procesados (HLS + thumbnails) directo a storage (R2/S3) con URLs firmadas de un solo uso,
sin que el video pase ni un segundo por el backend. Pensado para complejos con un mini-PC con
CPU/disco de sobra (no un TV box Android limitado), donde conviene gastar esa CPU local en vez
del ancho de banda/CPU del backend en Render.

Cada POLL_SECONDS:
  1. Primero RETOMA cualquier partido que haya quedado a medio subir de una vuelta anterior
     (el proceso se cortó, se reinició la PC, falló una subida puntual, etc. — ver
     "STATE_DIR" más abajo, es la pieza central de por qué este modo no pierde nada a mitad
     de camino).
  2. Recién después pregunta al backend (GET /agent/matches/pending) qué partidos NUEVOS de
     esta cancha ya terminaron y no tienen video — para cada uno: arma el clip exacto del
     partido (build_clip, igual que uploader.py), corre FFmpeg LOCAL para generar HLS +
     sprite de miniaturas + poster (réplica exacta de generateHls/generateThumbnailSprite/
     generatePoster en backend/src/video-processing/ffmpeg.service.ts — ver el comentario
     largo en FfmpegService para el porqué de cada flag), y arranca la subida.

Por qué hace falta STATE_DIR (a diferencia de uploader.py, que no necesita nada parecido):
`POST /agent/matches/:id/upload-plan` ya le avisa al backend "este partido está en
PROCESSING" — a partir de ahí, ESE partido deja de aparecer en /agent/matches/pending (ver
AgentService.pendingMatches: solo lista partidos sin video o con video FAILED). Si este script
se cortara en el medio y no guardara nada en disco, el partido quedaría colgado en PROCESSING
para siempre, sin que ningún mecanismo lo vuelva a intentar solo. STATE_DIR (dentro de
TMP_DIR/direct-uploads/<matchId>/) es la memoria local que permite retomar exactamente donde
quedó: los archivos HLS/thumbs ya generados (no hay que correr FFmpeg de nuevo), el upload-plan
ya pedido (con sus URLs firmadas), y qué archivos ya se subieron con éxito — todo persistido a
disco después de cada paso, así una caída a mitad de camino pierde como mucho el paso que
estaba a medio terminar, nunca el trabajo de FFmpeg ya hecho ni las subidas ya confirmadas.

Solo depende de la biblioteca estándar de Python + los binarios "ffmpeg"/"ffprobe"/"curl" del
sistema (mismo criterio que uploader.py — ver ese archivo).
"""
from __future__ import annotations

import json
import math
import shutil
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

# Mismos valores que backend/src/video-processing/ffmpeg.service.ts — si el backend cambia
# alguno de estos, este script tiene que cambiar junto (no hay forma de compartir el archivo
# TypeScript con Python, así que queda documentado acá el "original" al que hay que mirar).
SEGMENT_TARGET_SECONDS = 6  # FfmpegService.SEGMENT_TARGET_SECONDS
THUMB_COLUMNS = 10
THUMB_ROWS = 10
THUMB_TILE_WIDTH = 160
THUMB_MIN_INTERVAL_SECONDS = 5
POSTER_AT_SECONDS = 3

STATE_SUBDIR = "direct-uploads"  # TMP_DIR/direct-uploads/<matchId>/ — ver comentario de arriba
UPLOAD_URL_TTL_SECONDS = 60 * 60  # tiene que coincidir con AgentService.UPLOAD_URL_TTL_SECONDS
# Si el upload-plan tiene más de esto (en segundos) de antigüedad, se pide uno nuevo antes de
# seguir subiendo — deja 15 min de margen sobre el vencimiento real (1h) para una conexión
# lenta/un partido con muchos segmentos no se quede sin URL válida a mitad de subida.
UPLOAD_URL_REFRESH_AFTER_SECONDS = UPLOAD_URL_TTL_SECONDS - 15 * 60


# ──────────────────────────────────────────────────────────────
# FFmpeg: réplica de backend/src/video-processing/ffmpeg.service.ts
# ──────────────────────────────────────────────────────────────

def probe(input_path: Path) -> dict:
    """Réplica de FfmpegService.probe."""
    result = run([
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,codec_name",
        "-show_entries", "format=duration",
        "-of", "json",
        str(input_path),
    ])
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe falló sobre {input_path}: {result.stderr[-500:]}")
    data = json.loads(result.stdout)
    streams = data.get("streams") or [{}]
    stream = streams[0]
    frame_rate = str(stream.get("r_frame_rate") or "25/1")
    num_str, _, den_str = frame_rate.partition("/")
    num = float(num_str or 25)
    den = float(den_str) if den_str else 0.0
    fps = (num / den) if den else num
    return {
        "duration_seconds": float((data.get("format") or {}).get("duration") or 0),
        "width": int(stream.get("width") or 0),
        "height": int(stream.get("height") or 0),
        "fps": fps,
        "video_codec": stream.get("codec_name") or "",
    }


def _parse_segments_from_manifest(manifest_path: Path) -> list[dict]:
    """Réplica de FfmpegService.parseSegmentsFromManifest: lee el .m3u8 recién generado y
    reconstruye offsets acumulados por segmento (lo que después va a videoSegments)."""
    lines = manifest_path.read_text(encoding="utf-8").splitlines()
    segments: list[dict] = []
    cursor = 0.0
    index = 0
    for i, raw_line in enumerate(lines):
        line = raw_line.strip()
        if line.startswith("#EXTINF:"):
            duration = float(line.replace("#EXTINF:", "").replace(",", ""))
            file_name = lines[i + 1].strip() if i + 1 < len(lines) else ""
            if file_name and not file_name.startswith("#"):
                segments.append({
                    "index": index,
                    "start_offset_seconds": cursor,
                    "end_offset_seconds": cursor + duration,
                    "duration_seconds": duration,
                    "file_name": file_name,
                })
                cursor += duration
                index += 1
    return segments


def generate_hls(input_path: Path, output_dir: Path, probe_result: dict) -> tuple[str, list[dict]]:
    """Réplica de FfmpegService.generateHls — incluyendo la decisión -c:v copy vs. libx264
    según el codec real de origen (ver el comentario largo en el .ts original: con una cámara
    que grabe HEVC/H.265 en vez de H.264, copiar el video tal cual deja el navegador sin poder
    decodificarlo — pantalla negra). En "Los Pinos" la cámara real graba H.264, así que en la
    práctica esto siempre toma la rama -c:v copy, pero se deja la detección completa para no
    depender de que eso nunca cambie (otra cámara, otro complejo con este mismo script)."""
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_file = "master.m3u8"
    segment_pattern = "segment_%05d.ts"

    needs_transcode = probe_result["video_codec"] != "h264"
    video_args = (
        ["-c:v", "libx264", "-preset", "veryfast", "-threads", "1"] if needs_transcode else ["-c:v", "copy"]
    )
    if needs_transcode:
        log("uploader-direct", f'Video de origen en codec "{probe_result["video_codec"]}" (no H.264) — re-codificando a libx264.')

    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_path),
        *video_args,
        "-c:a", "aac",
        "-b:a", "128k",
        "-start_number", "0",
        "-hls_time", str(SEGMENT_TARGET_SECONDS),
        "-hls_playlist_type", "vod",
        "-hls_flags", "independent_segments",
        "-hls_segment_filename", str(output_dir / segment_pattern),
        str(output_dir / manifest_file),
    ]
    result = run(cmd)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg generateHls falló: {result.stderr[-800:]}")

    segments = _parse_segments_from_manifest(output_dir / manifest_file)
    return manifest_file, segments


def _to_vtt_time(total_seconds: float) -> str:
    """Réplica EXACTA de FfmpegService.toVttTime (incluyendo el padding: `toFixed(3).padStart(6,
    '0')` en TS es equivalente a f"{s:06.3f}" en Python para cualquier duración de partido real)."""
    h = int(total_seconds // 3600)
    m = int((total_seconds % 3600) // 60)
    s = total_seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def generate_thumbnail_sprite(input_path: Path, output_dir: Path, duration_seconds: float) -> tuple[str, str]:
    """Réplica de FfmpegService.generateThumbnailSprite — incluyendo el cálculo dinámico del
    intervalo entre miniaturas (bug real del 2026-10-01 documentado en el .ts original: con un
    intervalo fijo, un partido largo generaba más frames que columns*rows y FFmpeg se rompía
    intentando escribir una segunda imagen al mismo nombre fijo)."""
    output_dir.mkdir(parents=True, exist_ok=True)
    sprite_file = "sprite.jpg"
    vtt_file = "thumbnails.vtt"
    tile_height = round(THUMB_TILE_WIDTH * 9 / 16)
    max_tiles = THUMB_COLUMNS * THUMB_ROWS

    interval = max(THUMB_MIN_INTERVAL_SECONDS, duration_seconds / max_tiles if max_tiles else THUMB_MIN_INTERVAL_SECONDS)

    cmd = [
        "ffmpeg", "-y",
        "-i", str(input_path),
        "-vf", f"fps=1/{interval},scale={THUMB_TILE_WIDTH}:-1,tile={THUMB_COLUMNS}x{THUMB_ROWS}",
        "-q:v", "4",
        str(output_dir / sprite_file),
    ]
    result = run(cmd)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg generateThumbnailSprite falló: {result.stderr[-800:]}")

    total_tiles = min(max_tiles, math.ceil(duration_seconds / interval)) if interval else 0
    vtt_lines = ["WEBVTT", ""]
    for i in range(total_tiles):
        start = i * interval
        end = min(start + interval, duration_seconds)
        col = i % THUMB_COLUMNS
        row = i // THUMB_COLUMNS
        vtt_lines.append(f"{_to_vtt_time(start)} --> {_to_vtt_time(end)}")
        vtt_lines.append(f"{sprite_file}#xywh={col * THUMB_TILE_WIDTH},{row * tile_height},{THUMB_TILE_WIDTH},{tile_height}")
        vtt_lines.append("")
    (output_dir / vtt_file).write_text("\n".join(vtt_lines), encoding="utf-8")
    return sprite_file, vtt_file


def generate_poster(input_path: Path, output_path: Path, at_seconds: float = POSTER_AT_SECONDS) -> bool:
    """Réplica de FfmpegService.generatePoster. "Lindo tener", no crítico — igual que en el
    backend, si falla no tira abajo el resto del partido (la tarjeta cae al ícono genérico)."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-ss", str(at_seconds), "-i", str(input_path), "-frames:v", "1", "-q:v", "3", str(output_path)]
    result = run(cmd)
    if result.returncode != 0 or not output_path.exists():
        log("uploader-direct", f"No se pudo generar el poster (no crítico): {result.stderr[-300:]}")
        return False
    return True


# ──────────────────────────────────────────────────────────────
# HTTP contra el backend: upload-plan / PUT a storage / finalize
# ──────────────────────────────────────────────────────────────

def _curl_json(cfg: dict, method: str, path: str, payload: dict) -> dict:
    url = f"{cfg['LIVEPLAY_API_BASE']}{path}"
    body = json.dumps(payload)
    result = run([
        "curl", "-sS", "-o", "-", "-w", "\n%{http_code}",
        "-X", method,
        "-H", f"X-Agent-Key: {cfg['AGENT_KEY']}",
        "-H", "Content-Type: application/json",
        "--data-binary", body,
        url,
    ])
    if result.returncode != 0:
        raise RuntimeError(f"curl falló contra {path}: {result.stderr.strip()}")
    *body_lines, status_code = result.stdout.rsplit("\n", 1)
    status_code = status_code.strip()
    response_body = "".join(body_lines)
    if not status_code.startswith("2"):
        raise RuntimeError(f"{method} {path} devolvió HTTP {status_code}: {response_body[:500]}")
    try:
        return json.loads(response_body) if response_body else {}
    except json.JSONDecodeError:
        raise RuntimeError(f"{method} {path} devolvió una respuesta no-JSON: {response_body[:300]!r}")


def request_upload_plan(cfg: dict, match_id: str, relative_paths: list[str]) -> dict:
    """POST /agent/matches/:id/upload-plan — ver AgentService.createUploadPlan. El Content-Type
    de cada URL firmada lo decide y devuelve EL BACKEND (nunca lo inventamos acá): para el
    driver S3/R2 real, ese Content-Type quedó firmado dentro de la URL — mandar uno distinto en
    el PUT rompe la firma (SignatureDoesNotMatch), así que `put_file` más abajo usa siempre el
    valor que vino en esta respuesta, nunca uno calculado localmente."""
    payload = {"files": [{"relativePath": p} for p in relative_paths]}
    return _curl_json(cfg, "POST", f"/agent/matches/{match_id}/upload-plan", payload)


def put_file(url: str, local_path: Path, content_type: str) -> None:
    result = run([
        "curl", "-sS", "-o", "-", "-w", "\n%{http_code}",
        "-T", str(local_path),
        "-H", f"Content-Type: {content_type}",
        "-H", "Expect:",  # evita el "100-continue" de curl en archivos grandes — algunos
                          # proveedores S3-compatibles no lo manejan bien con URLs firmadas.
        url,
    ])
    if result.returncode != 0:
        raise RuntimeError(f"curl falló subiendo {local_path.name}: {result.stderr.strip()}")
    *body_lines, status_code = result.stdout.rsplit("\n", 1)
    status_code = status_code.strip()
    if not status_code.startswith("2"):
        raise RuntimeError(f"PUT de {local_path.name} devolvió HTTP {status_code}: {''.join(body_lines)[:300]}")


def request_finalize(cfg: dict, match_id: str, payload: dict) -> dict:
    """POST /agent/matches/:id/finalize — ver AgentService.finalizeDirectUpload."""
    return _curl_json(cfg, "POST", f"/agent/matches/{match_id}/finalize", payload)


# ──────────────────────────────────────────────────────────────
# Estado persistido en disco (STATE_DIR) — qué hace que este modo sea resumible
# ──────────────────────────────────────────────────────────────

def _state_dir(tmp_dir: Path, match_id: str) -> Path:
    return tmp_dir / STATE_SUBDIR / match_id


def _write_meta(state_dir: Path, meta: dict) -> None:
    tmp_file = state_dir / "meta.json.tmp"
    tmp_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    tmp_file.replace(state_dir / "meta.json")  # replace es atómico — nunca deja meta.json a medio escribir


def _read_meta(state_dir: Path) -> dict | None:
    meta_path = state_dir / "meta.json"
    if not meta_path.exists():
        return None
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def build_and_plan_match(cfg: dict, match: dict, covering, window_start, window_end, tmp_dir: Path) -> None:
    """Primera vez que se ve este partido: arma el clip, corre FFmpeg local, pide el
    upload-plan, y deja todo guardado en STATE_DIR — a partir de acá `upload_and_finalize`
    puede reintentar las veces que haga falta sin volver a tocar FFmpeg ni las raw segments."""
    match_id = match["id"]
    state_dir = _state_dir(tmp_dir, match_id)
    state_dir.mkdir(parents=True, exist_ok=True)
    hls_dir = state_dir / "hls"
    thumbs_dir = state_dir / "thumbs"

    clip_tmp_dir = tmp_dir  # build_clip ya arma sus propios nombres temporales acá
    clip = build_clip(covering, window_start, window_end, clip_tmp_dir, match_id)
    if clip is None:
        shutil.rmtree(state_dir, ignore_errors=True)
        return

    try:
        probe_result = probe(clip)
        manifest_file, segments = generate_hls(clip, hls_dir, probe_result)
        sprite_file, vtt_file = generate_thumbnail_sprite(clip, thumbs_dir, probe_result["duration_seconds"])
        has_poster = generate_poster(clip, thumbs_dir / "poster.jpg")
    finally:
        clip.unlink(missing_ok=True)

    relative_paths = [f"hls/{manifest_file}"] + [f"hls/{s['file_name']}" for s in segments] + [f"thumbs/{sprite_file}", f"thumbs/{vtt_file}"]
    if has_poster:
        relative_paths.append("thumbs/poster.jpg")

    size_bytes = sum((hls_dir / s["file_name"]).stat().st_size for s in segments)
    size_bytes += (thumbs_dir / sprite_file).stat().st_size

    plan = request_upload_plan(cfg, match_id, relative_paths)

    meta = {
        "match_id": match_id,
        "plan_requested_at": time.time(),
        "uploads": plan["uploads"],  # [{relativePath, key, contentType, url, expiresInSeconds}]
        "uploaded_relative_paths": [],
        "manifest_relative_path": f"hls/{manifest_file}",
        "sprite_relative_path": f"thumbs/{sprite_file}",
        "vtt_relative_path": f"thumbs/{vtt_file}",
        "poster_relative_path": "thumbs/poster.jpg" if has_poster else None,
        "segments": [
            {
                "index": s["index"],
                "startOffsetSeconds": s["start_offset_seconds"],
                "endOffsetSeconds": s["end_offset_seconds"],
                "durationSeconds": s["duration_seconds"],
                "relativePath": f"hls/{s['file_name']}",
            }
            for s in segments
        ],
        "duration_seconds": probe_result["duration_seconds"],
        "width": probe_result["width"] or None,
        "height": probe_result["height"] or None,
        "fps": probe_result["fps"] or None,
        "size_bytes": size_bytes,
    }
    _write_meta(state_dir, meta)
    log("uploader-direct", f"Partido {match_id}: FFmpeg local listo ({len(segments)} segmentos, {probe_result['duration_seconds']:.1f}s) y upload-plan obtenido.")


def upload_and_finalize(cfg: dict, state_dir: Path) -> bool:
    """Sube (los archivos que falten) y llama a finalize. Devuelve True si el partido quedó
    cerrado (éxito, o un error que no tiene sentido reintentar) y por lo tanto STATE_DIR se
    puede borrar; False si hay que reintentar en la próxima vuelta (p. ej. una subida puntual
    falló por la red)."""
    meta = _read_meta(state_dir)
    if meta is None:
        log("uploader-direct", f"{state_dir.name}: STATE_DIR sin meta.json legible — se descarta (no hay forma de recuperarlo).")
        return True
    match_id = meta["match_id"]

    # Las URLs firmadas vencen en 1h (UPLOAD_URL_TTL_SECONDS) — si ya pasó demasiado desde que
    # se pidió el plan, se pide uno nuevo (mismos relativePath, misma key en storage: pedir de
    # nuevo no duplica nada) antes de seguir subiendo lo que falte.
    plan_age = time.time() - meta["plan_requested_at"]
    if plan_age > UPLOAD_URL_REFRESH_AFTER_SECONDS:
        log("uploader-direct", f"Partido {match_id}: upload-plan de hace {plan_age/60:.0f} min, pidiendo uno nuevo antes de seguir.")
        relative_paths = [u["relativePath"] for u in meta["uploads"]]
        plan = request_upload_plan(cfg, match_id, relative_paths)
        meta["uploads"] = plan["uploads"]
        meta["plan_requested_at"] = time.time()
        _write_meta(state_dir, meta)

    already_uploaded = set(meta["uploaded_relative_paths"])
    pending_uploads = [u for u in meta["uploads"] if u["relativePath"] not in already_uploaded]

    for upload in pending_uploads:
        local_path = state_dir / upload["relativePath"]
        if not local_path.exists():
            log("uploader-direct", f"Partido {match_id}: falta en disco {upload['relativePath']} — STATE_DIR corrupto/incompleto, se descarta.")
            return True
        try:
            put_file(upload["url"], local_path, upload["contentType"])
        except RuntimeError as exc:
            log("uploader-direct", f"Partido {match_id}: {exc} — se reintenta en la próxima vuelta.")
            return False
        meta["uploaded_relative_paths"].append(upload["relativePath"])
        _write_meta(state_dir, meta)  # persistido archivo por archivo: un corte a mitad de subida no repite lo ya confirmado

    finalize_payload = {
        "manifestRelativePath": meta["manifest_relative_path"],
        "spriteRelativePath": meta["sprite_relative_path"],
        "vttRelativePath": meta["vtt_relative_path"],
        "segments": meta["segments"],
        "durationSeconds": meta["duration_seconds"],
        "sizeBytes": meta["size_bytes"],
    }
    if meta.get("poster_relative_path"):
        finalize_payload["posterRelativePath"] = meta["poster_relative_path"]
    if meta.get("width"):
        finalize_payload["width"] = meta["width"]
    if meta.get("height"):
        finalize_payload["height"] = meta["height"]
    if meta.get("fps"):
        finalize_payload["fps"] = meta["fps"]

    try:
        result = request_finalize(cfg, match_id, finalize_payload)
    except RuntimeError as exc:
        log("uploader-direct", f"Partido {match_id}: finalize falló ({exc}) — se reintenta en la próxima vuelta.")
        return False

    warning = " (ADVERTENCIA: durationWarning=true, revisar si la grabación quedó incompleta)" if result.get("durationWarning") else ""
    log("uploader-direct", f"Partido {match_id}: subido y finalizado OK{warning}.")
    return True


def process_once(cfg: dict) -> None:
    recordings_dir = Path(cfg["RECORDINGS_DIR"])
    tmp_dir = Path(cfg["TMP_DIR"])
    segment_seconds = int(cfg["SEGMENT_SECONDS"])
    buffer_minutes = int(cfg["BUFFER_MINUTES"])
    state_root = tmp_dir / STATE_SUBDIR
    state_root.mkdir(parents=True, exist_ok=True)

    cleanup_old_segments(recordings_dir, float(cfg["RETENTION_HOURS"]))
    cleanup_stale_tmp_files(tmp_dir, skip_dirs=(STATE_SUBDIR,))

    # 1) Primero retomar lo que haya quedado a medio subir — ver comentario grande al principio
    # del archivo sobre por qué esto no puede esperar a que el partido reaparezca en /pending.
    in_flight = [d for d in state_root.iterdir() if d.is_dir()] if state_root.exists() else []
    if in_flight:
        log("uploader-direct", f"Retomando {len(in_flight)} partido(s) con subida directa a medio terminar.")
    for state_dir in in_flight:
        if upload_and_finalize(cfg, state_dir):
            shutil.rmtree(state_dir, ignore_errors=True)

    # 2) Recién ahora, partidos nuevos.
    pending = fetch_pending_matches(cfg)
    if not pending:
        log("uploader-direct", "Sin partidos pendientes de video para esta cancha.")
        return

    segments = list_segments(recordings_dir)
    log("uploader-direct", f"{len(pending)} partido(s) pendiente(s), {len(segments)} segmento(s) grabados localmente.")

    for match in pending:
        match_id = match["id"]
        if _state_dir(tmp_dir, match_id).exists():
            continue  # ya se le armó un plan de subida en este mismo ciclo (arriba) o en uno anterior

        window_start = parse_iso(match["startTime"])
        window_end = parse_iso(match["endTime"]) if match.get("endTime") else window_start + timedelta(minutes=buffer_minutes)

        covering = segments_for_window(segments, window_start, window_end, segment_seconds)
        if covering is None:
            log("uploader-direct", f"Partido {match_id}: todavía no hay grabación local que cubra ese horario, se reintenta luego.")
            continue

        try:
            build_and_plan_match(cfg, match, covering, window_start, window_end, tmp_dir)
        except RuntimeError as exc:
            log("uploader-direct", f"Partido {match_id}: falló la generación local ({exc}) — se reintenta en la próxima vuelta.")
            shutil.rmtree(_state_dir(tmp_dir, match_id), ignore_errors=True)
            continue

        state_dir = _state_dir(tmp_dir, match_id)
        if state_dir.exists() and upload_and_finalize(cfg, state_dir):
            shutil.rmtree(state_dir, ignore_errors=True)


def main() -> None:
    cfg = load_config()
    poll_seconds = int(cfg["POLL_SECONDS"])
    log("uploader-direct", f"Arrancando loop de subida DIRECTA (cada {poll_seconds}s) contra {cfg['LIVEPLAY_API_BASE']}")
    while True:
        try:
            process_once(cfg)
        except Exception as exc:  # nunca queremos que el loop se muera solo, esto corre para siempre
            log("uploader-direct", f"Error inesperado en esta vuelta (se sigue igual): {exc!r}")
        time.sleep(poll_seconds)


if __name__ == "__main__":
    main()
