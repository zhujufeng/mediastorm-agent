#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  print "未找到 Node.js，请先安装 Node.js 22.19 或以上版本。"
  read "?按回车关闭。"
  exit 1
fi
node scripts/pi-project.mjs
result=$?
if (( result != 0 )); then
  read "?启动或运行失败，请查看上方原因。按回车关闭。"
fi
exit $result
