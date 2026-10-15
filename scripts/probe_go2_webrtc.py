#!/usr/bin/env python3
import asyncio

from unitree_webrtc_connect.constants import RTC_TOPIC
from unitree_webrtc_connect.webrtc_driver import (
    UnitreeWebRTCConnection,
    WebRTCConnectionMethod,
)


async def main():
    received = asyncio.Event()
    conn = UnitreeWebRTCConnection(WebRTCConnectionMethod.LocalAP)
    await asyncio.wait_for(conn.connect(), timeout=20)

    def on_state(message):
        data = message.get("data", {})
        print(
            "GO2_TELEMETRY_OK",
            f"mode={data.get('mode')}",
            f"gait={data.get('gait_type')}",
            f"battery={data.get('battery_state', {}).get('soc', 'unknown')}",
            flush=True,
        )
        received.set()

    conn.datachannel.pub_sub.subscribe(RTC_TOPIC["LF_SPORT_MOD_STATE"], on_state)
    await asyncio.wait_for(received.wait(), timeout=15)


if __name__ == "__main__":
    asyncio.run(main())
