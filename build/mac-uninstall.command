#!/bin/bash
# deepshui-translator 卸载脚本（macOS 无标准卸载机制，用本脚本删除应用与用户数据）
# 使用方法: 双击运行，或在终端执行 bash 本文件
APP="/Applications/deepshui-translator.app"
DATA="$HOME/Library/Application Support/deepshui-translator"

echo "=============================================="
echo " deepshui-translator 卸载"
echo "=============================================="
echo "将删除:"
echo "  应用: $APP"
echo "  数据: $DATA"
echo ""
read -p "确认卸载并清除所有本地数据？(y/N) " ans
case "$ans" in
  y|Y|yes|YES)
    rm -rf "$APP" "$DATA"
    echo ""
    echo "✅ 已卸载并清除配置"
    ;;
  *)
    echo "已取消"
    ;;
esac
echo ""
echo "按回车关闭窗口…"
read
