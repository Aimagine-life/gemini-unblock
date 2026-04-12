# Gemini Unblock

Chromium extension that routes AI services through your own proxy. Bypass geo-restrictions for Gemini, AI Studio, ChatGPT, Claude and others.

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
3. Click **Test proxy** to verify
4. Go back, enable the master toggle

## Supported services

| Service | Domains |
|---|---|
| Gemini | gemini.google.com |
| AI Studio | aistudio.google.com |
| NotebookLM | notebooklm.google.com |
| ChatGPT | chatgpt.com, chat.openai.com |
| Claude | claude.ai |
| Perplexity | perplexity.ai |

Google Auth (accounts.google.com) is auto-routed when any Google AI service is enabled.

## Proxy protocols

HTTP, HTTPS, SOCKS5, SOCKS4. Authentication supported.

## Tech

Manifest V3, vanilla JS, no dependencies, no build step. Tests: `npm test`.

---

# Gemini Unblock (RU)

Расширение для Chromium, которое направляет AI-сервисы через ваш прокси. Обход гео-ограничений для Gemini, AI Studio, ChatGPT, Claude и других.

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
3. Нажмите **Test proxy** для проверки
4. Вернитесь назад, включите главный переключатель

## Поддерживаемые сервисы

| Сервис | Домены |
|---|---|
| Gemini | gemini.google.com |
| AI Studio | aistudio.google.com |
| NotebookLM | notebooklm.google.com |
| ChatGPT | chatgpt.com, chat.openai.com |
| Claude | claude.ai |
| Perplexity | perplexity.ai |

Google Auth (accounts.google.com) подключается автоматически при включении любого Google AI сервиса.

## Протоколы

HTTP, HTTPS, SOCKS5, SOCKS4. Аутентификация поддерживается.

## Технологии

Manifest V3, чистый JS, без зависимостей, без сборки. Тесты: `npm test`.
