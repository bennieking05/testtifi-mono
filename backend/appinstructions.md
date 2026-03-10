# appinstructions.md — Repo & AI Onboarding Guide

> **Audience:** Cursor/Codex/ChatGPT agents and new contributors.
> **Action:** Index this file first. Use it as the source of truth for repo layout, AI capabilities, env scaffolding, and deployment expectations. Do **not** assume local machine access.

---

## 1) Product Overview
**Name:** Testifi AI  
**Purpose:** End‑to‑end ingestion and summarization of legal depositions/transcripts with page‑referenced citations, parties/case context, exportable DOCX/PDF, and quality controls suitable for regulated environments.

**Primary Jobs‑to‑Be‑Done**
- Upload or ingest transcripts (PDF/DOCX/TXT) and produce structured summaries with: court, case number, parties/counsel, issues, timelines, and **page‑line citations**.
- Extract entities (names, dates, exhibits), identify risk flags/contradictions, and surface follow‑up questions.
- Export final outputs (DOCX/PDF/HTML) and store artifacts with provenance.

---

## 2) Repository Orientation (what to scan/index)
> Agents: crawl these patterns; adapt to actual folders present.

- **Frontend**: `/frontend` or `/app` (React/Next/Vite). Check `package.json`, `vite.config.*` or `next.config.*`, `tsconfig.json`, `tailwind.config.*`.
- **Backend API**: `/backend`, `/api`, or `/server` (Express/FastAPI/Symfony). Look for `main.py` or `src/server.ts`, OpenAPI (`openapi.yaml`), `composer.json` or `pyproject.toml`.
- **Workers/Pipelines**: `/workers`, `/pipelines`, `/summarizer`, `/ocr`, `/embeddings`.
- **AI/Prompts**: `/ai`, `/llm`, `/prompts`, `/prompt_templates`.
- **Infra**: `Dockerfile*`, `docker-compose.*`, `/k8s` or `/deploy`, Helm charts, Terraform/Pulumi in `/infra`.
- **CI/CD**: `.github/workflows/*.yml`, `cloudbuild.yaml`, `.gitlab-ci.yml`.
- **Docs**: `/docs`, including `.env.example`, runbooks, and model cards.
- **Data contracts**: `/schemas`, `/models`, `/prisma`/`/alembic`, `openapi.*`.

---

## 3) Environments & URLs (placeholders only)
**Do not commit secrets.** Use these keys as references and create `.env.example` files.

### Frontend (.env)
- `VITE_API_BASE_URL=` e.g., `http://localhost:8000`
- `VITE_OKTA_ISSUER=` e.g., `https://example.okta.com/oauth2/default`
- `VITE_OKTA_CLIENT_ID=` `<OKTA_CLIENT_ID>`
- Optional: analytics flags, feature toggles.

### Backend (.env)
- `PORT=` `8000`
- `ALLOWED_ORIGINS=` `http://localhost:3000,https://app.example.com`
- `DB_URL=` `<DB_CONNECTION_STRING>` (Postgres/MySQL) or `MONGO_URL=` `<MONGO_CONN>`
- `STORAGE_BUCKET=` `<GCS_OR_S3_BUCKET>`
- `SENDGRID_API_KEY=` `<SENDGRID_KEY>` (if email)
- `AZURE_OPENAI_ENDPOINT=` `<AOAI_ENDPOINT>` / `AZURE_OPENAI_API_KEY=` `<AOAI_KEY>` (if AOAI)
- `VERTEX_PROJECT_ID=` `<GCP_PROJECT>` / `VERTEX_LOCATION=` `<REGION>` / `VERTEX_MODEL_ID=` `<MODEL_ID>` (if Vertex AI)
- `OPENAI_API_KEY=` `<OPENAI_KEY>` (if OpenAI direct)

> **Callback URIs**: Ensure IdP (Okta) includes: `http://localhost:3000/login/callback` and/or `http://localhost:8000/login/callback` depending on FE/BE flow.

---

## 4) AI/ML Capabilities (what this app supports)

### 4.1 Tasks
- **Summarization:** Long‑document, sectioned, with **page/line citations** and headings required by legal teams.
- **Segmentation & Topic Mining:** Split transcript into logical segments (witness intro, direct/cross, exhibits).
- **Entity & Issue Extraction:** Parties, counsel, dates, key facts, contradictions, risk flags.
- **Question Proposals:** Follow‑ups and cross‑examination leads.
- **Exporters:** DOCX/PDF/HTML with styles and watermarks.

### 4.2 Models (configurable)
- **Base LLM:** `gpt-4o` / `gpt-5-mini` / `azure/gpt-*` / `vertex/text-*` (select via env).  
- **Embeddings:** `text-embedding-*` (OpenAI/Azure) or `vertexembedding/textembedding-gecko`.  
- **OCR (optional):** Google Vision OCR for scanned PDFs.  
- **ASR (optional):** Whisper/Vertex for audio if ingesting recordings.

> Agents: resolve model **providers** and **IDs** from `/ai/config.*`, `.env`, or `services/llmClient.*`. Never hard‑code keys.

### 4.3 Retrieval & Chunking
- Chunk transcripts by **page/line** to preserve citations; store chunk IDs and anchors.  
- Maintain a vector index (pgvector/Mongo+Embeddings/Weaviate) keyed by document/version.  
- RAG prompts must include chunk anchors so the model cannot invent citations.

### 4.4 Agentic Orchestration
- Orchestrator coordinates tools: **ingest → OCR → chunk → embed → RAG → summarize → QA → export**.  
- Tools exposed: file store, vector store, OpenAI/Azure/Vertex LLMs, PDF/DOCX writer, redactor.  
- Use **deterministic tool routing** where possible (content type → pipeline), with retries/backoffs.

### 4.5 Fine‑Tuning & Data Pipeline (if enabled)
- **Buckets (GCS example):**  
  - `gs://deposition-summaries/human/` — curated human summaries  
  - `gs://deposition-summaries/pairs/` — **aligned JSONL** training pairs (input transcript refs → output summary)  
  - `gs://deposition-training-data/` — raw uploads  
- **Alignment Format (JSONL):**
  ```json
  {"input": {"doc_id": "<id>", "chunks": ["<text with page:line anchors>"]}, "output": {"summary": "<structured with citations>"}}
  ```
- Version models/prompts; keep **model cards** in `/docs/model_cards/` with provenance, evaluation, and change log.

### 4.6 Evaluation & QA
- Automatic checks: citation presence, section completeness, red‑flag keywords, length bounds.  
- Offline metrics (proxy): factual overlap, contradiction tests, ROUGE‑L (directional only).  
- **Golden set**: store n≥20 representative transcripts + expected summaries; run regression on PRs.

---

## 5) Safety, Privacy, and Compliance
- PII/PHI handling: redact on ingest where required; encrypt at rest; limit retention by policy.  
- Secrets: environment variables only; never commit.  
- Audit: log model provider, model ID, prompt hash, data doc_id, and export artifact IDs.  
- Compliance: SOC 2/GDPR/CCPA aligned; ensure Data Processing Addenda with model vendors.

---

## 6) Build/Run (derive, don’t assume)
> Agents: **read scripts** from `package.json` or tool configs and output exact commands in onboarding docs.

- **Frontend dev** (example): `pnpm dev` → expected `http://localhost:3000`  
- **Backend dev** (example): `uvicorn app.main:app --reload --port 8000` or `pnpm dev` for Express → `http://localhost:8000`  
- **Docker**: build with `VITE_*` build args for FE; map API base URL; no secrets in images.  
- **Kubernetes**: identify cluster/namespace, Ingress hosts, TLS certs, and Cloud SQL/Mongo connectors.

---

## 7) CI/CD Overview
- Detect GitHb Actions/GCP Cloud Build pipelines; list required **secrets** and branch filters.  
- Artifact registry naming; image tags; rollout strategy (canary/blue‑green).  
- Post‑deploy smoke tests: `/health`, `/ready`, summary generation on a tiny fixture.

---

## 8) Prompts & Versioning
- Store system/task prompts in `/prompts` with semantic names.  
- Add a **prompt header** block to outputs: `{prompt_id, version, model, temperature, toolset}`.  
- For each change, update `/docs/prompt_changelog.md`.

---

## 9) Maintenance & SRE
- Rotate model keys quarterly; support provider failover (Azure ↔ OpenAI ↔ Vertex).  
- Observability: central logging, trace IDs per job, error taxonomies.  
- Rate limits/backoffs defined per provider.  
- Data retention policy documented in `/docs/data_retention.md`.

---

## 10) Known Issues & Fallbacks (example patterns)
- **Okta invalid_request** due to missing redirect URI → add FE/BE callback to app config.  
- **405/CORS** between FE:3000 and BE:8000 → set `VITE_API_BASE_URL` and CORS allowlist.  
- **TLS/Ingress mismatch** on `www` hosts → ensure edge cert for hostname; min TLS 1.2.

---

## 11) What the Agent Should Produce (deliverables)
1. `/docs/repo_onboarding.md` — stack & layout, commands, env var tables, OAuth callbacks, CI/CD map, risks + fixes.  
2. `/docs/.env.example` for **frontend** and **backend** (placeholders only).  
3. `/docs/runbook_quickstart.md` — dev & deploy quickstart.  
4. (Optional) GitHub issue: **Onboarding Tasklist** with checkboxes.

---

## 12) Quick Checklist (for humans & agents)
- [ ] Index repo structure; detect FE/BE/Workers/Infra
- [ ] Generate `.env.example` files (no secrets)
- [ ] Validate OAuth redirect URIs vs IdP
- [ ] Verify FE↔BE base URL alignment + CORS
- [ ] Run golden summary regression locally/CI
- [ ] Confirm export paths and storage retention
- [ ] Produce Onboarding Report + Runbook

---

### Notes for Cursor/Codex
- Operate **repo‑only** (no local assumptions).  
- Be explicit with file paths and suggested diffs.  
- When in doubt, propose 1–2 sane defaults and document assumptions.

---

## Cursor Rules: Line Number Handling
- Do **not** default line numbers to `:1-25` for every row.
- Include line numbers **only when detected** from transcript text; otherwise **omit** line numbers.
- Placeholder rows for skipped/minimal pages must **omit** line numbers.
- Improve detection for OCR layouts (e.g., numbered lines in tables/pipes).
- Run a **LineNumberJudge** to verify line-number coverage and flag invalid ranges.
