"""Cálculos puros da telemetria exibida no painel de operação."""

import math


MINIMUM_DISCHARGE_POWER_W = 8.0
MAX_AUTONOMY_MINUTES = 24 * 60
MOVEMENT_THRESHOLD_MPS = 0.03
ROBOT_TEMPERATURE_HIGH_C = 70.0


def motor_temperature_summary(motor_states, maximum_motors=12):
    """Resume a temperatura válida dos motores usados pelo Go2."""
    if not motor_states:
        return None
    values = []
    for state in list(motor_states)[:maximum_motors]:
        raw_value = (
            state.get("temperature")
            if isinstance(state, dict)
            else getattr(state, "temperature", None)
        )
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(value) and -20.0 <= value <= 120.0:
            values.append(value)
    if not values:
        return None
    return {
        "maximum_c": round(max(values), 1),
        "average_c": round(sum(values) / len(values), 1),
        "sample_count": len(values),
    }


def current_speed_mps(sport_state):
    """Retorna a velocidade linear real no plano, ignorando ruído inválido."""
    if not isinstance(sport_state, dict):
        return 0.0
    velocity = sport_state.get("velocity")
    if not isinstance(velocity, (list, tuple)) or len(velocity) < 2:
        return 0.0
    try:
        x = float(velocity[0])
        y = float(velocity[1])
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(x) or not math.isfinite(y):
        return 0.0
    return math.hypot(x, y)


def discharge_power_w(voltage_v, current_a):
    """Calcula potência instantânea válida consumida pela bateria."""
    try:
        voltage = float(voltage_v)
        current = abs(float(current_a))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(voltage) or not math.isfinite(current):
        return None
    power = voltage * current
    return power if power >= MINIMUM_DISCHARGE_POWER_W else None


def estimate_autonomy_minutes(percent, capacity_wh, power_w):
    """Estima o tempo restante com base na energia e consumo medidos."""
    try:
        percentage = max(0.0, min(100.0, float(percent)))
        capacity = float(capacity_wh)
        power = float(power_w)
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(value) for value in (percentage, capacity, power)):
        return None
    if capacity <= 0 or power < MINIMUM_DISCHARGE_POWER_W:
        return None
    minutes = capacity * percentage / 100.0 / power * 60.0
    return int(round(max(0.0, min(MAX_AUTONOMY_MINUTES, minutes))))


def activity_status(charging, speed_mps, moving=False):
    """Classifica o robô nos três estados mostrados no dashboard."""
    if charging:
        return "charging"
    if moving or speed_mps >= MOVEMENT_THRESHOLD_MPS:
        return "moving"
    return "stopped"
