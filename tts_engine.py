from elevenlabs.client import ElevenLabs
import base64
import os

# Initialize ElevenLabs Client
# Assumes ELEVENLABS_API_KEY is in environment variables or .env
try:
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        print("TTS WARNING: ELEVENLABS_API_KEY not found in environment variables.")
        client = None
    else:
        print(f"TTS: ElevenLabs API Key found (starts with: {api_key[:4]}...)")
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
        voice_id = os.getenv("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
        print(f"TTS: Generating with Voice ID: {voice_id}")

        # Generate audio generator
        audio_generator = client.text_to_speech.convert(
            text=text,
            voice_id=voice_id,
            model_id="eleven_multilingual_v2",
            output_format="mp3_44100_128",
        )
        
        # Collect all bytes from generator
        # The convert method returns a generator that yields bytes
        audio_bytes = b"".join(audio_generator)
        
        if not audio_bytes:
            print("TTS Error: ElevenLabs returned empty audio bytes.")
            return None

        # Convert to Base64
        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
        
        return audio_base64

    except Exception as e:
        print(f"ElevenLabs TTS Error: {e}")
        return None
