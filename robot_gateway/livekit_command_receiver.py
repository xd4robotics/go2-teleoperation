#!/usr/bin/env python3
"""Recebe comandos do painel pela sala LiveKit e os executa no gateway local."""

import argparse
import base64
import json
import math
import os
import re
import signal
import subprocess
import time
from collections import deque
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import UUID


COMMAND_TOPIC = "go2.command"
AUDIO_TOPIC = "go2.audio"
AUDIO_SESSION_TIMEOUT_SECONDS = 12.0
AUDIO_BLOCK_SIZE = 14_000
AUDIO_EXIT_DELAY_SECONDS = 0.65
MAX_AUDIO_BLOCKS = 1_024
MAX_AUDIO_PLAYBACK_SECONDS = 35.0
# Uma gravação de 30 s publicada por clientes antigos pode permanecer na fila
# confiável do LiveKit enquanto o DDS entrega os blocos ao AudioHub. O request
# continua autenticado pelo participante e protegido contra repetição pelo UUID.
AUDIO_PACKET_MAX_QUEUE_AGE_MS = 120_000
ASSET_DIRECTORY = Path(__file__).resolve().parent / "assets"
CALL_CONNECTED_WAV = ASSET_DIRECTORY / "call-connected.wav"
CALL_ENDED_WAV = ASSET_DIRECTORY / "call-ended.wav"
CALL_ENDED_EXIT_DELAY_SECONDS = 0.55
ALLOWED_COMMANDS = {
    "diagnostic_ping",
    "move_analog",
    "forward",
    "backward",
    "rotate_left",
    "rotate_right",
    "stand_up",
    "stand_down",
    "recovery_stand",
    "arm",
    "disarm",
    "set_speed",
    "set_obstacle_avoidance",
    "damping",
    "reset_map",
    "save_map",
    "calibrate_docking_station",
    "start_docking",
    "cancel_docking",
    "stop",
    "emergency_stop",
}
DATA_PATTERN = re.compile(r'"data"\s*:\s*"([A-Za-z0-9+/=]+)"')
PARTICIPANT_PATTERN = re.compile(r'"participant"\s*:\s*"([^"]*)"')


def decode_received_line(line):
    if "received data" not in line:
        return None, ""
    data_match = DATA_PATTERN.search(line)
    if not data_match:
        return None, ""
    participant_match = PARTICIPANT_PATTERN.search(line)
    participant = participant_match.group(1) if participant_match else ""
    try:
        payload = base64.b64decode(data_match.group(1), validate=True)
        return json.loads(payload.decode("utf-8")), participant
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return None, participant


def validate_command(message, participant, now_ms=None):
    if not isinstance(message, dict) or message.get("type") != "go2.command":
        raise ValueError("pacote não é um comando do Go2")
    if message.get("version") != 1 or message.get("robot_id") != "primary":
        raise ValueError("versão ou robô inválido")

    request_id = str(message.get("request_id", ""))
    UUID(request_id)
    user_id = str(message.get("user_id", ""))
    UUID(user_id)
    server_relay = message.get("server_relay") is True
    if not participant.startswith(user_id + "-") and not (
        server_relay and not participant
    ):
        raise ValueError("identidade do operador não confere")

    command = str(message.get("command", ""))
    if command not in ALLOWED_COMMANDS:
        raise ValueError("comando não permitido")
    if not isinstance(message.get("payload", {}), dict):
        raise ValueError("payload inválido")

    current_ms = int(time.time() * 1000) if now_ms is None else now_ms
    issued_at = int(message.get("issued_at", 0))
    expires_at = int(message.get("expires_at", 0))
    if issued_at > current_ms + 5_000 or current_ms > expires_at:
        raise ValueError("comando expirado")
    if expires_at - issued_at > 10_000:
        raise ValueError("validade do comando excedida")
    return request_id, command, message.get("payload", {})


def validate_audio_message(message, participant, now_ms=None):
    if not isinstance(message, dict) or message.get("type") != AUDIO_TOPIC:
        raise ValueError("pacote não é áudio do Go2")
    if message.get("version") != 1 or message.get("robot_id") != "primary":
        raise ValueError("versão ou robô inválido")

    request_id = str(message.get("request_id", ""))
    stream_id = str(message.get("stream_id", ""))
    UUID(request_id)
    UUID(stream_id)
    user_id = str(message.get("user_id", ""))
    UUID(user_id)
    if not participant.startswith(user_id + "-"):
        raise ValueError("identidade do operador não confere")

    state = str(message.get("state", ""))
    if state not in {"start", "chunk", "stop"}:
        raise ValueError("estado de áudio inválido")
    sequence = int(message.get("sequence", -1))
    if sequence < 0:
        raise ValueError("sequência de áudio inválida")
    data = message.get("data", "")
    clip_id = ""
    block_index = 0
    total_blocks = 0
    immediate = False
    audio_mode = ""
    if state == "start":
        audio_mode = str(message.get("mode", "recording"))
        if audio_mode not in {"recording", "call"}:
            raise ValueError("modo de áudio inválido")
    if state == "chunk":
        if not isinstance(data, str) or not data or len(data) > AUDIO_BLOCK_SIZE:
            raise ValueError("bloco de áudio inválido")
        clip_id = str(message.get("clip_id", ""))
        UUID(clip_id)
        block_index = int(message.get("current_block_index", 0))
        total_blocks = int(message.get("total_block_number", 0))
        if not 1 <= block_index <= total_blocks <= MAX_AUDIO_BLOCKS:
            raise ValueError("numeração do bloco de áudio inválida")
        try:
            block = base64.b64decode(data, validate=True)
        except (ValueError, TypeError) as error:
            raise ValueError("áudio não está em Base64") from error
        if block_index == 1 and (block[:4] != b"RIFF" or block[8:12] != b"WAVE"):
            raise ValueError("áudio não é WAV")
    elif data:
        raise ValueError("controle de áudio não pode conter dados")
    if state == "stop":
        immediate = message.get("immediate", False)
        if not isinstance(immediate, bool):
            raise ValueError("modo de encerramento de áudio inválido")

    current_ms = int(time.time() * 1000) if now_ms is None else now_ms
    issued_at = int(message.get("issued_at", 0))
    expires_at = int(message.get("expires_at", 0))
    if issued_at > current_ms + 5_000:
        raise ValueError("áudio expirado")
    if (
        expires_at < issued_at
        or expires_at - issued_at > AUDIO_PACKET_MAX_QUEUE_AGE_MS
        or current_ms - issued_at > AUDIO_PACKET_MAX_QUEUE_AGE_MS
    ):
        raise ValueError("validade do áudio excedida")
    return (
        request_id,
        stream_id,
        state,
        sequence,
        data,
        clip_id,
        block_index,
        total_blocks,
        immediate,
        audio_mode,
    )


def gateway_action(command, payload):
    if command == "diagnostic_ping":
        return None, None
    if command == "move_analog":
        axes = {}
        for name in ("forward", "lateral", "yaw"):
            value = payload.get(name)
            if isinstance(value, bool):
                raise ValueError("eixos do controle devem ficar entre -1 e 1")
            try:
                value = float(value)
            except (TypeError, ValueError) as error:
                raise ValueError(
                    "eixos do controle devem ficar entre -1 e 1"
                ) from error
            if not math.isfinite(value) or not -1.0 <= value <= 1.0:
                raise ValueError("eixos do controle devem ficar entre -1 e 1")
            axes[name] = value
        return "/api/control/joystick", axes
    if command in {"forward", "backward", "rotate_left", "rotate_right", "stop"}:
        return "/api/control/move", {"command": command}
    if command in {"stand_up", "stand_down", "recovery_stand"}:
        return "/api/control/posture", {"command": command}
    if command in {"arm", "disarm"}:
        return "/api/control/arm", {"armed": command == "arm"}
    if command == "set_speed":
        percent = int(payload.get("percent", 0))
        if not 10 <= percent <= 100:
            raise ValueError("velocidade fora da faixa de 10% a 100%")
        return "/api/control/speed", {"percent": percent}
    if command == "set_obstacle_avoidance":
        enabled = payload.get("enabled")
        if not isinstance(enabled, bool):
            raise ValueError("estado do anticolisão deve ser booleano")
        return "/api/control/obstacle-avoidance", {"enabled": enabled}
    if command == "damping":
        return "/api/control/damping", {}
    if command == "reset_map":
        return "/api/map/reset", {}
    if command == "save_map":
        return "/api/map/save", {}
    if command == "calibrate_docking_station":
        return "/api/docking/calibrate", {}
    if command == "start_docking":
        return "/api/docking/start", {}
    if command == "cancel_docking":
        return "/api/docking/cancel", {}
    if command == "emergency_stop":
        return "/api/control/stop", {}
    raise ValueError("comando não reconhecido")


def execute_gateway(base_url, gateway_key, command, payload, timeout):
    path, body = gateway_action(command, payload)
    if path is None:
        return {"status": "ok", "diagnostic": True}
    headers = {"Content-Type": "application/json"}
    if gateway_key:
        headers["X-Gateway-Key"] = gateway_key
    request = Request(
        base_url.rstrip("/") + path,
        data=json.dumps(body, separators=(",", ":")).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def execute_gateway_audio(base_url, gateway_key, action, data, timeout, **block):
    headers = {"Content-Type": "application/json"}
    if gateway_key:
        headers["X-Gateway-Key"] = gateway_key
    request = Request(
        base_url.rstrip("/") + "/api/audio/megaphone",
        data=json.dumps(
            {"action": action, "data": data, **block}, separators=(",", ":")
        ).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def play_call_cue(base_url, gateway_key, wav_path, timeout):
    encoded = base64.b64encode(wav_path.read_bytes()).decode("ascii")
    blocks = [
        encoded[offset : offset + AUDIO_BLOCK_SIZE]
        for offset in range(0, len(encoded), AUDIO_BLOCK_SIZE)
    ]
    for index, block in enumerate(blocks, start=1):
        execute_gateway_audio(
            base_url,
            gateway_key,
            "chunk",
            block,
            timeout,
            current_block_index=index,
            total_block_number=len(blocks),
        )
    return len(blocks)


def play_obstacle_avoidance_cue(
    base_url, gateway_key, enabled, timeout
):
    """Reproduz confirmação curta pelo AudioHub do Go2."""
    wav_path = CALL_CONNECTED_WAV if enabled else CALL_ENDED_WAV
    execute_gateway_audio(
        base_url, gateway_key, "start", "", timeout
    )
    try:
        return play_call_cue(
            base_url, gateway_key, wav_path, timeout
        )
    finally:
        execute_gateway_audio(
            base_url,
            gateway_key,
            "stop",
            "",
            timeout,
            delay_seconds=0.55,
        )


def join_command():
    return [
        "lk",
        "--project",
        os.environ.get("LIVEKIT_PROJECT", "go2"),
        "room",
        "join",
        "--identity",
        "go2-command-gateway",
        os.environ.get("LIVEKIT_ROOM_NAME", "go2-primary"),
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--gateway-url",
        default=os.environ.get("ROBOT_GATEWAY_URL", "http://127.0.0.1:8081"),
    )
    parser.add_argument(
        "--gateway-key",
        default=os.environ.get("ROBOT_GATEWAY_API_KEY", ""),
    )
    parser.add_argument("--timeout", type=float, default=3.0)
    args = parser.parse_args()

    stopping = False
    process = None
    seen_order = deque(maxlen=1_000)
    seen = set()
    active_audio_stream = None
    active_audio_participant = None
    active_audio_sequence = -1
    active_audio_last_seen = 0.0
    active_clip_id = None
    active_clip_total = 0
    active_clip_next_block = 1
    active_clip_bytes = 0
    active_audio_exit_delay = AUDIO_EXIT_DELAY_SECONDS
    active_audio_mode = None

    def stop(_signum=None, _frame=None):
        nonlocal stopping
        stopping = True
        if process and process.poll() is None:
            process.terminate()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    print("Controle remoto: LiveKit → gateway local do Go2", flush=True)

    while not stopping:
        try:
            process = subprocess.Popen(
                join_command(),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            for line in process.stdout:
                if stopping:
                    break
                message, participant = decode_received_line(line)
                if not isinstance(message, dict) or message.get("type") not in {
                    "go2.command",
                    AUDIO_TOPIC,
                }:
                    continue
                try:
                    if message.get("type") == AUDIO_TOPIC:
                        (
                            request_id,
                            stream_id,
                            state,
                            sequence,
                            data,
                            clip_id,
                            block_index,
                            total_blocks,
                            immediate,
                            audio_mode,
                        ) = validate_audio_message(message, participant)
                    else:
                        request_id, command, payload = validate_command(message, participant)
                    if request_id in seen:
                        continue
                    if len(seen_order) == seen_order.maxlen:
                        seen.discard(seen_order[0])
                    seen_order.append(request_id)
                    seen.add(request_id)
                    if message.get("type") == AUDIO_TOPIC:
                        if (
                            active_audio_stream
                            and time.monotonic() - active_audio_last_seen
                            > AUDIO_SESSION_TIMEOUT_SECONDS
                        ):
                            # Aba fechada, rede perdida ou navegador suspenso:
                            # libera o AudioHub para o próximo operador.
                            try:
                                execute_gateway_audio(
                                    args.gateway_url,
                                    args.gateway_key,
                                    "stop",
                                    "",
                                    args.timeout,
                                )
                            except (HTTPError, URLError, TimeoutError, OSError):
                                pass
                            active_audio_stream = None
                            active_audio_participant = None
                            active_audio_sequence = -1
                            active_audio_last_seen = 0.0
                            active_clip_id = None
                            active_clip_total = 0
                            active_clip_next_block = 1
                            active_clip_bytes = 0
                            active_audio_exit_delay = AUDIO_EXIT_DELAY_SECONDS
                            active_audio_mode = None
                        if state == "start":
                            if active_audio_stream and active_audio_stream != stream_id:
                                raise ValueError("outra transmissão de áudio já está ativa")
                            if active_audio_stream and active_audio_mode != audio_mode:
                                raise ValueError("modo da transmissão de áudio mudou")
                        elif (
                            stream_id != active_audio_stream
                            or participant != active_audio_participant
                            or sequence <= active_audio_sequence
                        ):
                            raise ValueError("sessão ou sequência de áudio inválida")
                        if state == "chunk":
                            if active_clip_id is None:
                                if block_index != 1:
                                    raise ValueError("primeiro bloco do áudio ausente")
                                active_clip_id = clip_id
                                active_clip_total = total_blocks
                                active_clip_next_block = 1
                                active_clip_bytes = 0
                            if (
                                clip_id != active_clip_id
                                or total_blocks != active_clip_total
                                or block_index != active_clip_next_block
                            ):
                                raise ValueError("ordem dos blocos de áudio inválida")
                        new_audio_session = state == "start" and active_audio_stream is None
                        if (
                            state == "stop"
                            and active_audio_mode == "call"
                        ):
                            cue_blocks = play_call_cue(
                                args.gateway_url,
                                args.gateway_key,
                                CALL_ENDED_WAV,
                                args.timeout,
                            )
                            print(
                                "Chamada finalizada: sinal sonoro enviado ao GO2 "
                                "(%d blocos)." % cue_blocks,
                                flush=True,
                            )
                        execute_gateway_audio(
                            args.gateway_url,
                            args.gateway_key,
                            state,
                            data,
                            args.timeout,
                            current_block_index=block_index,
                            total_block_number=total_blocks,
                            delay_seconds=(
                                CALL_ENDED_EXIT_DELAY_SECONDS
                                if state == "stop" and active_audio_mode == "call"
                                else 0.0
                                if state == "stop" and immediate
                                else active_audio_exit_delay
                                if state == "stop"
                                else 0.0
                            ),
                        )
                        if state == "start":
                            active_audio_stream = stream_id
                            active_audio_participant = participant
                            active_audio_mode = audio_mode
                            if new_audio_session and audio_mode == "call":
                                cue_blocks = play_call_cue(
                                    args.gateway_url,
                                    args.gateway_key,
                                    CALL_CONNECTED_WAV,
                                    args.timeout,
                                )
                                print(
                                    "Chamada iniciada: sinal sonoro enviado ao GO2 "
                                    "(%d blocos)." % cue_blocks,
                                    flush=True,
                                )
                            if new_audio_session:
                                print(
                                    "Áudio do operador iniciado (%s)." % audio_mode,
                                    flush=True,
                                )
                        elif state == "chunk":
                            active_clip_bytes += len(
                                base64.b64decode(data, validate=True)
                            )
                            active_clip_next_block += 1
                            if block_index == total_blocks:
                                # WAV PCM mono de 44,1 kHz e 16 bits. Mantém o
                                # AudioHub em modo megafone até o fim da fala,
                                # como faz a interface de referência da Unitree.
                                playback_seconds = max(
                                    0.0,
                                    (active_clip_bytes - 44) / (44_100 * 2),
                                )
                                active_audio_exit_delay = min(
                                    MAX_AUDIO_PLAYBACK_SECONDS,
                                    max(
                                        AUDIO_EXIT_DELAY_SECONDS,
                                        playback_seconds + 0.5,
                                    ),
                                )
                                print(
                                    "Trecho de voz enviado ao GO2 (%d blocos)."
                                    % total_blocks,
                                    flush=True,
                                )
                                active_clip_id = None
                                active_clip_total = 0
                                active_clip_next_block = 1
                                active_clip_bytes = 0
                        active_audio_sequence = sequence
                        active_audio_last_seen = time.monotonic()
                        if state == "stop":
                            active_audio_stream = None
                            active_audio_participant = None
                            active_audio_sequence = -1
                            active_audio_last_seen = 0.0
                            active_clip_id = None
                            active_clip_total = 0
                            active_clip_next_block = 1
                            active_clip_bytes = 0
                            active_audio_exit_delay = AUDIO_EXIT_DELAY_SECONDS
                            active_audio_mode = None
                            print("Áudio do operador encerrado.", flush=True)
                        continue
                    execute_gateway(
                        args.gateway_url,
                        args.gateway_key,
                        command,
                        payload,
                        args.timeout,
                    )
                    if (
                        command == "set_obstacle_avoidance"
                        and active_audio_stream is None
                    ):
                        try:
                            cue_blocks = play_obstacle_avoidance_cue(
                                args.gateway_url,
                                args.gateway_key,
                                bool(payload.get("enabled")),
                                args.timeout,
                            )
                            print(
                                "Confirmação sonora do anticolisão enviada "
                                "ao GO2 (%d blocos)." % cue_blocks,
                                flush=True,
                            )
                        except (
                            HTTPError,
                            URLError,
                            TimeoutError,
                            OSError,
                            ValueError,
                        ) as cue_error:
                            # A proteção já foi alterada com sucesso; falha no
                            # aviso sonoro não deve reclassificar o comando.
                            print(
                                "Anticolisão alterado, mas o aviso sonoro "
                                "falhou: %s" % cue_error,
                                flush=True,
                            )
                    if command not in {
                        "move_analog",
                        "forward",
                        "backward",
                        "rotate_left",
                        "rotate_right",
                    }:
                        print("Comando executado: %s" % command, flush=True)
                except (ValueError, HTTPError, URLError, TimeoutError, OSError) as error:
                    print("Comando recusado: %s" % error, flush=True)
            if process.poll() not in (0, -signal.SIGTERM) and not stopping:
                print("LiveKit desconectou; reconectando...", flush=True)
        except (OSError, subprocess.SubprocessError) as error:
            print("LiveKit indisponível: %s" % error, flush=True)
        if not stopping:
            time.sleep(2)


if __name__ == "__main__":
    main()
