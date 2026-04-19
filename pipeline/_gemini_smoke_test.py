"""Quick smoke test — run once to verify Gemini is working, then delete."""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import llm
import summarise

print("=== Smoke Test: llm.py ===")
result = llm.flash_json(
    contents="What are three facts about emergency medicine?",
    system_instruction="Output a JSON object with a 'facts' array of 3 strings.",
    response_schema={
        "type": "object",
        "properties": {
            "facts": {"type": "array", "items": {"type": "string"}}
        },
        "required": ["facts"]
    }
)
print(f"Flash JSON: {result}")
print(f"Usage: {llm.get_usage()}")

print("\n=== Smoke Test: summarise_video (general) ===")
r = summarise.summarise_video(
    title="Iran drone strike on Red Sea cargo vessel",
    transcript=(
        "Iran-backed Houthi rebels struck a Liberian-flagged cargo ship in the Red Sea on Thursday. "
        "The US Navy confirmed moderate damage, no casualties. "
        "It is the 17th attack on commercial shipping this quarter. "
        "Shipping costs through Suez have risen 42% since January."
    ),
    segments=[],
    category="israel",
)
print(f"Headline: {r['headline'] if r else 'FAILED'}")
print(f"Bullets: {len(r['bullets']) if r else 0}")

print("\n=== Smoke Test: summarise_video (prophetic) ===")
r2 = summarise.summarise_video(
    title="Urgent word for America and Israel",
    transcript="",
    segments=[
        {"start": 35, "text": "I saw a great shaking coming to America in the fall of this year."},
        {"start": 61, "text": "The Lord said to me, Tell my people Israel will not be forsaken."},
        {"start": 90, "text": "Please partner with this ministry and sow a seed today."},
        {"start": 110, "text": "I also saw China making a move toward Taiwan before the year ends."},
    ],
    category="prophetic",
)
print(f"Headline: {r2['headline'] if r2 else 'FAILED'}")
if r2:
    for b in r2['bullets']:
        print(f"  • {b['text'][:80]}")

print("\n✅ Smoke test complete" if r and r2 else "\n❌ One or more tests failed")
