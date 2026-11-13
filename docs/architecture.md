# Architecture and guarantees

GPS producers → validated monotonic upsert → PostgreSQL latest positions → authenticated HTTP polling → Leaflet map. Browser refreshes every two seconds. Sequence numbers must increase across device restarts. Stale or duplicate updates do not overwrite current coordinates. The beta keeps only latest positions and returns up to 1000 vehicles; historical routes, tenant isolation, freshness detection and WebSocket fanout are roadmap work. Map assets require internet access and use public OpenStreetMap tiles subject to their usage policy.
