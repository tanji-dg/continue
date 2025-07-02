#!/bin/bash -e
# nvmの読み込み（通常のインストールパス）
#export NVM_DIR="$HOME/.nvm"
#[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

cd extensions/vscode/
#nvm use v20.19.0 
npm run build:prod
npm run package-all
#cp -vu build/*-*.vsix ~/d-out-tanji
