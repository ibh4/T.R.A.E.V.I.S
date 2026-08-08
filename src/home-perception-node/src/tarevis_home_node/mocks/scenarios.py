from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..contracts import EventLevel, EventSource, SensingEvent, create_event


@dataclass(frozen=True, slots=True)
class MockScenario:
    name: str
    event_type: str
    level: EventLevel
    zone: str
    summary: str
    payload: dict[str, Any]


_SCENARIOS = {
    "delivery": MockScenario(
        name="delivery",
        event_type="delivery_detected",
        level=EventLevel.LOW,
        zone="door",
        summary="门口模拟检测到包裹",
        payload={"mock": True, "camera_id": "cam_door"},
    ),
    "visitor": MockScenario(
        name="visitor",
        event_type="visitor_detected",
        level=EventLevel.MEDIUM,
        zone="door",
        summary="门口模拟检测到访客停留",
        payload={"mock": True, "camera_id": "cam_door"},
    ),
    "door": MockScenario(
        name="door",
        event_type="door_event_detected",
        level=EventLevel.HIGH,
        zone="door",
        summary="门口模拟产生需要确认的异常事件",
        payload={"mock": True, "camera_id": "cam_door"},
    ),
    "kitchen": MockScenario(
        name="kitchen",
        event_type="kitchen_risk_detected",
        level=EventLevel.HIGH,
        zone="kitchen",
        summary="厨房模拟产生风险候选事件",
        payload={"mock": True, "camera_id": "cam_kitchen"},
    ),
    "fall": MockScenario(
        name="fall",
        event_type="fall_suspected",
        level=EventLevel.HIGH,
        zone="living_room",
        summary="模拟产生疑似跌倒候选事件",
        payload={"mock": True, "camera_id": "cam_living_room"},
    ),
    "motion": MockScenario(
        name="motion",
        event_type="motion_detected",
        level=EventLevel.INFO,
        zone="unknown",
        summary="模拟产生原始运动线索",
        payload={"mock": True, "motion_score": 0.08},
    ),
    "help": MockScenario(
        name="help",
        event_type="help_keyword_detected",
        level=EventLevel.HIGH,
        zone="unknown",
        summary="模拟命中求助类短语",
        payload={"mock": True, "text": "测试求助短语"},
    ),
    "ack": MockScenario(
        name="ack",
        event_type="user_acknowledged",
        level=EventLevel.INFO,
        zone="unknown",
        summary="模拟命中用户确认短语",
        payload={"mock": True, "text": "我没事"},
    ),
}

SCENARIO_NAMES = tuple(_SCENARIOS)


def list_scenarios() -> list[dict[str, str]]:
    return [
        {
            "name": scenario.name,
            "event_type": scenario.event_type,
            "level": scenario.level.value,
            "zone": scenario.zone,
            "summary": scenario.summary,
        }
        for scenario in _SCENARIOS.values()
    ]


def create_mock_event(
    scenario_name: str,
    *,
    device_id: str,
    zone: str | None = None,
) -> SensingEvent:
    try:
        scenario = _SCENARIOS[scenario_name]
    except KeyError as exc:
        raise ValueError(f"unknown mock scenario: {scenario_name}") from exc
    payload = dict(scenario.payload)
    payload["summary"] = scenario.summary
    return create_event(
        device_id=device_id,
        source=EventSource.MOCK,
        event_type=scenario.event_type,
        level=scenario.level,
        zone=zone or scenario.zone,
        payload=payload,
    )
