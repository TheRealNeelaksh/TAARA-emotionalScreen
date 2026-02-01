import asyncio
import json
import random
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow all for development convenience
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {"status": "ok", "backend": "connected"}

@app.on_event("startup")
async def startup_event():
    print("Server Startup: Preloading models...")
    # Trigger STT model load
    import stt_engine
    if stt_engine.model is None:
        print("WARNING: STT Model failed to load.")
    else:
        print("STT Engine Ready.")

@app.get("/llm-status")
async def llm_status():
    from llm_client import LLM_URL
    import httpx
    try:
        # Simple ping to see if LLM server is reachable
        base_url = LLM_URL.replace("/v1/chat/completions", "/v1/models") 
        async with httpx.AsyncClient() as client:
            resp = await client.get(base_url, timeout=2.0)
            if resp.status_code == 200:
                return {"status": "connected", "details": "LLM reachable"}
    except Exception:
        pass
    return {"status": "disconnected", "details": "LLM unreachable"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("Client connected")
    try:
        while True:
            # Flexible Receive (Text or Bytes)
            message = await websocket.receive()
            
            try:
                if "bytes" in message:
                    # Binary (Audio) -> Transcribe
                    # print("Received Audio Blob...")
                    await websocket.send_text(json.dumps({"status": "transcribing"}))
                    
                    data_bytes = message["bytes"]
                    from stt_engine import transcribe_audio_bytes
                    
                    # Run in thread to allow WS pings to process
                    user_text = await asyncio.to_thread(transcribe_audio_bytes, data_bytes)
                    print(f"Heard: {user_text}")
                    
                    # Notify frontend of what was heard
                    await websocket.send_text(json.dumps({"user_text": user_text, "status": "llm_processing"}))
                    
                    if not user_text:
                        print("Transcription empty (Silence or Error). Resetting to listening.")
                        await websocket.send_text(json.dumps({"status": "listening", "info": "no_speech_detected"}))
                        continue # Ignore internal noise
                        
                    input_text = user_text
                
                elif "text" in message:
                    # Text input (fallback/manual)
                    input_text = message["text"]
                    print(f"Received Text: {input_text}")
                    await websocket.send_text(json.dumps({"user_text": input_text, "status": "llm_processing"}))
                
                else:
                    # Unknown frame type
                    print("Unknown frame type received.")
                    continue

                # Real LLM Logic (Shared)
                from llm_client import generate_response
                response = await generate_response(input_text)
                
                # Generate TTS Audio
                if "response_text" in response:
                    # Send text immediately so user can read while audio generates
                    await websocket.send_text(json.dumps({
                        "status": "generating_audio", 
                        "response_text": response['response_text']
                    }))
                    
                    from tts_engine import generate_audio_base64
                    print(f"Generating audio for: {response['response_text']}")
                    
                    # Run in thread
                    audio_b64 = await asyncio.to_thread(generate_audio_base64, response['response_text'])
                    if audio_b64:
                        response["audio"] = audio_b64
                
                response["status"] = "speaking"
                await websocket.send_text(json.dumps(response))
            
            except Exception as e:
                print(f"Error processing message: {e}")
                # Optional: Send error to client so they know it failed instead of hanging
                # await websocket.send_text(json.dumps({"error": str(e), "status": "listening"}))
            
    except WebSocketDisconnect:
        print("Client disconnected")
