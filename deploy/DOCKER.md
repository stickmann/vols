# Развёртывание вручную командами Docker

То же, что делает `deploy/install.sh`, но по шагам: удобно, чтобы понимать, что происходит, или если скрипт не подходит. Все команды выполняются на сервере под root. Вместо `vols.example.ru` подставьте свой домен.

Перед началом: A-запись домена указывает на IP сервера, чужой AAAA-записи нет, порты 80 и 443 открыты (см. [README.md](README.md), шаги 1–2).

## 1. Docker

```bash
curl -fsSL https://get.docker.com | sh
```

Проверка — обе команды должны вывести версии:

```bash
docker --version
```

```bash
docker compose version
```

## 2. Код нужного релиза

Ключ для доступа к приватному репозиторию (открытую часть добавьте на GitHub: Settings → Deploy keys, без права записи):

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 -C vols-server
```

```bash
cat ~/.ssh/id_ed25519.pub
```

```bash
git clone git@github.com:stickmann/vols.git /opt/vols
```

```bash
cd /opt/vols
```

Переключиться на последний релиз:

```bash
git checkout "$(. deploy/release.sh && latest_release)"
```

Или на конкретный: `git checkout v0.1.0`. Пока релизов нет, можно остаться на `main`.

## 3. Настройки `.env.prod`

Хэш пароля для входа на сайт (вместо `пароль` — свой; хэш понадобится ниже):

```bash
docker run --rm caddy:2.10-alpine caddy hash-password --plaintext 'пароль'
```

Создайте файл, подставив домен, логин и полученный хэш (`$2a$14$...`). Пароли базы генерируются автоматически:

```bash
cat > .env.prod <<EOF
SITE_ADDRESS='vols.example.ru'
POSTGRES_PASSWORD='$(openssl rand -hex 24)'
VOLS_APP_PASSWORD='$(openssl rand -hex 24)'
BASIC_AUTH_USER='admin'
BASIC_AUTH_HASH='ВСТАВЬТЕ_ХЭШ'
ALLOW_TENANT_HEADER='true'
VOLS_VERSION='$(git describe --tags --always)'
VITE_MAP_STYLE=''
VITE_SATELLITE_TILES=''
VITE_SATELLITE_ATTRIBUTION=''
EOF
```

```bash
chmod 600 .env.prod
```

Значения обязательно в одинарных кавычках: в хэше есть символы `$`.

## 4. Сборка и запуск

Все дальнейшие команды используют одни и те же параметры; чтобы не повторять их, задайте сокращение (действует до выхода из SSH):

```bash
alias dc='docker compose --env-file .env.prod -f docker-compose.prod.yml'
```

Если ВОЛС стоит за чужим веб-сервером (в `.env.prod` есть `EDGE_NETWORK`, см. «Сервер, где 80/443 уже заняты» в [README.md](README.md)), добавьте второй файл:

```bash
alias dc='docker compose --env-file .env.prod -f docker-compose.prod.yml -f docker-compose.edge.yml'
```

Сборка образов (первый раз 3–10 минут) и запуск базы, API и веба:

```bash
dc up -d --build
```

Миграции базы:

```bash
dc run --rm api node_modules/.bin/tsx src/scripts/migrate.ts
```

Демо-оператор с демо-сетью (необязательно, повторный запуск ничего не дублирует):

```bash
dc run --rm api node_modules/.bin/tsx src/scripts/seed.ts
```

Проверка — все три контейнера в состоянии `running` / `healthy`:

```bash
dc ps
```

Откройте `https://vols.example.ru/`. При первом заходе Caddy выпускает сертификат — до минуты.

## Обновление на новый релиз

```bash
cd /opt/vols
```

```bash
alias dc='docker compose --env-file .env.prod -f docker-compose.prod.yml'
```

Копия базы перед обновлением:

```bash
mkdir -p backups && dc exec -T db pg_dump -U vols -d vols | gzip > "backups/vols-$(date +%Y%m%d-%H%M).sql.gz"
```

```bash
git fetch --tags
```

```bash
git checkout v0.2.0
```

```bash
sed -i "s|^VOLS_VERSION=.*|VOLS_VERSION='$(git describe --tags --always)'|" .env.prod
```

```bash
dc up -d --build
```

```bash
dc run --rm api node_modules/.bin/tsx src/scripts/migrate.ts
```

Удалить старые образы:

```bash
docker image prune -f
```

Откат — те же команды с прежней версией в `git checkout`. Миграции не откатываются: если новая версия меняла схему, восстановите копию (ниже).

## Полезные команды

| Задача | Команда |
|---|---|
| Логи всех контейнеров | `dc logs -f` |
| Логи веба/Caddy (сертификат) | `dc logs web` |
| Логи API | `dc logs api` |
| Перезапустить контейнер | `dc restart api` |
| Остановить всё (данные сохраняются) | `dc down` |
| Консоль базы | `dc exec db psql -U vols -d vols` |
| Занятое место | `docker system df` |

## Восстановление из копии

Копия восстанавливается в пустую базу: текущие данные будут заменены.

```bash
dc stop api web
```

```bash
dc exec -T db dropdb -U vols --force vols
```

```bash
dc exec -T db createdb -U vols vols
```

```bash
gunzip -c backups/ФАЙЛ.sql.gz | dc exec -T db psql -U vols -d vols -v ON_ERROR_STOP=1
```

```bash
dc start api web
```

Данные хранятся в томах Docker `vols_db-data` (база) и `vols_caddy-data` (сертификаты). **`dc down -v` удаляет их безвозвратно** — не используйте `-v`, если не хотите стереть базу.
