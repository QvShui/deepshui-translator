#!/bin/sh
# 卸载时清除用户配置（config.json / models-cache.json 等，位于 ~/.config/deepshui-translator）
# 注意: postrm 以 root 运行，$HOME 指向 /root，必须遍历所有用户家目录
for h in /home/* /root; do
    [ -d "$h" ] || continue
    rm -rf "$h/.config/deepshui-translator"
done
exit 0
