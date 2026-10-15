"""Cálculos puros do retorno seguro à estação de carregamento."""

import math


POSITION_TOLERANCE_M = 0.14
YAW_TOLERANCE_RAD = math.radians(8.0)
MAX_DOCKING_DISTANCE_M = 25.0
MARKER_CENTER_DEADBAND = 0.018
MARKER_SIZE_DEADBAND = 0.009
VISUAL_APPROACH_HANDOFF_DISTANCE_M = 0.65
AVOIDANCE_SUSPEND_DISTANCE_M = 0.45
SEARCH_YAW_SPEED_RADPS = 0.18
SEARCH_ROTATION_SECONDS = (2.0 * math.pi) / SEARCH_YAW_SPEED_RADPS
SEARCH_HOP_FORWARD_MPS = 0.04
SEARCH_HOP_DURATION_SECONDS = 0.75


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def normalize_angle(angle):
    return math.atan2(math.sin(angle), math.cos(angle))


def quaternion_yaw(pose):
    siny = 2.0 * (pose["qw"] * pose["qz"] + pose["qx"] * pose["qy"])
    cosy = 1.0 - 2.0 * (pose["qy"] ** 2 + pose["qz"] ** 2)
    return math.atan2(siny, cosy)


def valid_pose(pose):
    if not isinstance(pose, dict):
        return False
    fields = ("x", "y", "z", "qx", "qy", "qz", "qw")
    try:
        return all(math.isfinite(float(pose[field])) for field in fields)
    except (KeyError, TypeError, ValueError):
        return False


def pose_error(current, target):
    """Retorna o erro da meta no referencial atual do robô."""
    if not valid_pose(current) or not valid_pose(target):
        raise ValueError("pose da estação indisponível")
    dx = float(target["x"]) - float(current["x"])
    dy = float(target["y"]) - float(current["y"])
    yaw = quaternion_yaw(current)
    target_yaw = quaternion_yaw(target)
    return {
        "forward_m": math.cos(yaw) * dx + math.sin(yaw) * dy,
        "lateral_m": -math.sin(yaw) * dx + math.cos(yaw) * dy,
        "distance_m": math.hypot(dx, dy),
        "yaw_error_rad": normalize_angle(target_yaw - yaw),
    }


def navigation_command(current, target):
    """Gera velocidades lentas e holonômicas até a pose calibrada."""
    error = pose_error(current, target)
    arrived = (
        error["distance_m"] <= POSITION_TOLERANCE_M
        and abs(error["yaw_error_rad"]) <= YAW_TOLERANCE_RAD
    )
    if arrived:
        return {**error, "arrived": True, "velocity": (0.0, 0.0, 0.0)}

    distance = error["distance_m"]
    forward_limit = 0.22 if distance > 0.6 else 0.12
    lateral_limit = 0.10 if distance > 0.4 else 0.06
    yaw_limit = 0.32 if distance > 0.4 else 0.20
    forward = clamp(error["forward_m"] * 0.75, -forward_limit, forward_limit)
    lateral = clamp(error["lateral_m"] * 0.75, -lateral_limit, lateral_limit)
    yaw = clamp(error["yaw_error_rad"] * 0.65, -yaw_limit, yaw_limit)
    return {**error, "arrived": False, "velocity": (forward, lateral, yaw)}


def marker_matches(observation, reference):
    return bool(
        isinstance(observation, dict)
        and isinstance(reference, dict)
        and observation.get("dictionary") == reference.get("dictionary")
        and observation.get("marker_id") == reference.get("marker_id")
    )


def marker_correction(observation, reference):
    """Calcula um pequeno ajuste visual comparando a tag com a calibração."""
    if not marker_matches(observation, reference):
        return None
    try:
        center_error = float(observation["center_x"]) - float(
            reference["center_x"]
        )
        size_error = float(reference["side_ratio"]) - float(
            observation["side_ratio"]
        )
    except (KeyError, TypeError, ValueError):
        return None
    if not math.isfinite(center_error) or not math.isfinite(size_error):
        return None

    forward = 0.0
    lateral = 0.0
    if abs(size_error) > MARKER_SIZE_DEADBAND:
        forward = clamp(size_error * 1.5, -0.08, 0.08)
    if abs(center_error) > MARKER_CENTER_DEADBAND:
        # Na imagem, tag à direita requer deslocamento lateral à direita.
        lateral = clamp(-center_error * 0.28, -0.06, 0.06)
    if not forward and not lateral:
        # A pose visual coincide, mas o contato ainda não fechou: um encaixe
        # frontal curto é mais seguro que uma busca cega em várias direções.
        forward = 0.035
    return {
        "center_error": center_error,
        "size_error": size_error,
        "velocity": (forward, lateral, 0.0),
    }


def visual_approach_command(observation):
    """Aproxima lentamente da tag distante, mantendo-a centralizada."""
    if not isinstance(observation, dict):
        return None
    try:
        distance = float(observation["distance_m"])
        center_error = float(observation["center_x"]) - 0.5
    except (KeyError, TypeError, ValueError):
        return None
    if not math.isfinite(distance) or not math.isfinite(center_error):
        return None
    if distance <= VISUAL_APPROACH_HANDOFF_DISTANCE_M:
        return {
            "distance_m": distance,
            "velocity": (0.0, 0.0, 0.0),
        }

    forward = clamp((distance - VISUAL_APPROACH_HANDOFF_DISTANCE_M) * 0.25, 0.04, 0.16)
    yaw = clamp(-center_error * 0.55, -0.22, 0.22)
    return {
        "distance_m": distance,
        "velocity": (forward, 0.0, yaw),
    }


def calibration_is_usable(
    calibration,
    current_pose,
    current_odom_stamp=None,
    frame="odom",
):
    """Recusa calibrações incompatíveis com a sessão atual de odometria."""
    if not isinstance(calibration, dict) or not valid_pose(current_pose):
        return False, "estação de carregamento ainda não calibrada"
    target = calibration.get("pose")
    if not valid_pose(target) or calibration.get("frame") != frame:
        return False, "calibração da estação inválida para o mapa atual"
    calibrated_stamp = calibration.get("odom_stamp_seconds")
    if calibrated_stamp is not None and current_odom_stamp is not None:
        try:
            if float(current_odom_stamp) + 5.0 < float(calibrated_stamp):
                return False, "odometria reiniciada; calibre novamente a estação"
        except (TypeError, ValueError):
            return False, "referência de odometria da estação inválida"
    distance = pose_error(current_pose, target)["distance_m"]
    if distance > MAX_DOCKING_DISTANCE_M:
        return False, "estação fora do limite seguro de 25 metros"
    return True, ""
