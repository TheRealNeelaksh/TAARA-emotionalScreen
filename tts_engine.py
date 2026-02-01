from elevenlabs.client import ElevenLabs
import base64
import os

# Initialize ElevenLabs Client
# Assumes ELEVENLABS_API_KEY is in environment variables or .env
try:
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        print("WARNING: ELEVENLABS_API_KEY not found in environment.")
        client = None
    else:
        client = ElevenLabs(api_key=api_key)
except Exception as e:
    print(f"ElevenLabs Client Init Error: {e}")
    client = None

def generate_audio_base64(text: str) -> str:
    """
    Generates audio using ElevenLabs and returns Base64 string.
    """
    if not client:
        print("ElevenLabs Client not available.")
        return None

    try:
        # Generate audio generator
        audio_generator = client.text_to_speech.convert(
            text=text,
            voice_id="JBFqnCBsd6RMkjVDRZzb",
            model_id="eleven_multilingual_v2",
            output_format="mp3_44100_128",
        )
        
        # Collect all bytes from generator
        audio_bytes = b"".join(audio_generator)
        
        # Convert to Base64
        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
        
        return audio_base64

    except Exception as e:
        print(f"ElevenLabs TTS Error: {e}")
        return None
