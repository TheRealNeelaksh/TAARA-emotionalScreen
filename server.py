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
            
            # Stub Logic
            # Simulate processing time
            await asyncio.sleep(0.5)
            
            # Create response logic
            # Random emotion delta to show it works
            valence_delta = random.uniform(-0.3, 0.3)
            arousal_delta = random.uniform(-0.2, 0.2)
            
            response = {
                "text": f"Echo: {data}",
                "delta_valence": valence_delta,
                "delta_arousal": arousal_delta
            }
            
            await websocket.send_text(json.dumps(response))
            
    except WebSocketDisconnect:
        print("Client disconnected")
