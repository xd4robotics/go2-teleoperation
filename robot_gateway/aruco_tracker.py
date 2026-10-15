"""Detecção leve de tags ArUco/AprilTag no vídeo frontal do Go2."""

import threading
import time

import cv2
import numpy as np


DEFAULT_DICTIONARIES = (
    "DICT_4X4_50",
    "DICT_5X5_50",
    "DICT_6X6_50",
    "DICT_ARUCO_ORIGINAL",
    "DICT_APRILTAG_36h11",
    "DICT_APRILTAG_25h9",
)


class ArucoTracker:
    """Mantém a observação mais recente sem bloquear o pipeline de vídeo."""

    def __init__(self, dictionary_names=DEFAULT_DICTIONARIES, max_width=640):
        self.max_width = max(160, int(max_width))
        self._lock = threading.Lock()
        self._observation = None
        self._observed_at = 0.0
        self._last_scan_at = 0.0
        self._dictionaries = []
        self.available = bool(hasattr(cv2, "aruco"))
        if not self.available:
            return
        for name in dictionary_names:
            dictionary_id = getattr(cv2.aruco, name, None)
            if dictionary_id is None:
                continue
            self._dictionaries.append(
                (name, cv2.aruco.getPredefinedDictionary(dictionary_id))
            )
        self.available = bool(self._dictionaries)
        self._parameters = (
            cv2.aruco.DetectorParameters_create()
            if self.available
            else None
        )

    @staticmethod
    def _observation_from_corners(dictionary_name, marker_id, corners, shape):
        height, width = shape[:2]
        points = np.asarray(corners, dtype=np.float32).reshape(4, 2)
        center = points.mean(axis=0)
        perimeter = sum(
            float(np.linalg.norm(points[(index + 1) % 4] - points[index]))
            for index in range(4)
        )
        area = abs(float(cv2.contourArea(points)))
        minimum = points.min(axis=0)
        maximum = points.max(axis=0)
        left = max(0.0, min(1.0, float(minimum[0]) / max(1, width)))
        top = max(0.0, min(1.0, float(minimum[1]) / max(1, height)))
        right = max(left, min(1.0, float(maximum[0]) / max(1, width)))
        bottom = max(top, min(1.0, float(maximum[1]) / max(1, height)))
        return {
            "dictionary": dictionary_name,
            "marker_id": int(marker_id),
            "frame_width": int(width),
            "frame_height": int(height),
            "center_x": round(float(center[0]) / max(1, width), 6),
            "center_y": round(float(center[1]) / max(1, height), 6),
            "side_ratio": round(perimeter / 4.0 / max(1, width), 6),
            "area_ratio": round(area / max(1, width * height), 8),
            "bounding_box": {
                "left": round(left, 6),
                "top": round(top, 6),
                "width": round(right - left, 6),
                "height": round(bottom - top, 6),
            },
        }

    def detect(self, frame):
        now = time.monotonic()
        if not self.available or frame is None or not getattr(frame, "size", 0):
            with self._lock:
                self._last_scan_at = now
            return None

        height, width = frame.shape[:2]
        if width > self.max_width:
            scale = self.max_width / float(width)
            frame = cv2.resize(
                frame,
                (self.max_width, max(1, int(round(height * scale)))),
                interpolation=cv2.INTER_AREA,
            )
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        detected = []
        for name, dictionary in self._dictionaries:
            try:
                corners, ids, _ = cv2.aruco.detectMarkers(
                    gray,
                    dictionary,
                    parameters=self._parameters,
                )
            except cv2.error:
                continue
            if ids is None:
                continue
            for marker_corners, marker_id in zip(corners, ids.flatten()):
                detected.append(
                    self._observation_from_corners(
                        name,
                        marker_id,
                        marker_corners,
                        gray.shape,
                    )
                )

        observation = (
            max(detected, key=lambda item: item["area_ratio"])
            if detected
            else None
        )
        with self._lock:
            self._last_scan_at = now
            if observation is not None:
                self._observation = dict(observation)
                self._observed_at = now
        return observation

    def latest(self, maximum_age_seconds=2.0):
        with self._lock:
            if (
                self._observation is None
                or time.monotonic() - self._observed_at > maximum_age_seconds
            ):
                return None
            return dict(self._observation)

    def status(self):
        with self._lock:
            now = time.monotonic()
            visible = bool(
                self._observation is not None
                and now - self._observed_at <= 2.0
            )
            return {
                "aruco_available": self.available,
                "docking_marker_visible": visible,
                "docking_marker": (
                    dict(self._observation) if visible else None
                ),
                "docking_marker_age_seconds": (
                    round(now - self._observed_at, 2)
                    if self._observed_at
                    else None
                ),
            }
