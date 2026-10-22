# Запуск на global.kolyach.me

Инструкция для Linux-сервера с Docker Compose v2.20+ и nginx, установленным **на хосте**. HTTPS для `global.kolyach.me` уже настроен. Node.js на сервер устанавливать не нужно.

Схема: Telegram → nginx (HTTPS :443) → `127.0.0.1:3000` → контейнер Node.js → постоянный volume SQLite.

## 1. Конфигурация

Разместить файлы проекта на сервере и перейти в каталог с `compose.yaml`. Для первого запуска:

```sh
cp .env.example .env
chmod 600 .env
```

Заполнить в `.env`:

```dotenv
BOT_TOKEN=настоящий_токен_из_BotFather
WEBHOOK_SECRET=случайный_секрет
ADMIN_IDS=telegram_id_лины,telegram_id_максима
APP_PORT=3000
DISPLAY_TIMEZONE=Europe/Moscow
WEBHOOK_URL=https://global.kolyach.me/telegram/webhook
```

`ADMIN_IDS` — именно два числовых ID пользователей, а не username. Для `WEBHOOK_SECRET` можно использовать результат `openssl rand -hex 32`. Заменить все демонстрационные значения из `.env.example`.

Переменные `HOST`, `PORT` и `DB_PATH` из `.env.example` относятся к запуску без Docker. Compose задаёт внутри контейнера `0.0.0.0:3000` и `/data/participants.sqlite`. `APP_PORT` меняет только порт на хосте. Если 3000 уже занят, выбрать другой `APP_PORT` и заменить порт в обеих директивах `proxy_pass` файла `deploy/nginx.locations.conf`.

## 2. Сборка и запуск

```sh
docker compose --env-file .env config --quiet
docker compose build --pull
docker compose up -d --wait --wait-timeout 60
docker compose ps
curl --fail --silent --show-error http://127.0.0.1:3000/healthz
```

Ожидается статус `healthy` и ответ `ok`. При ошибке: `docker compose logs --tail=100 bot`.

Образ основан на `node:24-bookworm-slim`; `--pull` получает актуальные исправления ветки Node 24 при сборке. Секреты и локальные базы исключены из build context. Приложение работает от пользователя `node`, с корневой файловой системой только для чтения. Порт публикуется исключительно на loopback хоста.

SQLite хранится в именованном volume **`lina-psycho-bot-data`**, весь каталог `/data` доступен для записи. Docker создаст новый volume с владельцем каталога из образа; ручной `chmod 777` не нужен. Имя volume фиксировано и не зависит от имени каталога проекта.

## 3. Подключение существующего nginx

Файл `deploy/nginx.locations.conf` содержит только два блока `location`: webhook и health check. Подключить его **внутри существующего HTTPS `server {}` для `global.kolyach.me`**. Например:

```sh
sudo install -d /etc/nginx/snippets
sudo install -m 644 deploy/nginx.locations.conf /etc/nginx/snippets/lina-psycho-bot.locations.conf
```

В существующий блок сайта добавить:

```nginx
server {
    # Уже существующие listen, server_name, сертификаты и другие настройки сайта.
    include /etc/nginx/snippets/lina-psycho-bot.locations.conf;
}
```

Это пример места включения, а не новый полный конфиг сайта. Если точные `location = /telegram/webhook` или `location = /healthz` уже существуют, обновить их вместо добавления дублей.

Проверить и применить:

```sh
sudo nginx -t
sudo systemctl reload nginx
curl --fail --silent --show-error https://global.kolyach.me/healthz
```

Перезагрузку выполнять после успешного `nginx -t`. Ожидается `ok`.

Проверить отказ запроса без секретного заголовка:

```sh
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  --request POST --header 'Content-Type: application/json' \
  --data '{"update_id":0}' https://global.kolyach.me/telegram/webhook
```

Ожидается **403**. Nginx передаёт секретный заголовок клиента приложению; сам секрет в конфиг nginx не записывается. Webhook-путь сохраняется без изменения, таймаут ответа — 30 секунд.

Если nginx работает в другом контейнере, его `127.0.0.1` не указывает на хост. Для такого случая потребуется общая Docker-сеть и upstream `bot:3000`; приведённый файл рассчитан на nginx на хосте.

## 4. Регистрация webhook в Telegram

После успешных локальной и публичной проверок:

```sh
docker compose exec -T bot node scripts/set-webhook.js
```

Ожидается JSON-событие `webhook_registered` и код выхода 0. Скрипт использует переменные контейнера и не требует `.env` внутри образа. Ожидающие события Telegram сохраняются. При обычном старте контейнера webhook автоматически не меняется.

Затем открыть бота в Telegram и проверить:

1. `/start` показывает приветствие и кнопку регистрации.
2. Нажатие кнопки подтверждает регистрацию; повторные действия не создают дубликаты.
3. Оба администратора видят `/stats` и `/participants`; обычному пользователю в доступе отказано.
4. После пересоздания контейнера данные остаются:

```sh
docker compose up -d --force-recreate --wait --wait-timeout 60
```

Снова проверить `/stats` и статус ранее зарегистрированного пользователя.

## Обслуживание

Просмотр состояния и логов:

```sh
docker compose ps
docker compose logs --tail=100 -f bot
```

После замены исходников обновить приложение:

```sh
docker compose build --pull
docker compose up -d --wait --wait-timeout 60
```

При изменении токена, секрета или URL сначала применить новую конфигурацию через `docker compose up -d --wait`, затем снова выполнить `scripts/set-webhook.js` внутри контейнера. Если меняется только текст приветствия, достаточно пересобрать образ и пересоздать контейнер.

`restart: unless-stopped` поднимает контейнер после падения процесса или перезапуска Docker. Health check отмечает недоступный процесс как `unhealthy`, но сам по себе не перезапускает его. Остановка через Compose даёт приложению 30 секунд на завершение текущих запросов. Логи ограничены тремя файлами по 10 MiB.

### Резервная копия

Для небольшой базы MVP достаточно короткой остановки и архива **всего** каталога `/data`, включая возможные WAL-файлы. Следующие команды выполнять из каталога проекта в Linux shell:

```sh
umask 077
mkdir -p backups
docker compose stop bot
docker compose run --rm -T --no-deps --entrypoint tar bot \
  -C /data -czf - . > "backups/participants-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
docker compose start bot
```

После архивации запустить бота даже в случае ошибки копирования и проверить `docker compose ps`. Проверить содержимое созданного архива командой `tar -tzf backups/имя_архива.tar.gz` и хранить копию вне сервера. Архив содержит контакты участников.

Обычные `docker compose down` и пересоздание контейнера сохраняют volume. **`docker compose down --volumes` удаляет базу** — для обновлений эта команда не нужна. Полный набор контейнера не требует запуска нескольких экземпляров: одну базу обслуживает один процесс бота.
