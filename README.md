# PULS Worker (Railway, 24/7)

Worker dla **inscore.pl** — sekcja **PULS** (krótkofalowy ranking insiderów na podstawie temperatury bieżących postów na X).

Dwie pętle 24/7 + serwer ops na jednym procesie Node 20:

- **Loop A — Filtered Stream**: persistent connection do `GET /2/tweets/search/stream` z regułami `from:@h1 OR from:@h2 …`. Każdy nowy tweet aktywnego insidera → INSERT `puls_tracked_posts` + pierwszy sampel metryk.
- **Loop B — Re-polling**: co 60s `GET /2/tweets?ids=…` (max 100/req, throttle 1200 ms) dla postów <6h, INSERT serii czasowej do `puls_post_metrics`. Dedup-aware: nie dolicza chargu jeśli post był już naliczony w tej dobie UTC.
- **Ops server (Fastify, port `$PORT`)**: `/health`, `/admin/kill-switch`, `/admin/reset-month-counter`, `/admin/resync-rules`. Wszystko poza `/health` chronione nagłówkiem `x-ops-secret`.

Worker **nigdy** nie pisze bezpośrednio do tabel — wszystko przez 6 RPC z PKG-PULS-02:
`worker_puls_heartbeat`, `worker_puls_upsert_tracked_post`, `worker_puls_insert_metrics_batch`, `worker_puls_get_posts_to_resample`, `worker_puls_get_active_handles`, `worker_puls_get_runtime_config`. Wszystkie z `GRANT EXECUTE` tylko dla `service_role`.

---

## 1. Wymagane sekrety / klucze

| Sekret | Skąd | Po co |
|---|---|---|
| `SUPABASE_URL` | `https://eigdnqbfohjmtzcfzrre.supabase.co` (już znane) | Endpoint Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API → `service_role` (secret) | RPC workera (omijają RLS) |
| `X_BEARER_TOKEN` | developer.x.com → Project → App → Keys & tokens → Bearer Token | Filtered Stream + lookup |
| `WORKER_OPS_SECRET` | Wygeneruj sam: `openssl rand -hex 32` | Ochrona endpointów `/admin/*` |

> **Uwaga**: `SUPABASE_SERVICE_ROLE_KEY` to **inny klucz** niż `WORKER_OPS_SECRET`. Pierwszy to dostęp do Supabase, drugi to Twój własny shared secret do endpointów ops workera.

---

## 2. Deploy na Railway — krok po kroku

### Krok 1 — Wrzuć kod do Twojego nowego repo GitHub
1. Skopiuj zawartość katalogu `puls-worker/` do roota Twojego repo (lub do podkatalogu — wtedy ustaw Root Directory w Railway).
2. Push do `main`.

### Krok 2 — Stwórz projekt na Railway
1. https://railway.app → **New Project** → **Deploy from GitHub repo** → wybierz repo `puls-worker`.
2. Railway wykryje `Dockerfile` automatycznie. Jeśli kod jest w podkatalogu, w **Settings → Root Directory** podaj ścieżkę.

### Krok 3 — Dodaj zmienne środowiskowe
W Railway: **Variables → Raw Editor**. Wklej i uzupełnij:

```
SUPABASE_URL=https://eigdnqbfohjmtzcfzrre.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<wklej z Supabase Dashboard>
X_BEARER_TOKEN=<wklej z X Developer Portal>
WORKER_OPS_SECRET=<wklej swój losowy 32+ znakowy string>
LOG_LEVEL=info
RESAMPLE_LOOP_INTERVAL_MS=60000
RULE_RESYNC_INTERVAL_MS=300000
HEARTBEAT_INTERVAL_MS=30000
TWEET_LOOKUP_THROTTLE_MS=1200
RESAMPLE_BATCH_SIZE=100
```

`PORT` Railway wstrzykuje automatycznie — nie ustawiaj ręcznie.

### Krok 4 — Restart usługi
Po zapisaniu zmiennych Railway zrobi redeploy. W zakładce **Deployments → Logs** powinieneś zobaczyć:
```
PULS worker starting…
ops server listening port=8080
stream rules synced rules=N handles=M
stream connected
```

### Krok 5 — Healthcheck
Railway wystawi publiczny URL (np. `https://puls-worker-production.up.railway.app`).
```
curl https://<twój-url>/health
```
Oczekiwany JSON: `{"ok":true,"stream_status":"connected", ...}`.

### Krok 6 — Test kill-switcha (opcjonalnie)
```
curl -X POST https://<twój-url>/admin/kill-switch \
  -H "x-ops-secret: <WORKER_OPS_SECRET>" \
  -H "content-type: application/json" \
  -d '{"tripped":true}'
```
Worker zatrzyma obie pętle. Cofnięcie: `{"tripped":false}`.

---

## 3. Lokalne uruchomienie (opcjonalnie)

```
cp .env.example .env
# uzupełnij sekrety
npm install
npm run dev
```

---

## 4. Bezpieczeństwo

- `SUPABASE_SERVICE_ROLE_KEY` **nigdy** nie trafia do frontendu — żyje tylko w Railway.
- Wszystkie RPC workera są `SECURITY DEFINER` z asercją `request.jwt.claims->>'role' = 'service_role'`.
- `WORKER_OPS_SECRET` chroni endpointy `/admin/*` — Twoja jedyna powierzchnia do operacji „z palca”.
- Hard-cap kosztów X API egzekwowany **w bazie** (`puls_global_settings.hard_cap_charges_month`) — worker pyta `worker_puls_get_runtime_config` i sam się pauzuje po przekroczeniu. Brak ryzyka „uciekającego workera”.

## 5. Co dalej (nie robione w tym repo)

- **PKG-PULS-03**: silnik scoringu (Edge Function `puls-recompute-ranking`, cron co 10 min) — żyje w Supabase, nie w Railway.
- **PKG-PULS-04/05**: UI publiczne i admin — żyje w głównym repo Lovable.
