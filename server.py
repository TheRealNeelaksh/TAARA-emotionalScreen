import asyncio
import json
import random
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("Client connected")
    try:
        while True:
            data = await websocket.receive_text()
            print(f"Received: {data}")
            
            # Real LLM Logic
            from llm_client import generate_response
            response = await generate_response(data)
            
            await websocket.send_text(json.dumps(response))
            
    except WebSocketDisconnect:
        print("Client disconnected")
