from faster_whisper import WhisperModel, download_model
import os
import uuid
import time
import tempfile


# Configuration
# "tiny" is the fastest. "base" is a good balance.
# compute_type="int8" is faster on CPU.
MODEL_SIZE = "tiny" 
DEVICE = "cpu" 
COMPUTE_TYPE = "int8"

# Local model path
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(PROJECT_ROOT, "models")

print(f"Loading Faster-Whisper Model ({MODEL_SIZE})...")
try:
    print(f"Checking for model '{MODEL_SIZE}' in {MODELS_DIR}...")
    
    # Ensure directory exists
    os.makedirs(MODELS_DIR, exist_ok=True)
    
    # Download to local directory
    # Note: download_model returns the path to the specific model version folder
    model_path = download_model(MODEL_SIZE, output_dir=MODELS_DIR)
    print(f"Model stored at: {model_path}")
    
    model = WhisperModel(model_path, device=DEVICE, compute_type=COMPUTE_TYPE)
    print("Faster-Whisper Model Loaded Successfully.")
except Exception as e:
    print(f"CRITICAL ERROR loading Faster-Whisper: {e}")
    model = None

def transcribe_audio_bytes(audio_bytes: bytes) -> str:
    """
    Saves audio bytes to a temp file, runs Faster-Whisper, and returns text.
    """
    if not model:
        return "Error: STT Model not loaded."

    # Use system temp directory to avoid triggering file watchers (Live Server) in project root
    temp_filename = os.path.join(tempfile.gettempdir(), f"temp_rec_{uuid.uuid4()}.wav")
    
    try:
        with open(temp_filename, "wb") as f:
            f.write(audio_bytes)
            
        print(f"STT: Processing {len(audio_bytes)} bytes...")
        # Transcribe
        segments, info = model.transcribe(temp_filename, beam_size=1)
        
        # Combine segments
        text = " ".join([segment.text for segment in segments]).strip()
        print(f"STT: Transcribed '{text}'")
        
        return text
    except Exception as e:
        print(f"STT Error: {e}")
        return ""
    finally:
        if os.path.exists(temp_filename):
            try:
                os.remove(temp_filename)
            except:
                pass
