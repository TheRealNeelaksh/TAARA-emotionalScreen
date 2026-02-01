import httpx
import json

# Configuration
# LMStudio / OpenAI Compatible Endpoint
LLM_URL = "http://127.0.0.1:11434/v1/chat/completions"

SYSTEM_PROMPT = """You are IRIS, a personal healthcare companion. 
Your traits: Calm, robotic but caring, minimal, gentle.
Your responses must be VERY short (under 15 words).
You must output ONLY valid JSON in this format:
{
  "response_text": "Your spoken response here",
  "delta_valence": 0.0, // Float between -0.3 (sad/concerned) and 0.3 (happy/encouraging)
  "delta_arousal": 0.0 // Float between -0.2 (calm) and 0.2 (alert)
}
Do not output anything else.
"""

async def generate_response(user_input: str):
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_input}
    ]
    
    payload = {
        "model": "local-model", # Some endpoints require a model name
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 50, # Restricted to prevent overlap
        "stream": False
    }

    print(f"Sending prompt to LLM ({LLM_URL})...")
    try:
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(LLM_URL, json=payload, timeout=30.0)
            except httpx.ConnectError:
                print("LLM Error: Connection Refused. Is LM Studio running and server started?")
                return mock_response(user_input)
            except httpx.ReadTimeout:
                print("LLM Error: Read Timeout. Model is taking too long.")
                return mock_response(user_input)
            
            if response.status_code == 200:
                data = response.json()
                print("LLM Response Received.")
                # OpenAI format: choices[0].message.content
                content = data["choices"][0]["message"]["content"]
                
                try:
                    parsed = json.loads(content)
                    return parsed
                except json.JSONDecodeError:
                    print(f"LLM JSON Error: {content}")
                    continue_parsing = attempt_fix_json(content)
                    if continue_parsing: return continue_parsing
                    
                    return {
                        "response_text": content[:150], 
                        "delta_valence": 0,
                        "delta_arousal": 0
                    }
            else:
                print(f"LLM Error {response.status_code}: {response.text}")

    except Exception as e:
        print(f"LLM Critical Error: {type(e).__name__} - {e}")
        pass
    
    # --- Fallback (Mock Baymax) ---
    return mock_response(user_input)

def attempt_fix_json(content):
    # simple attempt to find { ... }
    try:
        start = content.find('{')
        end = content.rfind('}')
        if start != -1 and end != -1:
            return json.loads(content[start:end+1])
    except:
        pass
    return None

def mock_response(text: str):
    text = text.lower()
    
    if "hello" in text or "hi" in text:
        return {"response_text": "[MOCK] Hello. I am IRIS.", "delta_valence": 0.1, "delta_arousal": 0.1}
    elif "sad" in text or "hurt" in text or "pain" in text:
        return {"response_text": "[MOCK] I am sensing you are in distress.", "delta_valence": -0.2, "delta_arousal": 0.0}
    elif "happy" in text or "good" in text:
        return {"response_text": "[MOCK] I am pleased to hear that.", "delta_valence": 0.2, "delta_arousal": 0.1}
    else:
        return {"response_text": "[MOCK] I am listening.", "delta_valence": 0.0, "delta_arousal": 0.0}

