# Gemini Unblock

Chromium extension that routes AI services and other geo-restricted sites through your own proxy.

## Install

1. Download or clone this repo
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** → select the `extension/` folder

## Setup

1. Click the extension icon → **Open settings**
2. Paste your proxy in any format:
   - `host:port:user:pass` (provider format)
   - `socks5://user:pass@host:port`
   - `http://host:port`
3. Protocol is auto-detected — or pick manually
4. Click **Test proxy** to verify
5. Go back, enable the master toggle

## Supported services

| Service | Domains |
|---|---|
| Gemini | gemini.google.com |
| AI Studio | aistudio.google.com |
| NotebookLM | notebooklm.google.com |
| Google Labs | labs.google |
| ChatGPT | chatgpt.com, chat.openai.com |
| Claude | claude.ai |
| Perplexity | perplexity.ai |
| Grok | grok.com, x.ai |
| ElevenLabs | elevenlabs.io |
| YouTube | youtube.com, youtu.be, googlevideo.com |

Custom domains can also be added — they're checked against the RKN registry before being accepted. RKN-blocked domains are rejected.

Google Auth (accounts.google.com) is auto-routed when any Google AI service is enabled.

## RKN compliance

The extension checks whether routed domains are blocked by Roskomnadzor. If a domain is in the RKN registry, routing is automatically disabled to comply with Russian law (149-FZ). Checks run on startup and every 24 hours.

## Proxy protocols

HTTP, HTTPS, SOCKS5, SOCKS4. Auto-detection supported. Authentication supported.

## Tech

Manifest V3, vanilla JS, no dependencies, no build step. Tests: `npm test`.

---

# Gemini Unblock (RU)

Расширение для Chromium, которое направляет AI-сервисы и другие гео-ограниченные сайты через ваш прокси.

## Установка

1. Скачайте или клонируйте репозиторий
2. Откройте `chrome://extensions`
3. Включите **Режим разработчика**
4. Нажмите **Загрузить распакованное** → выберите папку `extension/`

## Настройка

1. Кликните на иконку расширения → **Open settings**
2. Вставьте прокси в любом формате:
   - `host:port:user:pass` (формат провайдера)
   - `socks5://user:pass@host:port`
   - `http://host:port`
3. Протокол определяется автоматически — или выберите вручную
4. Нажмите **Test proxy** для проверки
5. Вернитесь назад, включите главный переключатель

## Поддерживаемые сервисы

| Сервис | Домены |
|---|---|
| Gemini | gemini.google.com |
| AI Studio | aistudio.google.com |
| NotebookLM | notebooklm.google.com |
| Google Labs | labs.google |
| ChatGPT | chatgpt.com, chat.openai.com |
| Claude | claude.ai |
| Perplexity | perplexity.ai |
| Grok | grok.com, x.ai |
| ElevenLabs | elevenlabs.io |
| YouTube | youtube.com, youtu.be, googlevideo.com |

Также можно добавить свои домены — они проверяются в реестре РКН перед добавлением. Заблокированные Роскомнадзором домены не принимаются.

Google Auth (accounts.google.com) подключается автоматически при включении любого Google AI сервиса.

## Соответствие закону

Расширение проверяет, не заблокированы ли маршрутизируемые домены Роскомнадзором. Если домен находится в реестре РКН, маршрутизация автоматически отключается в соответствии с законодательством РФ (149-ФЗ). Проверка выполняется при запуске и каждые 24 часа.

## Протоколы

HTTP, HTTPS, SOCKS5, SOCKS4. Автоопределение протокола. Аутентификация поддерживается.

## Технологии

Manifest V3, чистый JS, без зависимостей, без сборки. Тесты: `npm test`.
