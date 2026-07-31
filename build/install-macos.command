#!/bin/bash

set -euo pipefail

APP_NAME="Nova.app"
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_APP="$SOURCE_DIR/$APP_NAME"
TARGET_APP="/Applications/$APP_NAME"

if [[ ! -d "$SOURCE_APP" ]]; then
  echo "未在安装镜像中找到 $APP_NAME。"
  read -r -p "按回车键关闭..."
  exit 1
fi

echo "正在安装 Nova..."

if [[ -w "/Applications" ]]; then
  rm -rf "$TARGET_APP"
  /usr/bin/ditto "$SOURCE_APP" "$TARGET_APP"
  /usr/bin/xattr -dr com.apple.quarantine "$TARGET_APP"
else
  echo "需要输入 Mac 登录密码以安装到应用程序目录。"
  /usr/bin/sudo /bin/rm -rf "$TARGET_APP"
  /usr/bin/sudo /usr/bin/ditto "$SOURCE_APP" "$TARGET_APP"
  /usr/bin/sudo /usr/bin/xattr -dr com.apple.quarantine "$TARGET_APP"
fi

/usr/bin/codesign --verify --deep --strict "$TARGET_APP"
/usr/bin/open "$TARGET_APP"

echo "Nova 已安装并启动。"
sleep 2
