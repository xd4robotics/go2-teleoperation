#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MESSAGE="${1:-fix: atualizar painel Go2}"

cd "$ROOT"

branch="$(git branch --show-current)"
[[ "$branch" == "main" ]] || {
  echo "[ERRO] A publicação de produção deve sair da branch main (atual: $branch)." >&2
  exit 1
}

if [[ -z "$(git status --short)" ]]; then
  echo "Nada mudou; não há conteúdo novo para publicar."
  exit 0
fi

echo "Arquivos que serão publicados:"
git status --short
echo
read -r -p "Validar, criar o commit e publicar na Vercel? [s/N] " confirmation
case "$confirmation" in
  s|S|sim|SIM|Sim) ;;
  *) echo "Publicação cancelada."; exit 0 ;;
esac

echo "Validando scripts..."
bash -n run_web.sh run_vercel.sh robot_gateway/run_gateway.sh \
  robot_gateway/run_livekit_streams.sh
python3 -m py_compile \
  robot_gateway/livekit_data_publisher.py \
  robot_gateway/livekit_command_receiver.py
git diff --check

if command -v npm >/dev/null 2>&1; then
  echo "Validando frontend com Node.js local..."
  npm ci --prefix frontend
  npm run lint --prefix frontend
  npm run build --prefix frontend
else
  if docker info >/dev/null 2>&1; then
    DOCKER=(docker)
  else
    echo "O Docker precisa de permissão administrativa para validar o frontend."
    DOCKER=(sudo docker)
    "${DOCKER[@]}" info >/dev/null
  fi
  echo "Validando frontend em Node.js 22..."
  "${DOCKER[@]}" run --rm \
    --volume "$ROOT/frontend:/app" \
    --workdir /app \
    node:22-alpine \
    sh -lc 'npm ci && npm run lint && npm run build'
fi

git add -A
git diff --cached --check
git commit -m "$MESSAGE"
git push origin main

echo
echo "Código enviado. A integração GitHub → Vercel iniciou o deployment automático."
echo "Aguardando a Vercel concluir a publicação..."

remote_url="$(git remote get-url origin)"
commit_sha="$(git rev-parse HEAD)"
deployment_url="$(python3 - "$remote_url" "$commit_sha" <<'PY'
import json
import re
import sys
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

remote, commit_sha = sys.argv[1:3]
match = re.search(r"github\.com[/:]([^/]+)/([^/]+?)(?:\.git)?$", remote)
if not match:
    raise SystemExit(0)
owner, repository = match.groups()
base = "https://api.github.com/repos/%s/%s" % (owner, repository)
headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "go2-vercel-publisher",
}

for _ in range(30):
    try:
        query = urlencode({"sha": commit_sha, "per_page": 10})
        request = Request(base + "/deployments?" + query, headers=headers)
        with urlopen(request, timeout=10) as response:
            deployments = json.load(response)
        deployment = next(
            (item for item in deployments if item.get("production_environment")),
            deployments[0] if deployments else None,
        )
        if deployment:
            request = Request(
                base + "/deployments/%s/statuses?per_page=10" % deployment["id"],
                headers=headers,
            )
            with urlopen(request, timeout=10) as response:
                statuses = json.load(response)
            if statuses:
                state = statuses[0].get("state")
                print("Vercel: %s" % state, file=sys.stderr, flush=True)
                if state == "success":
                    print(statuses[0].get("environment_url", ""))
                    raise SystemExit(0)
                if state in {"error", "failure", "inactive"}:
                    raise SystemExit(1)
    except SystemExit:
        raise
    except Exception as error:
        print("Aguardando status: %s" % error, file=sys.stderr, flush=True)
    time.sleep(8)

raise SystemExit(2)
PY
)" || deployment_status=$?

case "${deployment_status:-0}" in
  0)
    echo "Deployment concluído com sucesso."
    [[ -n "$deployment_url" ]] && echo "Painel: $deployment_url"
    ;;
  1)
    echo "[ERRO] A Vercel informou falha no deployment." >&2
    exit 1
    ;;
  *)
    echo "O push foi concluído, mas a confirmação automática excedeu o tempo." >&2
    echo "Acompanhe em: https://vercel.com/dashboard"
    ;;
esac
