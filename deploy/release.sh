# shellcheck shell=bash
# Выбор релиза для развёртывания. Подключается из install.sh и update.sh.
# Релиз — опубликованный релиз GitHub, то есть тег вида 1.2.0 или v1.2.0 на коммите в main.

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
confirm() { read -rp "$1 [y/N] " a; [[ "$a" =~ ^[YyДд] ]]; }

# Теги релизов, от новых к старым. Буква v в начале не обязательна: 0.2 и v0.3.0 сравниваются как 0.2 и 0.3.0.
release_tags() {
  git tag --list 'v[0-9]*' '[0-9]*' | awk '{k=$0; sub(/^v/, "", k); print k "\t" $0}' | sort -t "$(printf '\t')" -k1,1Vr | cut -f2
}

# Последний стабильный релиз (теги с суффиксом вроде 1.2.0-rc1 пропускаются).
latest_release() { release_tags | grep -v -- '-' | head -1; }

# is_older A B — версия A старше B (обе — теги релизов).
is_older() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "${1#v}" "${2#v}" | sort -V | head -1)" = "${1#v}" ]; }

# Это тег релиза (а не ветка@коммит)?
is_release() { [[ "$1" =~ ^v?[0-9] ]]; }

# Что развёрнуто сейчас: тег релиза или ветка@коммит.
current_release() { git describe --tags --exact-match 2>/dev/null || echo "$(git rev-parse --abbrev-ref HEAD)@$(git rev-parse --short HEAD)"; }

# Версия для показа в интерфейсе и /health: v1.2.0, либо v1.2.0-3-gabc123 для промежуточных сборок.
app_version() { git describe --tags --always; }

# switch_release [версия] — получает релизы с GitHub и переключает рабочую копию.
# Без аргумента — последний релиз. Можно указать ветку (main) для проверки неопубликованного кода.
# Печатает выбранную версию.
switch_release() {
  local want="${1:-}"
  git fetch --quiet --tags --force origin >&2
  if [ -z "$want" ]; then
    want=$(latest_release)
    if [ -z "$want" ]; then
      echo "В репозитории ещё нет релизов. Опубликуйте релиз на GitHub (тег вида 0.1.0 или v0.1.0)" >&2
      echo "или укажите ветку явно, например main." >&2
      return 1
    fi
  fi
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "В файлах на сервере есть локальные правки, переключение отменено:" >&2
    git status --short --untracked-files=no >&2
    return 1
  fi
  if git rev-parse -q --verify "refs/tags/$want^{commit}" >/dev/null; then
    git -c advice.detachedHead=false checkout --quiet "refs/tags/$want" >&2
  elif git rev-parse -q --verify "refs/remotes/origin/$want" >/dev/null; then
    git checkout --quiet -B "$want" "origin/$want" >&2
  else
    echo "Нет релиза или ветки «$want». Последние релизы:" >&2
    release_tags | head -10 >&2
    return 1
  fi
  echo "$want"
}

# set_env КЛЮЧ ЗНАЧЕНИЕ — записывает значение в .env.prod (значение без одинарных кавычек).
set_env() {
  if grep -q "^$1=" .env.prod; then
    sed -i "s|^$1=.*|$1='$2'|" .env.prod
  else
    printf "%s='%s'\n" "$1" "$2" >> .env.prod
  fi
}

# env_value КЛЮЧ — значение из .env.prod (пусто, если нет файла или ключа).
env_value() {
  # Файла ещё нет при первой установке: это не ошибка (иначе set -e молча завершит скрипт).
  [ -f .env.prod ] || return 0
  sed -n "s/^$1='\{0,1\}\([^']*\)'\{0,1\}\$/\1/p" .env.prod | tail -1
}

# vols_compose … — docker compose с файлами и настройками стенда.
# Если ВОЛС стоит за чужим веб-сервером (EDGE_NETWORK), подключается docker-compose.edge.yml.
vols_compose() {
  local files=(-f docker-compose.prod.yml)
  [ -n "$(env_value EDGE_NETWORK)" ] && files+=(-f docker-compose.edge.yml)
  docker compose --env-file .env.prod "${files[@]}" "$@"
}
