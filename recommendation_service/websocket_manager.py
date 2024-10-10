import redis
from fastapi import WebSocket
from typing import List

import redis
import json

redis_client = redis.Redis(host="redis", port=6379, decode_responses=True)

class WebSocketManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    async def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            await connection.send_text(message)


    def publish_to_redis(self, channel: str, message: str):
        redis_client.publish(channel, message)

ws_manager = WebSocketManager()
