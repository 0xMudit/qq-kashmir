"""Send a synthetic route; run alongside the API."""

import math, os, time
import httpx

with httpx.Client(
    base_url=os.getenv("API_URL", "http://localhost:8000"),
    headers={"x-api-key": os.environ["API_KEY"]},
) as client:
    for i in range(120):
        response = client.post(
            "/positions",
            json={
                "vehicle": "demo-bike",
                "seq": time.time_ns() // 1000000,
                "lat": 34.0837 + 0.01 * math.sin(i / 10),
                "lon": 74.7973 + 0.01 * math.cos(i / 10),
            },
        )
        response.raise_for_status()
        time.sleep(1)
