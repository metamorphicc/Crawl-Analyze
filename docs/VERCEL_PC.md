# Публичная бета: сайт на Vercel, backend на домашнем ПК

Выбран пользователем 2026-10-09 вариант 1. Конфигурация подготовлена локально; агент не делает
push, не создаёт облачный проект и не публикует туннель. Этапы 13 и 14 целиком ещё не закрыты.

```text
https://YOUR_DOMAIN                  Vercel: static web
           │ browser fetch / EventSource to the API origin
           ▼
https://api.YOUR_DOMAIN              Cloudflare HTTPS tunnel
           ▼
http://127.0.0.1:3001                PC: Fastify API
           ▼
PostgreSQL + Redis                   PC: durable jobs, reports and events
           ▲
worker (+ optional Telegram bot)     PC: scan, monitoring and notifications
```

`YOUR_DOMAIN` в примерах нужно заменить своим доменом. Сайт и API используют один основной
домен, например `crawlspider.com` и `api.crawlspider.com`, оба через HTTPS. Это сохраняет
работу нынешних `SameSite=Lax` cookies для Telegram-привязки. Разные сайты, например
`project.vercel.app` и `random.trycloudflare.com`, годятся для проверки публичных сканов,
но сессионная привязка и watchlists в таком сочетании не поддерживаются текущими cookies.

## 1. Домен и постоянный туннель

1. Подключи свой домен к Cloudflare DNS: для постоянного hostname туннеля домен должен быть
   активен в Cloudflare. Если домена пока нет, публичный запуск всей схемы ещё не настроен.
2. В Cloudflare открой **Networking → Tunnels** (названия меню могут отличаться), создай
   Cloudflare Tunnel и выбери Windows connector.
3. Установи `cloudflared` по инструкции панели и выполни показанную там команду установки
   Windows-службы в терминале администратора. Токен туннеля — секрет; не сохраняй его в репозитории.
4. Создай Published application route / public hostname:
   - hostname: `api.YOUR_DOMAIN`;
   - service type: **HTTP**;
   - service URL: **127.0.0.1:3001** (итоговый origin: `http://127.0.0.1:3001`).
5. Не добавляй обязательный Cloudflare Access login для этого публичного API: браузеру нужны
   анонимные сканы, OPTIONS и SSE. Не включай кеширование API или buffering/event-stream transforms.

Запускай connector непосредственно в Windows на том же ПК, где слушает API, а не в отдельном
Docker-контейнере. Из контейнера `127.0.0.1` указывает на сам контейнер. Внешний API имеет HTTPS,
внутреннее соединение туннеля с loopback API — HTTP. Порты роутера открывать не нужно.

Документация: [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/),
[Windows download](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/),
[visitor headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/).

## 2. Настройки на ПК

В существующем игнорируемом `.env` оставь прежние `DATABASE_URL`, `REDIS_URL`, RPC/indexer и
Telegram credentials. Добавь / измени только публичные настройки:

```dotenv
NODE_ENV=production
API_HOST=127.0.0.1
API_PORT=3001
API_TRUST_LOOPBACK_PROXY=true
WEB_ORIGIN=https://YOUR_DOMAIN
PUBLIC_WEB_URL=https://YOUR_DOMAIN
TELEGRAM_MODE=polling
```

Не ставь `/` после origin и не пиши туда API-домен. `WEB_ORIGIN` — точный адрес сайта, с учётом
`www`, если он используется. `PUBLIC_WEB_URL` — тот же канонический адрес для ссылок из бота.
Если сайт перенаправляет `www` на основной домен, укажи основной домен. Preview URL Vercel не
добавляется в CORS автоматически; проверяй выбранный публичный сайт.

`API_TRUST_LOOPBACK_PROXY=true` доверяет только непосредственному прокси на loopback и берёт
ближайший адрес посетителя из `X-Forwarded-For`. Иначе все пользователи туннеля делят лимиты
одного локального IP. Режим запрещён при слушателе `0.0.0.0`; не открывай прямой API извне.
Для обычной локальной разработки настройка остаётся `false`.

PostgreSQL и Redis по-прежнему доступны только на `127.0.0.1`, как в `compose.yaml`.
Не публикуй их через туннель и не отправляй их URL в Vercel. Docker Desktop должен работать.

В корне проекта, после остановки прежних API/worker процессов, если они занимают те же порты:

```powershell
npm ci
npm run infra:up
npm run db:migrate
npm run build
```

В отдельных терминалах **из корня проекта**:

```powershell
node apps/api/dist/index.js
```

```powershell
node apps/worker/dist/index.js
```

Для Telegram-привязки, watchlists и уведомлений также запусти бота:

```powershell
node apps/bot/dist/index.js
```

Для обычных публичных сканов бот не требуется. Polling не требует ещё одного публичного порта.
Автозапуск API/worker/бота и резервное копирование баз — отдельная оставшаяся работа этапа 13.
Служба туннеля сама по себе не запускает эти Node-процессы и Docker Desktop.

## 3. Импорт в Vercel

1. Сам запушь локальный коммит с этими изменениями в GitHub после проверок. Vercel не видит файлы,
   которые ещё не попали в GitHub.
2. Импортируй репозиторий с **Root Directory `./`**, как на твоём скрине. Корневой `vercel.json`
   явно содержит **только `web`**, framework Vite, root `apps/web`. Пресет Services допустим:
   API отсутствует в конфигурации и не должен собираться/разворачиваться как сервис Vercel.
3. Используй Node **24.x**. Установку, сборку и папку результата задаёт `vercel.json`:
   `npm ci --prefix ../..`, `node ../../tools/build-service.mjs web`, `dist`.
   Build компилирует contracts и сайт; backend на Vercel не компилируется.
4. До Deploy добавь Environment Variable для Production:

   ```dotenv
   VITE_API_URL=https://api.YOUR_DOMAIN
   ```

   Это публичный origin API, **без `/api`, `/v1`, query или ключей**. Он вшивается в JavaScript
   при сборке. После изменения нужно пересобрать deployment. Vercel build останавливается с
   понятной ошибкой, если значение отсутствует, имеет HTTP/loopback адрес, credentials или путь.
   Для Preview можно задать тот же URL, но его произвольный сайт не разрешён production CORS.

5. Не добавляй в Vercel RPC keys, Telegram token, DATABASE_URL или REDIS_URL. Сайт их не использует.
6. После своего Deploy добавь `YOUR_DOMAIN` в **Project → Settings → Domains**. DNS-записи бери
   из панели Vercel, без придуманных IP/CNAME. В Cloudflare для записи сайта используй DNS-only;
   запись `api` остаётся за туннелем. Дождись HTTPS на обоих hostname.

Публичный маршрут Vercel `/(.*)` ведёт в `web`; сервисные rewrites для `/token/:mint`,
`/report/:id`, `/status`, `/methodology` и `/watchlist` ведут в `/index.html`. JavaScript,
CSS, шрифты и dev-server modules не переписываются в HTML. Новые клиентские страницы нужно
добавлять в этот список. Адреса отчётов и methodology можно открывать напрямую. Браузер вызывает внешнее API по
`VITE_API_URL + /v1/...`, включая SSE. `/v1` и `/health` не перенаправляются в локальный API
через Vercel. Service bindings отсутствуют: нет server-side вызовов между сервисами Vercel.

Конфигурация: [Vercel services](https://vercel.com/docs/services/config-reference),
[Vite SPA routing](https://vercel.com/docs/frameworks/frontend/vite).

## 4. Проверка твоего публичного запуска

1. На ПК `http://127.0.0.1:3001/health/ready` должен возвращать ready.
2. `https://api.YOUR_DOMAIN/health/ready` должен давать тот же ответ через туннель.
3. Открой `https://YOUR_DOMAIN`, введи mint: появляется задание, прогресс и реальные находки.
   В DevTools запросы должны идти к `https://api.YOUR_DOMAIN/v1/...`, без localhost, CORS errors
   и HTML вместо JSON. Если UI старый, проверь deployed commit и VITE_API_URL сборки.
4. Проверь прямую ссылку на отчёт, живой event stream и Telegram-привязку, если запущен бот.

Если API доступен напрямую, а сайт получает CORS error — сверяй точный `WEB_ORIGIN`, HTTPS и
домен браузера. Если туннель выдаёт 502 — сначала проверь локальный API и его порт. Если задание
зависло — проверь worker, DB/Redis и provider capabilities в `/v1/status`.

Выключение/сон ПК, остановка Docker/worker/API/туннеля или пропажа интернета остановят backend.
CDN продолжит открывать сам сайт. Сохранённые данные останутся в Docker volumes, но они не
заменяют резервную копию. Для постоянного сервиса backend позже переносится на always-on host;
архитектуру сканов для этого менять не нужно.

## Локальная проверка этой конфигурации

Актуальные результаты записаны в `docs/STATUS.md`. Локальные build, unit/browser проверки и
`vercel dev -L` не подтверждают, что твои DNS, Windows-служба, production CORS, SSE и cookies
через реальный туннель уже работают. Это проверяется только после твоего публичного запуска.
