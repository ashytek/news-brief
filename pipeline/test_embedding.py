"""
Diagnoses which Google embedding models are available for the configured API key,
then tests the best available one.
Run from the pipeline/ directory:
    python test_embedding.py
"""
import os, sys, requests
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")

if not GOOGLE_API_KEY:
    print("ERROR: GOOGLE_API_KEY not found in .env")
    sys.exit(1)

BASE = "https://generativelanguage.googleapis.com"

# ── Step 1: List all available models ──────────────────────────────────────
print("Fetching available models…")
r = requests.get(f"{BASE}/v1beta/models", params={"key": GOOGLE_API_KEY}, timeout=15)
if r.status_code != 200:
    print(f"ListModels failed ({r.status_code}): {r.text}")
    sys.exit(1)

all_models = r.json().get("models", [])
embed_models = [
    m for m in all_models
    if "embedContent" in m.get("supportedGenerationMethods", [])
]

print(f"\nAll models: {len(all_models)}")
print(f"Models supporting embedContent: {len(embed_models)}")
for m in embed_models:
    name = m["name"]
    dims = m.get("outputDimensionality", "?")
    print(f"  • {name}  (dims={dims})")

if not embed_models:
    print("\nNo embedding models found — check your API key / project quota.")
    sys.exit(1)

# ── Step 2: Prefer text-embedding-004, else first available ────────────────
preferred = next(
    (m for m in embed_models if "text-embedding-004" in m["name"]),
    embed_models[0]
)
model_name = preferred["name"]   # e.g. "models/text-embedding-004"
dims = preferred.get("outputDimensionality", "?")
print(f"\nUsing: {model_name}  (dims={dims})")

# ── Step 3: Try v1beta endpoint ────────────────────────────────────────────
for api_ver in ("v1beta", "v1"):
    url = f"{BASE}/{api_ver}/{model_name}:embedContent"
    payload = {
        "model": model_name,
        "content": {"parts": [{"text": "Hello, this is a test embedding."}]}
    }
    resp = requests.post(url, params={"key": GOOGLE_API_KEY}, json=payload, timeout=30)
    print(f"\nPOST {url}  →  {resp.status_code}")
    if resp.status_code == 200:
        values = resp.json()["embedding"]["values"]
        print(f"✓ Success — {len(values)}-dimension vector")
        print(f"  First 5 values: {values[:5]}")
        print(f"\n  Working config: api_ver={api_ver!r}, model={model_name!r}")
        break
    else:
        print(f"  Error: {resp.json().get('error', {}).get('message', resp.text)}")
else:
    print("\n✗ Both v1beta and v1 failed — see errors above")
    sys.exit(1)
