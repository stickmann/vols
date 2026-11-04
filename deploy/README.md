# Развёртывание на сервере

Стенд состоит из трёх контейнеров:
- PostgreSQL + PostGIS;
- API;
- Caddy, который раздаёт веб, проксирует `/api` и сам выпускает HTTPS-сертификат.

## Что нужно

- VPS с Ubuntu 22.04/24.04 или Debian 12: от 2 ГБ памяти и 20 ГБ диска.
- Если сервис для операторов из РФ и в нём будут абонентские данные, сервер должен быть в РФ (152-ФЗ).
- Открытые порты 80 и 443.
- Домен с A-записью на IP сервера — желательно, для HTTPS. Без домена стенд работает по IP, но без шифрования.

## Установка

```bash
git clone -b claude/lucid-clarke-biww0a https://github.com/stickmann/vols.git
```

```bash
cd vols
```

```bash
./deploy/install.sh vols.example.ru
```

Без домена запускайте `./deploy/install.sh` без аргумента.

Скрипт:
1. ставит Docker, если его нет;
2. спрашивает логин и пароль для входа на сайт;
3. генерирует пароли БД в `.env.prod`;
4. собирает и запускает контейнеры;
5. применяет миграции и создаёт демо-оператора с демо-сетью.

## Пока нет входа в систему

Весь сайт закрыт логином и паролем на уровне Caddy (basic auth). Внутри работает режим просмотра: `ALLOW_TENANT_HEADER=true`, оператор выбирается в интерфейсе, по умолчанию это демо-оператор. Не вносите реальные данные абонентов, пока не готов полноценный вход с ролями.

## Обслуживание

| Задача | Команда |
|---|---|
| Обновить код и применить миграции | `./deploy/update.sh` |
| Резервная копия базы | `./deploy/backup.sh` |
| Логи | `docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f api web` |
| Состояние | `docker compose --env-file .env.prod -f docker-compose.prod.yml ps` |

Восстановление из копии:

```bash
gunzip -c backups/vols-ДАТА.sql.gz | docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T db psql -U vols -d vols
```

## Подложка карты

По умолчанию используются тайлы tile.openstreetmap.org. Для показа это нормально, но для рабочего сервиса их правила такую нагрузку не допускают. Свой стиль и спутник задаются переменными `VITE_MAP_STYLE` и `VITE_SATELLITE_TILES` в `.env.prod`, после чего нужно запустить `./deploy/update.sh`.
