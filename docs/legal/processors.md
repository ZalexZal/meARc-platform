# Processors and transfers (GDPR art. 28, 44-49)

| Company | Role | What they get | Where | Contract / safeguard | Operator action |
|---|---|---|---|---|---|
| Supabase Inc. | Processor | The whole database, auth, file storage, account emails | EU (Frankfurt, eu-central-1); company in the US | Supabase DPA with SCCs | **Sign the DPA**: Supabase publishes it at supabase.com/legal/dpa with the steps to sign it. Keep the signed PDF in this folder. |
| Netlify Inc. | Processor | Website visitors' IP addresses in logs | US / global CDN | Netlify's DPA with SCCs and DPF - check on netlify.com that it covers the free plan | None beyond keeping the account; note the DPA link in this file when checked |
| Email provider (Gmail SMTP, connected since 20 November 2026) | Processor | Recipients' addresses and email contents | Google, global | Google Workspace/Gmail terms | If a paid provider (Brevo, once there is a domain) replaces Gmail, sign its DPA |
| Google (ARCore) | Independent controller | Camera-derived visual features, approximate location, device and usage data | Global | Google's terms; disclosed in-app and in the privacy policy as ARCore's terms require | None |
| Google (Play) | Independent controller | Store and install data | Global | Play Developer Distribution Agreement | Accept when opening the Play account |
| Stadia Maps | Independent controller (tile server) | IP, viewed map area | EU/US | Stadia's terms (free non-commercial plan) | Move to a paid plan if meARc ever earns money |
| Esri (fallback tiles) | Independent controller | IP, viewed map area | US | Esri's terms | None |
| OpenFreeMap | Independent controller | IP, viewed map area (website) | EU | Open service | None |
| Nominatim (OpenStreetMap Foundation) | Independent controller | The place name a creator types into the builder's city search, and their IP | EU/UK | OSM Foundation's usage policy | None; added 2026-11 from the code, not yet reviewed by the operator |
| Google (Gemini API, free plan) | Independent controller on the free plan | The text of a stop, when a creator presses Translate or makes a model from a description | Global | Google's Gemini API terms: on the free plan Google may keep and use inputs | Decide whether this is acceptable; the privacy policy already names it |
| Hugging Face | Independent controller | The photo or description a creator uses to make a 3D model with AI (photos are scaled down and stripped of location data first) | US/EU | Hugging Face's terms | Same as above |

A processor may not use data for its own purposes, must keep it confidential,
help with data subject requests and breaches, and delete it at the end - the
DPAs above say so. Check each once a year that the link and terms still hold.
