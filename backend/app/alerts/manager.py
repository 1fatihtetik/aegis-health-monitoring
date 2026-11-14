"""Alert lifecycle and dedup (PRD M4).

One open alert per (rule, crew). It auto-resolves when the condition clears (the engine applies
hysteresis). A manually resolved alert is not re-raised until the condition clears and fires again.
"""

import uuid
from datetime import datetime

from app.domain.enums import AlertState
from app.domain.models import Alert
from app.rules.engine import Finding
from app.util import iso

Key = tuple[str, str | None]


class AlertManager:
    def __init__(self) -> None:
        self.alerts: dict[str, Alert] = {}
        self._open: dict[Key, str] = {}

    def open_alerts(self) -> list[Alert]:
        return [a for a in self.alerts.values() if a.state != AlertState.RESOLVED]

    def process(self, findings: list[Finding], now: datetime) -> list[Alert]:
        """Returns the alerts whose state changed on this evaluation."""
        changed: list[Alert] = []
        for f in findings:
            if not f.rule.alert:
                continue
            key = (f.rule.id, f.crew_id)
            alert_id = self._open.get(key)
            if f.firing:
                if alert_id is None:
                    rule = f.rule
                    alert = Alert(
                        id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"aegis:{rule.id}:{f.crew_id}:{iso(now)}")),
                        rule_id=rule.id, title=rule.title, crew_id=f.crew_id, severity=rule.severity,
                        raised_ts=now, hazards=rule.hazards, hrp_risks=rule.hrp_risks, evidence=f.evidence,
                        rationale=rule.rationale, action=rule.action, checklist=rule.checklist,
                        onboard_only=rule.onboard_only,
                    )
                    self.alerts[alert.id] = alert
                    self._open[key] = alert.id
                    changed.append(alert)
                elif self.alerts[alert_id].state != AlertState.RESOLVED:
                    self.alerts[alert_id].evidence = f.evidence
            elif alert_id is not None:
                del self._open[key]
                alert = self.alerts[alert_id]
                if alert.state != AlertState.RESOLVED:
                    self._resolve(alert, now, "Condition cleared (auto-resolved).", "ONBOARD")
                    changed.append(alert)
        return changed

    @staticmethod
    def _note(alert: Alert, now: datetime, text: str, origin: str) -> None:
        alert.notes.append({"ts": iso(now), "text": text, "origin": origin})

    def _resolve(self, alert: Alert, now: datetime, text: str, origin: str) -> None:
        alert.state = AlertState.RESOLVED
        alert.resolved_ts = now
        self._note(alert, now, text, origin)

    def ack(self, alert_id: str, now: datetime) -> Alert:
        alert = self.alerts[alert_id]
        if alert.state == AlertState.RAISED:
            alert.state = AlertState.ACKNOWLEDGED
            alert.ack_ts = now
            self._note(alert, now, "Acknowledged by crew.", "ONBOARD")
        return alert

    def treat(self, alert_id: str, now: datetime, text: str = "Treatment started by crew.") -> Alert:
        """RAISED or ACKNOWLEDGED -> IN_TREATMENT. Acknowledges first if needed."""
        alert = self.alerts[alert_id]
        if alert.state in (AlertState.RAISED, AlertState.ACKNOWLEDGED):
            if alert.ack_ts is None:
                alert.ack_ts = now
            alert.state = AlertState.IN_TREATMENT
            self._note(alert, now, text, "ONBOARD")
        return alert

    def resolve(self, alert_id: str, now: datetime, text: str = "Resolved by crew.") -> Alert:
        alert = self.alerts[alert_id]
        if alert.state != AlertState.RESOLVED:
            self._resolve(alert, now, text, "ONBOARD")
        return alert

    def note(self, alert_id: str, now: datetime, text: str, origin: str = "ONBOARD") -> Alert:
        alert = self.alerts[alert_id]
        self._note(alert, now, text, origin)
        return alert
