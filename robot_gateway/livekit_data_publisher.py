#!/usr/bin/env python3
"""Publica mapa e telemetria do gateway local na ponte LiveKit da Vercel."""

import argparse
import base64
import json
import math
import os
import signal
import struct
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def json_safe(value):
    """Replace non-finite sensor values so browsers can decode the payload."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return value


def get_json(url, gateway_key, timeout):
    headers = {"Accept": "application/json"}
    if gateway_key:
        headers["X-Gateway-Key"] = gateway_key
    with urlopen(Request(url, headers=headers), timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def sample_points(points, maximum):
    point_count = len(points) // 3
    if point_count <= maximum:
        return points[: point_count * 3]

    triples = [points[index : index + 3] for index in range(0, point_count * 3, 3)]
    minimum = [min(point[axis] for point in triples) for axis in range(3)]
    maximum_value = [max(point[axis] for point in triples) for axis in range(3)]
    bins_per_axis = max(2, round(maximum ** (1.0 / 3.0)))
    buckets = {}
    for index, point in enumerate(triples):
        key = []
        for axis in range(3):
            extent = maximum_value[axis] - minimum[axis]
            normalized = (point[axis] - minimum[axis]) / extent if extent > 0 else 0
            key.append(min(bins_per_axis - 1, int(normalized * bins_per_axis)))
        buckets.setdefault(tuple(key), index)

    selected = list(buckets.values())
    if len(selected) > maximum:
        step = len(selected) / maximum
        selected = [selected[int(output_index * step)] for output_index in range(maximum)]
    elif len(selected) < maximum:
        selected_set = set(selected)
        remaining = maximum - len(selected)
        candidates = [index for index in range(point_count) if index not in selected_set]
        step = len(candidates) / remaining
        selected.extend(candidates[int(output_index * step)] for output_index in range(remaining))

    sampled = []
    for index in selected:
        sampled.extend(triples[index])
    return sampled


def normalized_status(status):
    robot_connected = bool(status.get("robot_connected"))
    fields = (
        "camera_connected",
        "lio_connected",
        "battery_connected",
        "battery_percent",
        "battery_voltage_v",
        "battery_current_a",
        "battery_status_code",
        "robot_temperature_c",
        "robot_temperature_average_c",
        "robot_temperature_high",
        "robot_temperature_high_threshold_c",
        "charging",
        "autonomy_minutes",
        "current_speed_mps",
        "robot_activity_status",
        "aruco_available",
        "docking_station_calibrated",
        "docking_station_calibrated_at",
        "docking_station_pose",
        "docking_station_point_count",
        "docking_station_marker_calibrated",
        "docking_calibration_ready",
        "docking_marker_visible",
        "docking_marker",
        "docking_marker_matches_station",
        "docking_marker_age_seconds",
        "docking_active",
        "docking_state",
        "docking_message",
        "docking_error",
        "docking_distance_m",
        "docking_elapsed_seconds",
        "docking_adjustment_count",
        "docking_next_adjustment_seconds",
        "docking_adjustment_interval_seconds",
        "control_armed",
        "posture",
        "point_count",
        "current_location",
        "current_pose",
        "speed_limit_percent",
        "speed_min_percent",
        "speed_max_percent",
        "speed_step_percent",
        "obstacle_avoidance_enabled",
        "obstacle_avoidance_requested",
        "obstacle_avoidance_state_confirmed",
        "obstacle_avoidance_command_ready",
        "native_avoidance_confirmed",
        "native_avoidance_confirmation_age_seconds",
        "safety_mode",
        "safety_ready",
        "safety_blocked",
        "safety_block_reason",
        "remote_source_confirmed",
        "remote_source_operational",
        "last_avoidance_response",
        "last_remote_source_response",
    )
    telemetry = {field: status.get(field) for field in fields}
    return {
        **telemetry,
        "captured_at_ms": int(time.time() * 1000),
        "robot_id": "primary",
        "robot_online": robot_connected,
        "network_online": True,
        "sdk_connected": robot_connected,
        "gateway_connected": True,
    }


def encode_point_cloud(points):
    point_count = len(points) // 3
    minimum = [min(points[axis::3]) for axis in range(3)]
    maximum = [max(points[axis::3]) for axis in range(3)]
    scale = [
        (maximum[axis] - minimum[axis]) / 65535
        if maximum[axis] > minimum[axis]
        else 1
        for axis in range(3)
    ]
    payload = bytearray(32 + point_count * 6)
    payload[0:4] = b"GO2P"
    struct.pack_into("<BBH", payload, 4, 1, 0, point_count)
    struct.pack_into("<fff", payload, 8, *minimum)
    struct.pack_into("<fff", payload, 20, *scale)
    offset = 32
    for index in range(0, len(points), 3):
        for axis in range(3):
            quantized = round((points[index + axis] - minimum[axis]) / scale[axis])
            struct.pack_into("<H", payload, offset, max(0, min(65535, quantized)))
            offset += 2
    return bytes(payload)


def send_cli_data(room, topic, payload, timeout):
    result = subprocess.run(
        [
            "lk",
            "--project",
            os.environ.get("LIVEKIT_PROJECT", "go2"),
            "room",
            "send-data",
            "--room",
            room,
            "--topic",
            topic,
            json.dumps(json_safe(payload), separators=(",", ":"), allow_nan=False),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "LiveKit CLI recusou os dados")


def publish_with_cli(room, points, status, timeout):
    if points:
        point_payload = {
            "encoding": "go2p-base64",
            "data": base64.b64encode(encode_point_cloud(points)).decode("ascii"),
        }
        send_cli_data(room, "go2.pointcloud", point_payload, timeout)
    send_cli_data(room, "go2.telemetry", status, timeout)
    return {"point_count": len(points) // 3, "room_name": room}


def post_snapshot(url, publisher_key, payload, timeout):
    request = Request(
        url,
        data=json.dumps(json_safe(payload), separators=(",", ":"), allow_nan=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Robot-Key": publisher_key,
        },
        method="POST",
    )
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--transport",
        choices=("cli", "vercel"),
        default=os.environ.get("LIVEKIT_DATA_TRANSPORT", "cli"),
    )
    parser.add_argument(
        "--room",
        default=os.environ.get("LIVEKIT_ROOM_NAME", "go2-primary"),
    )
    parser.add_argument(
        "--vercel-url",
        default=os.environ.get("VERCEL_APP_URL", ""),
        help="URL pública do frontend na Vercel",
    )
    parser.add_argument(
        "--publisher-key",
        default=os.environ.get("ROBOT_PUBLISHER_KEY", ""),
    )
    parser.add_argument(
        "--gateway-url",
        default=os.environ.get("ROBOT_GATEWAY_URL", "http://127.0.0.1:8081"),
    )
    parser.add_argument(
        "--gateway-key",
        default=os.environ.get("ROBOT_GATEWAY_API_KEY", ""),
    )
    parser.add_argument("--interval", type=float, default=1.0)
    parser.add_argument("--max-points", type=int, default=1500)
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args()

    if args.transport == "vercel" and not args.vercel_url:
        parser.error("informe VERCEL_APP_URL ou --vercel-url")
    if args.transport == "vercel" and not args.publisher_key:
        parser.error("informe ROBOT_PUBLISHER_KEY ou --publisher-key")
    if not 0 <= args.max_points <= 1500:
        parser.error("--max-points deve estar entre 0 (nuvem desativada) e 1500")

    gateway_url = args.gateway_url.rstrip("/")
    publish_url = (
        args.vercel_url.rstrip("/") + "/api/livekit-robot-data"
        if args.transport == "vercel"
        else ""
    )
    stopping = False

    def stop(_signum=None, _frame=None):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    if args.transport == "cli":
        print(
            "Nuvem de pontos direta para a sala %s via LiveKit CLI" % args.room,
            flush=True,
        )
    else:
        print("Ponte da nuvem de pontos ativa para %s" % publish_url, flush=True)

    sequence = 0
    while not stopping:
        started_at = time.monotonic()
        try:
            status = normalized_status(
                get_json(
                    gateway_url + "/api/status", args.gateway_key, args.timeout
                )
            )
            # Com --max-points 0 a nuvem fica de fora do canal (economiza o
            # uplink 4G para o vídeo); a telemetria continua normalmente.
            points = []
            if args.max_points > 0:
                point_payload = get_json(
                    gateway_url + "/api/map/points", args.gateway_key, args.timeout
                )
                points = sample_points(
                    point_payload.get("points", []), args.max_points
                )
                if not points:
                    raise RuntimeError("gateway ainda não possui pontos do LiDAR")
            if args.transport == "cli":
                result = publish_with_cli(
                    args.room, points, status, args.timeout
                )
            else:
                result = post_snapshot(
                    publish_url,
                    args.publisher_key,
                    {"points": points, "status": status},
                    args.timeout,
                )
            sequence += 1
            if sequence == 1 or sequence % 10 == 0:
                print(
                    "LiveKit: %d pontos publicados na sala %s"
                    % (result.get("point_count", 0), result.get("room_name", "")),
                    flush=True,
                )
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            print("Vercel respondeu HTTP %d: %s" % (error.code, detail), flush=True)
        except (
            URLError,
            TimeoutError,
            RuntimeError,
            ValueError,
            OSError,
            subprocess.TimeoutExpired,
        ) as error:
            print("Aguardando dados/publicação: %s" % error, flush=True)

        remaining = args.interval - (time.monotonic() - started_at)
        if remaining > 0 and not stopping:
            time.sleep(remaining)


if __name__ == "__main__":
    main()
