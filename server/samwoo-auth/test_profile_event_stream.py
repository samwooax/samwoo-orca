import io
import queue
import unittest

import profile_event_stream
import workspace_sharing


class MemoryHandler:
    def __init__(self, authorization="Bearer token"):
        self.headers = {"Authorization": authorization}
        self.status = None
        self.response_headers = {}
        self.wfile = io.BytesIO()

    def send_response(self, status):
        self.status = status

    def send_header(self, name, value):
        self.response_headers[name] = value

    def end_headers(self):
        pass


def drain(subscription):
    events = []
    while True:
        try:
            events.append(subscription.get_nowait())
        except queue.Empty:
            return events


class ProfileEventStreamTest(unittest.TestCase):
    def test_pubsub_presence_and_duplicate_login_connections(self):
        first = profile_event_stream.subscribe("ai_center", "kim")
        second = profile_event_stream.subscribe("ai_center", "kim")
        peer = profile_event_stream.subscribe("ai_center", "lee")
        self.addCleanup(first.close)
        self.addCleanup(second.close)
        self.addCleanup(peer.close)
        self.assertEqual({"kim", "lee"}, profile_event_stream.online_logins("ai_center"))

        drain(first)
        profile_event_stream.publish("ai_center", {"type": "message", "id": "one"})
        self.assertEqual("message", first.get_nowait()["type"])
        first.close()
        self.assertEqual({"kim", "lee"}, profile_event_stream.online_logins("ai_center"))
        second.close()
        self.assertEqual({"lee"}, profile_event_stream.online_logins("ai_center"))
        peer.close()
        self.assertEqual(set(), profile_event_stream.online_logins("ai_center"))

    def test_bounded_queue_drops_oldest_events(self):
        subscription = profile_event_stream.subscribe("sales", "park")
        self.addCleanup(subscription.close)
        drain(subscription)
        for index in range(profile_event_stream.SUBSCRIBER_QUEUE_SIZE + 10):
            profile_event_stream.publish("sales", {"type": "message", "index": index})
        events = drain(subscription)
        self.assertEqual(profile_event_stream.SUBSCRIBER_QUEUE_SIZE, len(events))
        self.assertEqual(10, events[0]["index"])

    def test_sse_rejects_invalid_sessions(self):
        handler = MemoryHandler()

        def reject(_token):
            raise workspace_sharing.WorkspaceShareError("expired")

        profile_event_stream.handle_event_stream(handler, identity=reject)
        self.assertEqual(401, handler.status)

    def test_sse_handshake_snapshot_and_expiration(self):
        handler = MemoryHandler()
        profile_event_stream.handle_event_stream(
            handler,
            heartbeat_seconds=0.01,
            max_iterations=1,
            identity=lambda _token: ("kim", "ai_center"),
        )
        self.assertEqual(200, handler.status)
        self.assertEqual("text/event-stream", handler.response_headers["Content-Type"])
        self.assertEqual("no-store", handler.response_headers["Cache-Control"])
        self.assertIn(b'"type":"snapshot"', handler.wfile.getvalue())

        calls = 0

        def expire(_token):
            nonlocal calls
            calls += 1
            if calls > 1:
                raise workspace_sharing.WorkspaceShareError("expired")
            return "kim", "ai_center"

        expired_handler = MemoryHandler()
        profile_event_stream.handle_event_stream(expired_handler, identity=expire)
        self.assertIn(b'"type":"expired"', expired_handler.wfile.getvalue())


if __name__ == "__main__":
    unittest.main()
