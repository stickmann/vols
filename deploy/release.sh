# shellcheck shell=bash
# Выбор релиза для развёртывания. Подключается из install.sh и update.sh.
# Релиз — опубликованный релиз GitHub, то есть тег вида v1.2.0 на коммите в main.

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
confirm() { read -rp "$1 [y/N] " a; [[ "$a" =~ ^[YyДд] ]]; }

# Последний стабильный релиз (теги с суффиксом вроде v1.2.0-rc1 пропускаются).
latest_release() { git tag --list 'v[0-9]*' --sort=-v:refname | grep -v -- '-' | head -1; }

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
      echo "В репозитории ещё нет релизов. Опубликуйте релиз на GitHub (тег вида v0.1.0)" >&2
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
    git tag --list 'v[0-9]*' --sort=-v:refname | head -10 >&2
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
