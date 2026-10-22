#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo '需要 Python 3。也可以将整个文件夹部署到 HTTPS 静态网站。'
  read -r -p '按回车退出' answer
  exit 1
fi
echo '请在浏览器打开 http://localhost:8000 ，按 Control+C 停止服务。'
python3 -m http.server 8000 --bind 127.0.0.1
