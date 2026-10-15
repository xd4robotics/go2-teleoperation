"""Escala progressiva de movimento para o comando nativo do Go2 EDU."""

import math


DEFAULT_SPEED_PERCENT = 100
MIN_SPEED_PERCENT = 10
MAX_SPEED_PERCENT = 100
SPEED_STEP_PERCENT = 10

# O Go2 EDU é especificado em 0–3,7 m/s. Os 5 m/s divulgados pela Unitree
# são um máximo de laboratório, não o teto nominal da teleoperação.
MAX_FORWARD_SPEED_MPS = 3.7
MAX_REVERSE_SPEED_MPS = 2.5
MAX_LATERAL_SPEED_MPS = 1.0
MAX_YAW_SPEED_RADPS = 4.0

MOTION_PROFILES = {
    "forward": (MAX_FORWARD_SPEED_MPS, 0.0, 0.0),
    "backward": (-MAX_REVERSE_SPEED_MPS, 0.0, 0.0),
    "rotate_left": (0.0, 0.0, MAX_YAW_SPEED_RADPS),
    "rotate_right": (0.0, 0.0, -MAX_YAW_SPEED_RADPS),
}


def speed_gain(speed_percent):
    """Converte o nível escrito no painel em ganho progressivo reproduzível.

    A escala é linear para o valor exibido corresponder ao comando: 50% envia
    metade do limite nominal e 100% envia o limite nominal completo.
    """
    if isinstance(speed_percent, bool):
        raise ValueError("percentual de velocidade inválido")
    try:
        selected = float(speed_percent)
    except (TypeError, ValueError) as error:
        raise ValueError("percentual de velocidade inválido") from error
    if not math.isfinite(selected) or not 0 <= selected <= MAX_SPEED_PERCENT:
        raise ValueError("percentual de velocidade inválido")
    return selected / MAX_SPEED_PERCENT


def velocity_limits(speed_percent):
    """Retorna os limites exatos publicados para o nível selecionado."""
    gain = speed_gain(speed_percent)
    return {
        "forward": MAX_FORWARD_SPEED_MPS * gain,
        "reverse": MAX_REVERSE_SPEED_MPS * gain,
        "lateral": MAX_LATERAL_SPEED_MPS * gain,
        "yaw": MAX_YAW_SPEED_RADPS * gain,
    }


def remote_control_axes(vx, vy, vyaw):
    """Normaliza velocidades físicas para a entrada remota −1…1 do Go2.

    O transporte ``obstacles_avoid`` representa o curso do controle remoto.
    Enviar diretamente 1–5 m/s fazia todos os níveis a partir de 20% saturarem
    em 1, eliminando a diferença entre os botões de velocidade.
    """
    values = []
    for value, name in ((vx, "vx"), (vy, "vy"), (vyaw, "vyaw")):
        if isinstance(value, bool):
            raise ValueError("%s deve ser uma velocidade válida" % name)
        try:
            selected = float(value)
        except (TypeError, ValueError) as error:
            raise ValueError("%s deve ser uma velocidade válida" % name) from error
        if not math.isfinite(selected):
            raise ValueError("%s deve ser uma velocidade válida" % name)
        values.append(selected)

    vx, vy, vyaw = values
    longitudinal_limit = (
        MAX_FORWARD_SPEED_MPS if vx >= 0 else MAX_REVERSE_SPEED_MPS
    )

    def clamp_axis(value, limit):
        return max(-1.0, min(1.0, value / limit))

    return (
        clamp_axis(vx, longitudinal_limit),
        clamp_axis(vy, MAX_LATERAL_SPEED_MPS),
        clamp_axis(vyaw, MAX_YAW_SPEED_RADPS),
    )


def normalized_axis(value, name):
    if isinstance(value, bool):
        raise ValueError("eixo %s deve ficar entre -1 e 1" % name)
    try:
        selected = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError("eixo %s deve ficar entre -1 e 1" % name) from error
    if not math.isfinite(selected) or not -1.0 <= selected <= 1.0:
        raise ValueError("eixo %s deve ficar entre -1 e 1" % name)
    return selected


def analog_velocity(forward, lateral, yaw, speed_percent):
    """Converte os três eixos normalizados para unidades nativas do SDK."""
    forward = normalized_axis(forward, "forward")
    lateral = normalized_axis(lateral, "lateral")
    yaw = normalized_axis(yaw, "yaw")
    scale = speed_gain(speed_percent)
    forward_limit = (
        MAX_FORWARD_SPEED_MPS
        if forward >= 0
        else MAX_REVERSE_SPEED_MPS
    )
    return (
        forward * forward_limit * scale,
        lateral * MAX_LATERAL_SPEED_MPS * scale,
        yaw * MAX_YAW_SPEED_RADPS * scale,
    )
