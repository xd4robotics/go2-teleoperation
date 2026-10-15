#!/usr/bin/env python3
"""Encaminha o microfone nativo do Go2 do DDS para o decodificador local.

O firmware publica `/audiosender` continuamente como quadros Opus CBR de
20 ms (48 kHz, estéreo). Cada amostra DDS vira exatamente um datagrama UDP,
preservando a fronteira exigida pelo decodificador Opus.
"""

import argparse
import signal
import socket

import rclpy
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from unitree_go.msg import AudioData


EXPECTED_OPUS_FRAME_BYTES = 160


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--topic", default="/audiosender")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5093)
    args = parser.parse_args()

    rclpy.init()
    node = rclpy.create_node("go2_native_microphone_bridge")
    output = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    stopping = False
    packets = 0

    def stop(_signal_number, _frame):
        nonlocal stopping
        stopping = True

    def forward(message):
        nonlocal packets
        payload = bytes(message.data)
        if not payload:
            return
        if len(payload) != EXPECTED_OPUS_FRAME_BYTES and packets % 250 == 0:
            node.get_logger().warning(
                "Quadro Opus inesperado do Go2: %d bytes" % len(payload)
            )
        output.sendto(payload, (args.host, args.port))
        packets += 1
        if packets == 1:
            node.get_logger().info(
                "Microfone nativo do Go2 recebido; enviando Opus ao "
                "decodificador local."
            )

    qos = QoSProfile(
        depth=50,
        reliability=ReliabilityPolicy.RELIABLE,
        durability=DurabilityPolicy.VOLATILE,
    )
    subscription = node.create_subscription(AudioData, args.topic, forward, qos)
    del subscription

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        while rclpy.ok() and not stopping:
            rclpy.spin_once(node, timeout_sec=0.2)
    finally:
        output.close()
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
