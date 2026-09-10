"""Bounded websocket capture using upstream connection implementations."""
import gzip
import json
import threading
from google.protobuf.json_format import MessageToDict


def capture(auth, live_id=None):
    from static import Live_pb2, Response_pb2
    events = []
    connected = False
    failed = False
    timer = None

    def opened(ws):
        nonlocal connected, timer
        connected = True
        timer = threading.Timer(20, ws.close)
        timer.daemon = True
        timer.start()

    def error(ws, cause):
        nonlocal failed
        failed = True
        ws.close()

    def add(event):
        if len(events) < 300:
            events.append(event)

    if live_id:
        from dy_live.server import DouyinLive
        class Listener(DouyinLive):
            def on_open(self, ws):
                opened(ws)
                threading.Thread(target=self.ping, args=(ws,), daemon=True).start()
            def on_error(self, ws, cause):
                error(ws, cause)
            def on_close(self, *args):
                pass  # No recursive upstream reconnect after the capture window.
            def on_message(self, ws, message):
                frame = Live_pb2.PushFrame()
                frame.ParseFromString(message)
                response = Live_pb2.LiveResponse()
                response.ParseFromString(gzip.decompress(frame.payload))
                if response.needAck:
                    ack = Live_pb2.PushFrame()
                    ack.payloadType = 'ack'
                    ack.payload = response.internalExt.encode('utf-8')
                    ack.logId = frame.logId
                    ws.send(ack.SerializeToString(), opcode=2)
                types = {'WebcastGiftMessage': 'GiftMessage', 'WebcastChatMessage': 'ChatMessage', 'WebcastMemberMessage': 'MemberMessage', 'WebcastLikeMessage': 'LikeMessage', 'WebcastSocialMessage': 'SocialMessage', 'WebcastRoomStatsMessage': 'RoomStatsMessage'}
                for item in response.messagesList:
                    if item.method in types:
                        parsed = getattr(Live_pb2, types[item.method])()
                        parsed.ParseFromString(item.payload)
                        add({'event': item.method, 'data': MessageToDict(parsed)})
        listener = Listener(live_id, auth)
        try:
            listener.start_ws()
        finally:
            if timer: timer.cancel()
            if listener.ws: listener.ws.close()
    else:
        from dy_apis.douyin_recv_msg import DouyinRecvMsg
        class Listener(DouyinRecvMsg):
            def on_open(self, ws):
                opened(ws)
            def on_error(self, ws, cause):
                error(ws, cause)
            def on_close(self, *args):
                pass
            def on_message(self, ws, message):
                frame = Live_pb2.PushFrame()
                frame.ParseFromString(message)
                if frame.payloadType == 'pb':
                    response = Response_pb2.Response()
                    response.ParseFromString(frame.payload)
                    msg = response.body.new_message_notify.message
                    if msg.content:
                        add({'sender': str(msg.sender), 'conversation_id': msg.conversation_id, 'type': msg.message_type, 'content': json.loads(msg.content)})
        listener = Listener(auth, auto_reconnect=False)
        try:
            listener.start()
        finally:
            if timer: timer.cancel()
            listener.stop()
    if not connected or failed:
        raise RuntimeError('Websocket unavailable')
    return {'events': events, 'capture_seconds': 20, 'limit': 300}
