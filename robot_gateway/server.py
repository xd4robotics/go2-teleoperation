#!/usr/bin/env python3
"""Gateway local do Go2: ROS 2, mapa, câmera e comandos para o FastAPI."""

import argparse
import hmac
import json
import os
import signal
import socket
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import cv2
import numpy as np
import rclpy
from rclpy.executors import MultiThreadedExecutor

from aruco_tracker import ArucoTracker

ROOT = Path(__file__).resolve().parent
SLAM_DIR = ROOT.parent / "go2_native_ws" / "go2_slam"
sys.path.insert(0, str(SLAM_DIR))

from mapping_node import Go2MappingNode  # noqa: E402


class CameraStream:
    def __init__(self, marker_callback=None):
        self.interface = os.environ.get(
            "GO2_CAMERA_INTERFACE",
            os.environ.get("GO2_ROBOT_INTERFACE", "eth0"),
        )
        try:
            socket.if_nametoindex(self.interface)
        except OSError as error:
            raise RuntimeError(
                "Interface da câmera do Go2 indisponível: %s"
                % self.interface
            ) from error
        self.pipeline = (
            "udpsrc address=230.1.1.1 port=1720 multicast-iface=%s "
            'caps="application/x-rtp,media=video,encoding-name=H264,clock-rate=90000" ! '
            "rtph264depay ! h264parse ! avdec_h264 ! videoconvert ! "
            "video/x-raw,format=BGR ! appsink drop=true max-buffers=1 sync=false"
        ) % self.interface
        self.condition = threading.Condition()
        self.jpeg = None
        self.frame = None
        self.sequence = 0
        self.connected = False
        self.marker_callback = marker_callback
        self.aruco = ArucoTracker()
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, name="go2-camera", daemon=True)
        self.marker_thread = threading.Thread(
            target=self._track_markers,
            name="go2-aruco",
            daemon=True,
        )

    def start(self):
        self.thread.start()
        self.marker_thread.start()

    def _run(self):
        while not self.stop_event.is_set():
            capture = cv2.VideoCapture(self.pipeline, cv2.CAP_GSTREAMER)
            if not capture.isOpened():
                self.connected = False
                time.sleep(1.0)
                continue
            failures = 0
            while not self.stop_event.is_set():
                ok, frame = capture.read()
                if not ok:
                    failures += 1
                    self.connected = False
                    if failures > 20:
                        break
                    time.sleep(0.03)
                    continue
                failures = 0
                self.connected = True
                encoded, buffer = cv2.imencode(
                    ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 76]
                )
                if not encoded:
                    continue
                with self.condition:
                    self.frame = frame
                    self.jpeg = buffer.tobytes()
                    self.sequence += 1
                    self.condition.notify_all()
            capture.release()
            time.sleep(0.25)

    def _track_markers(self):
        while not self.stop_event.wait(0.5):
            with self.condition:
                frame = self.frame
                if frame is not None:
                    frame = frame.copy()
            observation = self.aruco.detect(frame)
            if self.marker_callback:
                self.marker_callback(observation)

    def latest_marker(self):
        return self.aruco.latest()

    def marker_status(self):
        return self.aruco.status()

    def wait_frame(self, last_sequence, timeout=2.0):
        with self.condition:
            self.condition.wait_for(
                lambda: self.sequence != last_sequence or self.stop_event.is_set(),
                timeout=timeout,
            )
            return self.sequence, self.jpeg

    def close(self):
        self.stop_event.set()
        with self.condition:
            self.condition.notify_all()
        self.thread.join(timeout=2.0)
        self.marker_thread.join(timeout=2.0)


class DisabledCameraStream:
    """Implementação neutra para operar o gateway sem abrir o vídeo."""

    connected = False

    def start(self):
        pass

    def latest_marker(self):
        return None

    def marker_status(self):
        return {
            "aruco_available": False,
            "docking_marker_visible": False,
            "docking_marker": None,
        }

    def wait_frame(self, _last_sequence, timeout=2.0):
        time.sleep(min(timeout, 0.1))
        return 0, None

    def close(self):
        pass


class RobotGatewayRuntime:
    def __init__(self, gateway_key=""):
        rclpy.init()
        self.gateway_key = gateway_key
        self.node = Go2MappingNode()
        camera_enabled = os.environ.get("GO2_CAMERA_ENABLED", "true").lower() == "true"
        self.camera = (
            CameraStream(self.node.update_docking_marker)
            if camera_enabled
            else DisabledCameraStream()
        )
        self.executor = MultiThreadedExecutor(num_threads=4)
        self.executor.add_node(self.node)
        self.ros_thread = threading.Thread(target=self.executor.spin, name="go2-ros", daemon=True)

    def start(self):
        self.camera.start()
        self.ros_thread.start()

    def close(self):
        self.node.shutdown_safely()
        self.camera.close()
        self.executor.shutdown()
        self.node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
        self.ros_thread.join(timeout=2.0)

    def status(self):
        status = self.node.status_dict()
        status["camera_connected"] = self.camera.connected
        status.update(self.camera.marker_status())
        return status

    def map_points(self):
        points = self.node._snapshot(24000)
        if points.size == 0:
            return []
        xyz = np.round(points[:, :3], 3)
        return xyz.reshape(-1).tolist()


class RobotGatewayHandler(BaseHTTPRequestHandler):
    server_version = "Go2Gateway/1.0"

    @property
    def runtime(self):
        return self.server.runtime

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            return
        super().log_message(fmt, *args)

    def _json(self, payload, status=HTTPStatus.OK):
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        length = min(int(self.headers.get("Content-Length", "0")), 16384)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _authorized(self):
        expected = self.runtime.gateway_key
        if not expected:
            return True
        provided = self.headers.get("X-Gateway-Key", "")
        return bool(provided) and hmac.compare_digest(expected, provided)

    def _require_authorized(self):
        if self._authorized():
            return True
        self._json(
            {"ok": False, "error": "chave do gateway inválida"},
            HTTPStatus.UNAUTHORIZED,
        )
        return False

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            self._json({"status": "ok", "service": "go2-gateway"})
            return
        if not self._require_authorized():
            return
        if path == "/api/status":
            self._json(self.runtime.status())
        elif path == "/api/map/points":
            self._json({"points": self.runtime.map_points()})
        elif path == "/api/camera/frame":
            self._camera_frame()
        elif path == "/camera.mjpg":
            self._mjpeg()
        else:
            self._json(
                {"ok": False, "error": "rota inexistente"},
                HTTPStatus.NOT_FOUND,
            )

    def do_POST(self):
        path = urlparse(self.path).path
        if not self._require_authorized():
            return
        try:
            body = self._body()
            if path == "/api/control/arm":
                armed = bool(body.get("armed", False))
                self.runtime.node.arm_control(armed)
                self._json({"ok": True, "armed": armed})
            elif path == "/api/control/move":
                self._move(str(body.get("command", "stop")))
            elif path == "/api/control/joystick":
                self._joystick(body)
            elif path == "/api/control/posture":
                self._posture(str(body.get("command", "")))
            elif path == "/api/control/speed":
                percent = self.runtime.node.set_speed_percent(
                    body.get("percent")
                )
                self._json({"ok": True, "speed_percent": percent})
            elif path == "/api/control/obstacle-avoidance":
                enabled = body.get("enabled")
                if not isinstance(enabled, bool):
                    raise ValueError(
                        "o campo enabled do anticolisão deve ser booleano"
                    )
                requested = self.runtime.node.set_obstacle_avoidance(
                    enabled
                )
                self._json(
                    {
                        "ok": True,
                        "obstacle_avoidance_requested": requested,
                    }
                )
            elif path == "/api/control/damping":
                armed = self.runtime.node.damping()
                self._json(
                    {
                        "ok": True,
                        "command": "damping",
                        "armed": armed,
                    }
                )
            elif path == "/api/audio/megaphone":
                action = str(body.get("action", ""))
                if action not in {"start", "chunk", "stop"}:
                    raise ValueError("ação de áudio inválida")
                if action == "start":
                    self.runtime.node.start_megaphone()
                elif action == "chunk":
                    self.runtime.node.play_megaphone_block(
                        body.get("data", ""),
                        body.get("current_block_index", 1),
                        body.get("total_block_number", 1),
                    )
                else:
                    self.runtime.node.stop_megaphone(
                        body.get("delay_seconds", 0.45)
                    )
                self._json(
                    {
                        "ok": True,
                        "audio": "audiohub",
                        "state": action,
                    }
                )
            elif path == "/api/docking/calibrate":
                calibration = self.runtime.node.calibrate_docking_station(
                    self.runtime.camera.latest_marker()
                )
                self._json({"ok": True, "calibration": calibration})
            elif path == "/api/docking/start":
                docking = self.runtime.node.start_docking()
                self._json({"ok": True, **docking})
            elif path == "/api/docking/cancel":
                self.runtime.node.cancel_docking(
                    "Retorno à base cancelado pelo operador."
                )
                self._json({"ok": True, "docking_active": False})
            elif path == "/api/control/stop":
                self.runtime.node.emergency_lie_down()
                self._json({
                    "ok": True,
                    "control_armed": False,
                    "posture": "transitioning_down",
                })
            elif path == "/api/map/reset":
                self.runtime.node.reset_map()
                self._json({"ok": True})
            elif path == "/api/map/save":
                _, _, metadata = self.runtime.node.save_map()
                self._json({"ok": True, **metadata})
            else:
                self._json({"ok": False, "error": "rota inexistente"}, HTTPStatus.NOT_FOUND)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as error:
            self._json({"ok": False, "error": str(error)}, HTTPStatus.BAD_REQUEST)

    def _move(self, command):
        if command != "stop" and not self.runtime.node._control_armed:
            raise PermissionError("controle bloqueado; habilite-o antes de mover")
        if command == "stop":
            self.runtime.node.cancel_docking(
                "Retorno à base cancelado pelo operador."
            )
            self.runtime.node.stop_motion(clear_safety_block=True)
        else:
            self.runtime.node.cancel_docking(
                "Retorno à base cancelado por comando manual."
            )
            self.runtime.node.move_command(command)
        self._json({"ok": True, "command": command})

    def _joystick(self, body):
        if not self.runtime.node._control_armed:
            raise PermissionError("controle bloqueado; habilite-o antes de mover")
        self.runtime.node.cancel_docking(
            "Retorno à base cancelado pelo controle manual."
        )
        velocity = self.runtime.node.move_analog(
            body.get("forward"),
            body.get("lateral"),
            body.get("yaw"),
        )
        self._json(
            {
                "ok": True,
                "command": "move_analog",
                "velocity": {
                    "x": velocity[0],
                    "y": velocity[1],
                    "yaw": velocity[2],
                },
            }
        )

    def _posture(self, command):
        self.runtime.node.cancel_docking(
            "Retorno à base cancelado pela mudança de postura."
        )
        actual = command
        if command == "toggle":
            actual = self.runtime.node.toggle_posture()
        else:
            self.runtime.node.set_posture(command)
        self._json({"ok": True, "command": actual})

    def _mjpeg(self):
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.end_headers()
        sequence = -1
        try:
            while True:
                sequence, jpeg = self.runtime.camera.wait_frame(sequence)
                if jpeg is None:
                    continue
                self.wfile.write(b"--frame\r\n")
                self.wfile.write(b"Content-Type: image/jpeg\r\n")
                self.wfile.write(("Content-Length: %d\r\n\r\n" % len(jpeg)).encode("ascii"))
                self.wfile.write(jpeg)
                self.wfile.write(b"\r\n")
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def _camera_frame(self):
        try:
            _, jpeg = self.runtime.camera.wait_frame(-1, timeout=1.0)
            if jpeg is None:
                self._json(
                    {"ok": False, "error": "câmera ainda sem quadro"},
                    HTTPStatus.SERVICE_UNAVAILABLE,
                )
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(jpeg)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(jpeg)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass


class RobotGatewayServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, runtime):
        self.runtime = runtime
        super().__init__(address, RobotGatewayHandler)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument(
        "--gateway-key",
        default=os.environ.get("ROBOT_GATEWAY_API_KEY", ""),
    )
    args = parser.parse_args()

    runtime = RobotGatewayRuntime(gateway_key=args.gateway_key)
    runtime.start()
    server = RobotGatewayServer((args.host, args.port), runtime)

    stop_event = threading.Event()

    def stop(_signum=None, _frame=None):
        if stop_event.is_set():
            return
        stop_event.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    print(
        "Gateway Go2 ativo em http://%s:%d (autenticação %s)"
        % (args.host, args.port, "ativa" if args.gateway_key else "local"),
        flush=True,
    )
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()
        runtime.close()


if __name__ == "__main__":
    main()
